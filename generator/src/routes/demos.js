import { Router } from 'express';

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

      const { generateDemo, now } = services;

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

      const { generateDemo, deinteractivize, jobRunner, makeSecretStore, now } = services;

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

      // 4. Fire-and-forget: kick runProvision without awaiting
      //    Errors are caught and logged only — response is already sent.
      Promise.resolve().then(() =>
        jobRunner.runProvision({
          demo: { id: result.demoId, domain: result.domainName, suffix: result.suffix },
          scriptRef: headlessScript,
          secrets: options.credentials ?? {},
          registry,
          now: now ?? (() => new Date().toISOString()),
        })
      ).catch((err) => {
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
