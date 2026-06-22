import express from 'express';
import { demosRouter } from './routes/demos.js';
import { planningRouter } from './routes/planning.js';

/**
 * Build the Express application.
 *
 * @param {object} opts
 * @param {object} opts.registry         - DemoRegistry instance
 * @param {Function} opts.authMiddleware - Authentication middleware (req, res, next)
 * @param {object} [opts.services={}]    - Optional injected services for Plan C routes.
 *   When omitted or empty, Plan A GET routes and /health continue to work unchanged.
 *   Shape: { generateDemo, deinteractivize, jobRunner, secretStore,
 *            research, optimizeGoal, analyzeMcp, now }
 */
export function buildApp({ registry, authMiddleware, services = {} }) {
  const app = express();
  app.use(express.json());

  // 認証不要のヘルスチェック。
  // 注意: 厳密パス /healthz は GCP の GFE がヘルスチェック用に予約しており、
  // 外部からアクセスするとコンテナに届かず常に 404 になる。そのため /health を使う。
  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  // /api 配下は認証必須
  app.use('/api', authMiddleware);

  // demos routes: Plan A (GET /) + Plan C (POST /, GET /:id/status)
  app.use('/api/demos', demosRouter(registry, services));

  // planning routes (Plan C): only mounted when services are provided
  if (services.research || services.optimizeGoal || services.analyzeMcp) {
    app.use('/api', planningRouter(services));
  }

  // 集約エラーハンドラ
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    res.status(500).json({ error: err.message });
  });

  return app;
}
