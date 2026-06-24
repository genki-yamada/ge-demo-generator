import { Router } from 'express';

/**
 * Feature A: after a successful provision (build → active), open the demo agent's
 * Cloud Run ingress to `all` so a cross-project/cross-org Gemini Enterprise can
 * reach it (the generated script deploys with ingress=internal). Best-effort —
 * never throws, no-ops when geRegistrar is unconfigured or the provision failed.
 *
 * @param {object} services        - route services (may have geRegistrar + config)
 * @param {object} provisionResult - result of jobRunner.runProvision ({ ok, ... })
 * @param {string} demoId          - the agent Cloud Run service name (== demo id)
 */
async function maybeOpenIngress(services, provisionResult, demoId) {
  if (!provisionResult?.ok) return;
  if (typeof services?.geRegistrar?.setIngressAll !== 'function') return;
  try {
    await services.geRegistrar.setIngressAll(demoId, services.config?.agentRegion);
  } catch (e) {
    console.error('[setIngressAll] failed:', e?.message ?? e);
  }
}

/**
 * demosRouter — GET /api/demos, GET /api/demos/:id (Plan A, unchanged)
 *               POST /api/demos              (Plan C Task 7 — build start)
 *               GET /api/demos/:id/status    (Plan C Task 7 — status)
 *
 * @param {object} registry  - DemoRegistry instance
 * @param {object} [services={}] - Optional injected services (Plan C routes).
 *   When omitted, POST and /status routes return 501 (not reached in Plan A tests).
 *   Shape: { generateDemo, deinteractivize, jobRunner, makeSecretStore, now }
 *
 *   IMPORTANT — `services.generateDemo` is a partial bound with all planning sub-deps
 *   (planAndGenerateData, classifyTaxonomy, generateSetupScript, callVertexAI, etc.).
 *   The route supplies only `{ userEmail, registry, now }` and merges them at call time.
 *   Do NOT assign the raw `generateDemo` export here — it needs ~12 deps and will crash.
 */

/**
 * generateRouter — POST /api/generate (sync generate-only endpoint).
 *
 * Returns the FULL generateDemo result (setupScript, dataPreview, systemInstruction,
 * demoId, suffix, etc.) synchronously without kicking a Cloud Run Job.
 * Intended for the UI "manual run" UX — the caller receives the setup script and
 * can run it themselves (matching the original GAS UX).
 *
 * Does NOT call deinteractivize or jobRunner.runProvision.
 *
 * @param {object} registry  - DemoRegistry instance
 * @param {object} [services={}] - Same shape as demosRouter services.
 */
export function generateRouter(registry, services = {}) {
  const router = Router();

  router.post('/', async (req, res, next) => {
    try {
      const { userGoal, options = {} } = req.body ?? {};

      if (!userGoal) {
        return res.status(400).json({ error: 'userGoal is required' });
      }

      const { generateDemo, scriptStore, now } = services;

      // Guard: if generate service is not configured, return an honest 503 rather
      // than a confusing TypeError→500.
      if (typeof generateDemo !== 'function') {
        return res.status(503).json({ error: 'build service not configured' });
      }

      // Orchestrate demo generation (registers building state internally) and
      // return the FULL result — no job kick, no deinteractivize.
      const result = await generateDemo(userGoal, options, {
        userEmail: req.user?.email,
        registry,
        now: now ?? (() => new Date().toISOString()),
      });

      if (scriptStore && result?.demoId && result?.setupScript) {
        try {
          const uri = await scriptStore.save(result.demoId, result.setupScript);
          await registry.setScriptUri(result.demoId, uri, (now ?? (() => new Date().toISOString()))());
          result.scriptGcsUri = uri;
        } catch (e) { console.error('script save failed', e); }
      }

      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export function demosRouter(registry, services = {}) {
  const router = Router();

  // ── Plan A routes (unchanged) ─────────────────────────────────────────────

  router.get('/', async (req, res, next) => {
    try {
      const demos = await registry.list();
      res.json({ demos });
    } catch (err) {
      next(err);
    }
  });

  // NOTE: /:id must be defined AFTER /:id/status to avoid swallowing the
  // "status" segment. Express matches routes in registration order; since
  // /:id/status is more specific, it is registered first below, then /:id.

  // ── Plan C: GET /api/demos/:id/status ────────────────────────────────────

  router.get('/:id/status', async (req, res, next) => {
    try {
      const demo = await registry.get(req.params.id);
      if (!demo) {
        return res.status(404).json({ error: 'not found' });
      }
      const { id, state, updatedAt, createdAt, ownerCe, domain, suffix } = demo;
      res.json({ id, state, updatedAt, createdAt, ownerCe, domain, suffix });
    } catch (err) {
      next(err);
    }
  });

  // ── Plan D: POST /api/demos/:id/cleanup ──────────────────────────────────

  router.post('/:id/cleanup', async (req, res, next) => {
    try {
      const { confirmName } = req.body ?? {};
      const { cleanupRunner, now } = services;
      // Fix 4: guard misconfigured deployment BEFORE the DB read to avoid a wasted roundtrip.
      if (typeof cleanupRunner?.runCleanup !== 'function') return res.status(503).json({ error: 'cleanup service not configured' });
      const demo = await registry.get(req.params.id);
      if (!demo) return res.status(404).json({ error: 'not found' });
      if (confirmName !== demo.id) return res.status(400).json({ error: 'confirmName must match the demo id' });
      if (demo.state === 'building') return res.status(409).json({ error: 'cannot cleanup while building' });
      if (demo.state === 'deleting') return res.status(409).json({ error: 'cleanup already in progress' });
      let updated;
      try {
        updated = await registry.startCleanup(req.params.id, (now ?? (() => new Date().toISOString()))());
      } catch (e) {
        // Fix 3: only map state-conflict errors to 409; genuine infra errors become 500 via next(err).
        if (/cannot cleanup while building|invalid transition/i.test(e.message)) {
          return res.status(409).json({ error: `cannot start cleanup: ${e.message}` });
        }
        return next(e);
      }
      // Non-blocking fire-and-forget: runCleanup transitions deleting → deleted|delete_failed.
      Promise.resolve()
        .then(() => cleanupRunner.runCleanup({ demo: updated }))
        .catch((err) => console.error('cleanup runner failed:', err));
      return res.status(202).json({ demoId: updated.id, state: 'deleting' });
    } catch (err) { next(err); }
  });

  // ── POST /api/demos/:id/provision — headless auto-execution ──────────────
  // Build (provision on Cloud) a demo that was already generated via /api/generate.
  // The setup script is already saved to GCS (scriptStore.save) and the demo is in
  // `building` state; here we deinteractivize that saved script, upload a headless
  // copy, and fire-and-forget runProvision (which transitions building → active|
  // build_failed). This builds exactly what the user previewed — no regeneration.
  router.post('/:id/provision', async (req, res, next) => {
    try {
      const { deinteractivize, jobRunner, scriptStore, now } = services;
      if (typeof jobRunner?.runProvision !== 'function' || typeof deinteractivize !== 'function' || !scriptStore) {
        return res.status(503).json({ error: 'provision service not configured' });
      }
      const demo = await registry.get(req.params.id);
      if (!demo) return res.status(404).json({ error: 'not found' });
      // Only a freshly generated demo (building) can be provisioned. active/deleting/
      // deleted/build_failed are not valid sources for a building→active transition.
      if (demo.state !== 'building') {
        return res.status(409).json({ error: `cannot provision in state: ${demo.state}` });
      }
      // Prepare the headless script from the already-saved setup script.
      let scriptRef;
      try {
        const raw = await scriptStore.fetch(demo.id);
        const headless = deinteractivize(raw);
        scriptRef = await scriptStore.saveHeadless(demo.id, headless);
      } catch (e) {
        console.error('[provision] could not prepare script:', e?.message ?? e);
        return res.status(409).json({ error: 'setup script not available for this demo' });
      }
      const envRef = scriptStore.envRef(demo.id);
      const nowFn = now ?? (() => new Date().toISOString());
      // Fire-and-forget: response returns immediately; runProvision does the long work.
      Promise.resolve().then(() =>
        jobRunner.runProvision({ demo, scriptRef, secrets: {}, envRef, registry, now: nowFn })
      ).then((result) => maybeOpenIngress(services, result, demo.id))
        .catch((err) => console.error('[provision] async kick failed:', err?.message ?? err));
      return res.status(202).json({ demoId: demo.id, state: 'building' });
    } catch (err) { next(err); }
  });

  // ── GE-3: POST /api/demos/:id/register-ge ────────────────────────────────
  // Register an active demo's Cloud Run agent to Gemini Enterprise.
  // Sets ingress=all, grants GE Discovery Engine SA run.invoker, registers to GE app.

  router.post('/:id/register-ge', async (req, res, next) => {
    try {
      const { geRegistrar } = services;
      if (typeof geRegistrar?.registerToGe !== 'function') {
        return res.status(503).json({ error: 'GE registration not configured' });
      }
      const demo = await registry.get(req.params.id);
      if (!demo) return res.status(404).json({ error: 'not found' });
      if (demo.state !== 'active') {
        return res.status(409).json({ error: `cannot register in state: ${demo.state}` });
      }
      const result = await geRegistrar.registerToGe({ demoId: demo.id, region: services.config?.agentRegion });
      return res.status(200).json({
        demoId: demo.id,
        agentId: result.agentId ?? null,
        alreadyRegistered: !!result.alreadyRegistered,
      });
    } catch (err) { next(err); }
  });

  // ── Plan A: GET /api/demos/:id ────────────────────────────────────────────

  router.get('/:id', async (req, res, next) => {
    try {
      const demo = await registry.get(req.params.id);
      if (!demo) {
        return res.status(404).json({ error: 'not found' });
      }
      res.json({ demo });
    } catch (err) {
      next(err);
    }
  });

  // ── Plan C: POST /api/demos (build start) ────────────────────────────────

  router.post('/', async (req, res, next) => {
    try {
      const { userGoal, options = {} } = req.body ?? {};

      if (!userGoal) {
        return res.status(400).json({ error: 'userGoal is required' });
      }

      const { generateDemo, deinteractivize, jobRunner, makeSecretStore, scriptStore, now } = services;

      // Guard: if build services are not configured, return an honest 503 rather
      // than a confusing TypeError→500 (production wiring in server.js still TODO).
      if (typeof generateDemo !== 'function') {
        return res.status(503).json({ error: 'build service not configured' });
      }

      // 1. Orchestrate demo generation (registers building state internally)
      const result = await generateDemo(userGoal, options, {
        userEmail: req.user?.email,
        registry,
        now: now ?? (() => new Date().toISOString()),
      });

      // 1b. Persist setup script to GCS and record the URI in the registry.
      //     Failures are non-fatal: we log and continue so the provisioner
      //     response is not blocked by an optional persistence step.
      if (scriptStore && result?.demoId && result?.setupScript) {
        try {
          const uri = await scriptStore.save(result.demoId, result.setupScript);
          await registry.setScriptUri(result.demoId, uri, (now ?? (() => new Date().toISOString()))());
          result.scriptGcsUri = uri;
        } catch (e) { console.error('script save failed', e); }
      }

      // 2. Store credentials in Secret Manager if provided.
      //    The secret store is PER-REQUEST: secret names embed result.suffix
      //    (cleanup-grep invariant), so we build it only after generateDemo
      //    yields the suffix. Skipped entirely when the factory is absent.
      if (options.credentials && typeof options.credentials === 'object') {
        const secretStore = makeSecretStore ? makeSecretStore(result.suffix) : null;
        if (secretStore) {
          for (const [key, value] of Object.entries(options.credentials)) {
            await secretStore.putSecret(key, value);
          }
        }
      }

      // 3. Deinteractivize the setup script for headless execution
      const headlessScript = deinteractivize(result.setupScript);

      // 3b. Upload headless script to GCS and use the URI as scriptRef.
      //     This avoids passing ~600KB text as a Cloud Run env var (env size limit).
      //     Falls back to raw script text if scriptStore is absent or upload fails.
      let scriptRef = headlessScript;
      if (scriptStore) {
        try {
          scriptRef = await scriptStore.saveHeadless(result.demoId, headlessScript);
        } catch (e) {
          console.error('[saveHeadless] GCS upload failed, falling back to inline script:', e?.message ?? e);
        }
      }

      // 4. Fire-and-forget: kick runProvision without awaiting
      //    Errors are caught and logged only — response is already sent.
      const envRef = scriptStore ? scriptStore.envRef(result.demoId) : undefined;
      Promise.resolve().then(() =>
        jobRunner.runProvision({
          demo: { id: result.demoId, domain: result.domainName, suffix: result.suffix },
          scriptRef,
          secrets: options.credentials ?? {},
          registry,
          now: now ?? (() => new Date().toISOString()),
          envRef,
        })
      ).then((provResult) => maybeOpenIngress(services, provResult, result.demoId))
        .catch((err) => {
          console.error('[runProvision] async kick failed:', err?.message ?? err);
        });

      // 5. Respond immediately with building state
      res.status(202).json({ demoId: result.demoId, state: 'building' });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
