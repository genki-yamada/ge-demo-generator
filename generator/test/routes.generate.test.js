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

/** Full-shape result that generateDemo returns */
const FULL_RESULT = {
  demoId: 'demo-retail-abcd1234',
  suffix: 'abcd1234',
  dirName: 'demo-retail-abcd1234',
  domainName: 'retail',
  setupScript: '#!/bin/bash\necho hello',
  dataPreview: [{ tableName: 'orders', rows: [] }],
  systemInstruction: 'You are a helpful retail agent.',
  businessInstruction: 'Focus on upsell opportunities.',
  technicalInstruction: 'Use BigQuery for analytics.',
  referenceDate: '2026-06-22',
  tables: [{ name: 'orders', schema: [] }],
  firestore: { collections: [] },
  success: true,
};

function makeStubServices(overrides = {}) {
  const generateDemo = vi.fn().mockResolvedValue({ ...FULL_RESULT });
  const deinteractivize = vi.fn((s) => s + '\n# headless');
  const runProvision = vi.fn().mockResolvedValue({ ok: true });
  const jobRunner = { runProvision };
  const now = vi.fn().mockReturnValue(NOW);

  return {
    generateDemo,
    deinteractivize,
    jobRunner,
    now,
    ...overrides,
  };
}

// ─── POST /api/generate ───────────────────────────────────────────────────────

describe('POST /api/generate — sync generate-only', () => {
  let app;
  let registry;
  let services;

  beforeEach(() => {
    registry = new DemoRegistry(new MemoryStore());
    services = makeStubServices();
    app = buildApp({ registry, authMiddleware: passThroughAuth, services });
  });

  it('returns 200 with the full generateDemo result including setupScript', async () => {
    const res = await request(app)
      .post('/api/generate')
      .send({ userGoal: 'Build a retail agent' });

    expect(res.status).toBe(200);
    expect(res.body.setupScript).toBe('#!/bin/bash\necho hello');
    expect(res.body.demoId).toBe('demo-retail-abcd1234');
    expect(res.body.dataPreview).toEqual(FULL_RESULT.dataPreview);
    expect(res.body.systemInstruction).toBe('You are a helpful retail agent.');
    expect(res.body.suffix).toBe('abcd1234');
    expect(res.body.success).toBe(true);
  });

  it('calls generateDemo with userGoal, options, and { userEmail, registry, now }', async () => {
    await request(app)
      .post('/api/generate')
      .send({ userGoal: 'retail agent', options: { rowCount: 50 } });

    expect(services.generateDemo).toHaveBeenCalledOnce();
    const [goal, opts, deps] = services.generateDemo.mock.calls[0];
    expect(goal).toBe('retail agent');
    expect(opts).toMatchObject({ rowCount: 50 });
    expect(deps.userEmail).toBe('ce@example.com');
    expect(deps.registry).toBe(registry);
    expect(typeof deps.now).toBe('function');
  });

  it('does NOT call deinteractivize', async () => {
    await request(app)
      .post('/api/generate')
      .send({ userGoal: 'retail agent' });

    expect(services.deinteractivize).not.toHaveBeenCalled();
  });

  it('does NOT call jobRunner.runProvision', async () => {
    await request(app)
      .post('/api/generate')
      .send({ userGoal: 'retail agent' });

    // Flush any pending microtasks to be sure
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(services.jobRunner.runProvision).not.toHaveBeenCalled();
  });

  it('returns 400 when userGoal is missing', async () => {
    const res = await request(app)
      .post('/api/generate')
      .send({ options: {} });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/userGoal/i);
  });

  it('returns 400 when body is empty', async () => {
    const res = await request(app)
      .post('/api/generate')
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 503 when generateDemo is not configured', async () => {
    const unconfiguredApp = buildApp({ registry, authMiddleware: passThroughAuth, services: {} });
    const res = await request(unconfiguredApp)
      .post('/api/generate')
      .send({ userGoal: 'retail agent' });

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/build service not configured/i);
  });

  it('returns 401 when auth middleware rejects', async () => {
    const denyAuth = (req, res) => res.status(401).json({ error: 'denied' });
    const restrictedApp = buildApp({ registry, authMiddleware: denyAuth, services });
    const res = await request(restrictedApp)
      .post('/api/generate')
      .send({ userGoal: 'retail agent' });

    expect(res.status).toBe(401);
  });

  it('defaults options to {} when not provided', async () => {
    await request(app)
      .post('/api/generate')
      .send({ userGoal: 'retail agent' });

    const [, opts] = services.generateDemo.mock.calls[0];
    expect(opts).toEqual({});
  });
});
