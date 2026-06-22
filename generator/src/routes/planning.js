import { Router } from 'express';

/**
 * planning router — POST /api/research, /api/optimize-goal, /api/mcp/analyze
 *
 * All handlers delegate to injected services for full testability.
 * Service failures are passed through as-is (200 with {success:false, ...})
 * to preserve the original function return shape.
 * Missing required body fields return 400.
 *
 * @param {object} services
 * @param {Function} services.research      - (domain) => Promise<object>
 * @param {Function} services.optimizeGoal  - (rawGoal) => Promise<object>
 * @param {Function} services.analyzeMcp   - (repoUrl) => Promise<object>
 * @returns {Router}
 */
export function planningRouter(services) {
  const router = Router();

  // POST /api/research
  router.post('/research', async (req, res, next) => {
    try {
      const { domain } = req.body ?? {};
      if (!domain) {
        return res.status(400).json({ error: 'domain is required' });
      }
      const result = await services.research(domain);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/optimize-goal
  router.post('/optimize-goal', async (req, res, next) => {
    try {
      const { rawGoal } = req.body ?? {};
      if (!rawGoal) {
        return res.status(400).json({ error: 'rawGoal is required' });
      }
      const result = await services.optimizeGoal(rawGoal);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/mcp/analyze
  router.post('/mcp/analyze', async (req, res, next) => {
    try {
      const { repoUrl } = req.body ?? {};
      if (!repoUrl) {
        return res.status(400).json({ error: 'repoUrl is required' });
      }
      const result = await services.analyzeMcp(repoUrl);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
