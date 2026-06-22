import { Router } from 'express';

/**
 * demosRouter — GET /api/demos, GET /api/demos/:id (Plan A, unchanged)
 *               POST /api/demos              (Plan C Task 7 — build start)
 *               GET /api/demos/:id/status    (Plan C Task 7 — status)
 *
 * @param {object} registry  - DemoRegistry instance
 * @param {object} [services={}] - Optional injected services (Plan C routes).
 *   When omitted, POST and /status routes return 501 (not reached in Plan A tests).
 *   Shape: { generateDemo, deinteractivize, jobRunner, secretStore, now }
 */
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

      const { generateDemo, deinteractivize, jobRunner, secretStore, now } = services;

      // 1. Orchestrate demo generation (registers building state internally)
      const result = await generateDemo(userGoal, options, {
        userEmail: req.user?.email,
        registry,
        now: now ?? (() => new Date().toISOString()),
      });

      // 2. Store credentials in Secret Manager if provided
      if (options.credentials && typeof options.credentials === 'object') {
        for (const [key, value] of Object.entries(options.credentials)) {
          await secretStore.putSecret(key, value);
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
          now: (now ?? (() => new Date().toISOString()))(),
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
