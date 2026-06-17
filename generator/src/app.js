import express from 'express';
import { demosRouter } from './routes/demos.js';

export function buildApp({ registry, authMiddleware }) {
  const app = express();
  app.use(express.json());

  // 認証不要のヘルスチェック。
  // 注意: 厳密パス /healthz は GCP の GFE がヘルスチェック用に予約しており、
  // 外部からアクセスするとコンテナに届かず常に 404 になる。そのため /health を使う。
  app.get('/health', (req, res) => res.json({ status: 'ok' }));

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
