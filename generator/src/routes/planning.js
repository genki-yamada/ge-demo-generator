import { Router } from 'express';

/**
 * planning router — POST /api/research, /api/optimize-goal, /api/mcp/analyze,
 *                   POST /api/regenerate-goal, POST /api/update-instruction
 *
 * All handlers delegate to injected services for full testability.
 * Service failures are passed through as-is (200 with {success:false, ...})
 * to preserve the original function return shape.
 * Missing required body fields return 400.
 *
 * @param {object} services
 * @param {Function} services.research          - (domain) => Promise<object>
 * @param {Function} services.optimizeGoal      - (rawGoal) => Promise<object>
 * @param {Function} services.analyzeMcp        - (repoUrl) => Promise<object>
 * @param {Function} [services.regenerateGoal]  - (companyInfo, selectedWorkflows) => Promise<object>
 * @param {Function} [services.updateInstruction] - (setupScript, businessInstruction, technicalInstruction) => string
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

  // POST /api/regenerate-goal
  router.post('/regenerate-goal', async (req, res, next) => {
    try {
      const { companyInfo, selectedWorkflows } = req.body ?? {};
      if (!companyInfo) {
        return res.status(400).json({ error: 'companyInfo is required' });
      }
      if (!selectedWorkflows) {
        return res.status(400).json({ error: 'selectedWorkflows is required' });
      }
      const result = await services.regenerateGoal(companyInfo, selectedWorkflows);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/update-instruction
  router.post('/update-instruction', async (req, res, next) => {
    try {
      const { setupScript, businessInstruction, technicalInstruction } = req.body ?? {};
      if (setupScript === undefined || setupScript === null || setupScript === '') {
        return res.status(400).json({ error: 'setupScript is required' });
      }
      if (!businessInstruction) {
        return res.status(400).json({ error: 'businessInstruction is required' });
      }
      if (!technicalInstruction) {
        return res.status(400).json({ error: 'technicalInstruction is required' });
      }
      const newScript = services.updateInstruction(setupScript, businessInstruction, technicalInstruction);
      res.json({ setupScript: newScript });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
