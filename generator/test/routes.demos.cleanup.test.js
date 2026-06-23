import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { DemoRegistry } from '../src/registry/registry.js';
import { MemoryStore } from '../src/registry/memory-store.js';

const NOW = '2026-06-22T00:00:00.000Z';

function passThroughAuth(req, res, next) {
  req.user = { email: 'ce@example.com' };
  next();
}

function makeStubServices(overrides = {}) {
  const generateDemo = vi.fn().mockResolvedValue({
    demoId: 'demo-x-abc1',
    setupScript: '#!/bin/bash\necho hello',
    suffix: 'abc1',
    domainName: 'x',
    success: true,
  });
  const deinteractivize = vi.fn((s) => s + '\n# headless');
  const runProvision = vi.fn().mockResolvedValue({ ok: true });
  const jobRunner = { runProvision };
  const putSecret = vi.fn().mockResolvedValue(undefined);
  const makeSecretStore = vi.fn((demoSuffix) => ({ demoSuffix, putSecret }));
  const research = vi.fn().mockResolvedValue({ success: true, companyName: 'Acme' });
  const optimizeGoal = vi.fn().mockResolvedValue({ success: true, optimizedGoal: 'refined goal' });
  const analyzeMcp = vi.fn().mockResolvedValue({ success: true, data: { is_supported: true } });
  const now = vi.fn().mockReturnValue(NOW);
  const scriptStore = { save: vi.fn().mockResolvedValue('gs://test-bucket/scripts/demo-x-abc1.sh') };
  const cleanupRunner = {
    runCleanup: vi.fn().mockResolvedValue({ demoId: 'demo-x-abc1', executionId: 'ex-1', allOk: true }),
  };

  return {
    generateDemo,
    deinteractivize,
    jobRunner,
    makeSecretStore,
    scriptStore,
    research,
    optimizeGoal,
    analyzeMcp,
    now,
    cleanupRunner,
    ...overrides,
  };
}

// ─── POST /api/demos/:id/cleanup ─────────────────────────────────────────────

describe('POST /api/demos/:id/cleanup', () => {
  let app;
  let registry;
  let services;

  const DEMO_DOMAIN = 'x';
  const DEMO_SUFFIX = 'abc1';
  const DEMO_ID = `demo-${DEMO_DOMAIN}-${DEMO_SUFFIX}`;

  async function registerDemo() {
    return registry.register({
      domain: DEMO_DOMAIN,
      suffix: DEMO_SUFFIX,
      ownerCe: 'ce@example.com',
      goal: 'test agent',
      now: NOW,
    });
  }

  beforeEach(() => {
    registry = new DemoRegistry(new MemoryStore());
    services = makeStubServices();
    app = buildApp({ registry, authMiddleware: passThroughAuth, services });
  });

  it('returns 404 for unknown demo id', async () => {
    const res = await request(app)
      .post('/api/demos/demo-unknown-xyz/cleanup')
      .send({ confirmName: 'demo-unknown-xyz' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns 400 when confirmName does not match the demo id', async () => {
    await registerDemo();
    await registry.transition(DEMO_ID, 'active', NOW);

    const res = await request(app)
      .post(`/api/demos/${DEMO_ID}/cleanup`)
      .send({ confirmName: 'wrong-id' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/confirmName must match/i);
  });

  it('returns 409 when demo is in building state', async () => {
    await registerDemo();
    // Newly registered demos are in building state

    const res = await request(app)
      .post(`/api/demos/${DEMO_ID}/cleanup`)
      .send({ confirmName: DEMO_ID });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/cannot cleanup while building/i);
  });

  it('returns 409 when demo is already in deleting state', async () => {
    await registerDemo();
    await registry.transition(DEMO_ID, 'active', NOW);
    await registry.transition(DEMO_ID, 'deleting', NOW);

    const res = await request(app)
      .post(`/api/demos/${DEMO_ID}/cleanup`)
      .send({ confirmName: DEMO_ID });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/cleanup already in progress/i);
  });

  it('returns 409 when demo is in deleted state (startCleanup rejects invalid transition)', async () => {
    await registerDemo();
    await registry.transition(DEMO_ID, 'active', NOW);
    await registry.transition(DEMO_ID, 'deleting', NOW);
    await registry.transition(DEMO_ID, 'deleted', NOW);

    const res = await request(app)
      .post(`/api/demos/${DEMO_ID}/cleanup`)
      .send({ confirmName: DEMO_ID });

    // deleted → deleting is not a valid transition; startCleanup throws → 409
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/cannot start cleanup/i);
  });

  it('returns 503 when cleanupRunner is not configured', async () => {
    await registerDemo();
    await registry.transition(DEMO_ID, 'active', NOW);

    const unconfiguredApp = buildApp({
      registry,
      authMiddleware: passThroughAuth,
      services: makeStubServices({ cleanupRunner: undefined }),
    });

    const res = await request(unconfiguredApp)
      .post(`/api/demos/${DEMO_ID}/cleanup`)
      .send({ confirmName: DEMO_ID });

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/cleanup service not configured/i);
  });

  it('returns 202 with {demoId, state:"deleting"} when demo is active and confirmName matches', async () => {
    await registerDemo();
    await registry.transition(DEMO_ID, 'active', NOW);

    const res = await request(app)
      .post(`/api/demos/${DEMO_ID}/cleanup`)
      .send({ confirmName: DEMO_ID });

    expect(res.status).toBe(202);
    expect(res.body.demoId).toBe(DEMO_ID);
    expect(res.body.state).toBe('deleting');
  });

  it('transitions demo to deleting state in registry after 202', async () => {
    await registerDemo();
    await registry.transition(DEMO_ID, 'active', NOW);

    await request(app)
      .post(`/api/demos/${DEMO_ID}/cleanup`)
      .send({ confirmName: DEMO_ID });

    const demo = await registry.get(DEMO_ID);
    expect(demo.state).toBe('deleting');
  });

  it('calls cleanupRunner.runCleanup asynchronously after 202', async () => {
    await registerDemo();
    await registry.transition(DEMO_ID, 'active', NOW);

    const res = await request(app)
      .post(`/api/demos/${DEMO_ID}/cleanup`)
      .send({ confirmName: DEMO_ID });

    expect(res.status).toBe(202);

    // Flush microtasks for fire-and-forget Promise.resolve().then(...)
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(services.cleanupRunner.runCleanup).toHaveBeenCalledOnce();
    const arg = services.cleanupRunner.runCleanup.mock.calls[0][0];
    expect(arg.demo.id).toBe(DEMO_ID);
    expect(arg.demo.state).toBe('deleting');
  });

  it('returns 401 when auth middleware rejects', async () => {
    const denyAuth = (req, res) => res.status(401).json({ error: 'denied' });
    const restrictedApp = buildApp({ registry, authMiddleware: denyAuth, services });

    await registerDemo();
    await registry.transition(DEMO_ID, 'active', NOW);

    const res = await request(restrictedApp)
      .post(`/api/demos/${DEMO_ID}/cleanup`)
      .send({ confirmName: DEMO_ID });

    expect(res.status).toBe(401);
  });
});
