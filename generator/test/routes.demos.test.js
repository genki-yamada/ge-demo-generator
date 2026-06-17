import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { DemoRegistry } from '../src/registry/registry.js';
import { MemoryStore } from '../src/registry/memory-store.js';

const now = '2026-06-17T00:00:00.000Z';

function passThroughAuth(req, res, next) {
  req.user = { email: 'ce@example.com' };
  next();
}

describe('demos routes', () => {
  let app;
  let registry;

  beforeEach(async () => {
    registry = new DemoRegistry(new MemoryStore());
    await registry.register({ domain: 'retail', suffix: 'abc', ownerCe: 'ce@example.com', now });
    app = buildApp({ registry, authMiddleware: passThroughAuth });
  });

  it('GET /healthz is public and returns ok', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /api/demos lists demos', async () => {
    const res = await request(app).get('/api/demos');
    expect(res.status).toBe(200);
    expect(res.body.demos).toHaveLength(1);
    expect(res.body.demos[0].id).toBe('demo-retail-abc');
  });

  it('GET /api/demos/:id returns a demo', async () => {
    const res = await request(app).get('/api/demos/demo-retail-abc');
    expect(res.status).toBe(200);
    expect(res.body.demo.state).toBe('building');
  });

  it('GET /api/demos/:id returns 404 for unknown id', async () => {
    const res = await request(app).get('/api/demos/demo-x-y');
    expect(res.status).toBe(404);
  });
});

describe('demos routes auth enforcement', () => {
  it('blocks /api when auth middleware rejects', async () => {
    const registry = new DemoRegistry(new MemoryStore());
    const denyAuth = (req, res) => res.status(401).json({ error: 'denied' });
    const app = buildApp({ registry, authMiddleware: denyAuth });
    const res = await request(app).get('/api/demos');
    expect(res.status).toBe(401);
  });
});
