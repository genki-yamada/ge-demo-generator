import express from 'express';
import { demosRouter } from './routes/demos.js';

export function buildApp({ registry, authMiddleware }) {
  const app = express();
  app.use(express.json());

  // 認証不要のヘルスチェック
  app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

  // /api 配下は認証必須
  app.use('/api', authMiddleware);
  app.use('/api/demos', demosRouter(registry));

  // 集約エラーハンドラ
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    res.status(500).json({ error: err.message });
  });

  return app;
}
