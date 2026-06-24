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

/**
 * Build a stub services object with vi.fn() stubs.
 * generateDemo returns the minimal shape the POST handler needs.
 */
function makeStubServices(overrides = {}) {
  const generateDemo = vi.fn().mockResolvedValue({
    demoId: 'demo-x-abcd1234',
    setupScript: '#!/bin/bash\necho hello',
    suffix: 'abcd1234',
    domainName: 'x',
    success: true,
  });
  const deinteractivize = vi.fn((s) => s + '\n# headless');
  const runProvision = vi.fn().mockResolvedValue({ ok: true });
  const jobRunner = { runProvision };
  // Per-request secret store factory (W-B): makeSecretStore(demoSuffix) → { putSecret }.
  // We share ONE putSecret spy across requests so tests can assert on it, while
  // recording the suffix each factory call received.
  const putSecret = vi.fn().mockResolvedValue(undefined);
  const makeSecretStore = vi.fn((demoSuffix) => ({ demoSuffix, putSecret }));
  const research = vi.fn().mockResolvedValue({ success: true, companyName: 'Acme' });
  const optimizeGoal = vi.fn().mockResolvedValue({ success: true, optimizedGoal: 'refined goal' });
  const analyzeMcp = vi.fn().mockResolvedValue({ success: true, data: { is_supported: true } });
  const now = vi.fn().mockReturnValue(NOW);
  const scriptStore = {
    save: vi.fn().mockResolvedValue('gs://test-bucket/scripts/demo-x-abcd1234.sh'),
    saveHeadless: vi.fn().mockResolvedValue('gs://test-bucket/scripts/demo-x-abcd1234-headless.sh'),
    envRef: vi.fn((demoId) => `gs://test-bucket/envs/${demoId}.env`),
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
    ...overrides,
  };
}

// ─── POST /api/demos ──────────────────────────────────────────────────────────

describe('POST /api/demos — build start', () => {
  let app;
  let registry;
  let services;

  beforeEach(() => {
    registry = new DemoRegistry(new MemoryStore());
    services = makeStubServices();
    app = buildApp({ registry, authMiddleware: passThroughAuth, services });
  });

  it('returns 202 with {demoId, state:"building"} on valid request', async () => {
    const res = await request(app)
      .post('/api/demos')
      .send({ userGoal: 'Build a retail agent' });

    expect(res.status).toBe(202);
    expect(res.body.demoId).toBe('demo-x-abcd1234');
    expect(res.body.state).toBe('building');
  });

  it('returns 400 when userGoal is missing', async () => {
    const res = await request(app)
      .post('/api/demos')
      .send({ options: {} });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/userGoal/i);
  });

  it('returns 400 when body is empty', async () => {
    const res = await request(app)
      .post('/api/demos')
      .send({});

    expect(res.status).toBe(400);
  });

  it('calls generateDemo with userGoal, options, and userEmail dep', async () => {
    await request(app)
      .post('/api/demos')
      .send({ userGoal: 'retail agent', options: { rowCount: 50 } });

    expect(services.generateDemo).toHaveBeenCalledOnce();
    const [goal, opts, deps] = services.generateDemo.mock.calls[0];
    expect(goal).toBe('retail agent');
    expect(opts).toMatchObject({ rowCount: 50 });
    expect(deps.userEmail).toBe('ce@example.com');
  });

  it('calls deinteractivize with the setupScript', async () => {
    await request(app)
      .post('/api/demos')
      .send({ userGoal: 'agent' });

    expect(services.deinteractivize).toHaveBeenCalledOnce();
    expect(services.deinteractivize.mock.calls[0][0]).toBe('#!/bin/bash\necho hello');
  });

  it('kicks runProvision asynchronously (resolves after response)', async () => {
    // runProvision is called fire-and-forget; flush microtasks then check
    const res = await request(app)
      .post('/api/demos')
      .send({ userGoal: 'agent' });

    expect(res.status).toBe(202);

    // Flush pending microtasks
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(services.jobRunner.runProvision).toHaveBeenCalledOnce();
    const arg = services.jobRunner.runProvision.mock.calls[0][0];
    expect(arg.demo.id).toBe('demo-x-abcd1234');
  });

  it('passes now as a FUNCTION (not a string) to runProvision', async () => {
    // Guards Fix 1: the route must pass the callable, not the invoked result.
    // job-runner calls now() internally; passing a string would throw TypeError.
    await request(app)
      .post('/api/demos')
      .send({ userGoal: 'agent' });

    // Flush microtasks so the fire-and-forget Promise.resolve().then(...) runs
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(services.jobRunner.runProvision).toHaveBeenCalledOnce();
    const arg = services.jobRunner.runProvision.mock.calls[0][0];
    expect(typeof arg.now).toBe('function');
  });

  it('builds a per-request secretStore with result.suffix and putSecret for each credential', async () => {
    await request(app)
      .post('/api/demos')
      .send({
        userGoal: 'agent',
        options: {
          credentials: { SLACK_TOKEN: 'xoxb-123', GITHUB_PAT: 'ghp_abc' },
        },
      });

    // Flush microtasks in case putSecret was delayed (it shouldn't be, but be safe)
    await Promise.resolve();

    // makeSecretStore must be invoked with the demo's suffix (from generateDemo result).
    expect(services.makeSecretStore).toHaveBeenCalledOnce();
    expect(services.makeSecretStore.mock.calls[0][0]).toBe('abcd1234');

    // The store returned by the factory must receive each credential.
    const store = services.makeSecretStore.mock.results[0].value;
    expect(store.putSecret).toHaveBeenCalledTimes(2);
    const keys = store.putSecret.mock.calls.map((c) => c[0]);
    expect(keys).toContain('SLACK_TOKEN');
    expect(keys).toContain('GITHUB_PAT');
  });

  it('does not build a secretStore or call putSecret when no credentials', async () => {
    await request(app)
      .post('/api/demos')
      .send({ userGoal: 'agent' });

    expect(services.makeSecretStore).not.toHaveBeenCalled();
  });

  it('returns 401 when auth middleware rejects', async () => {
    const denyAuth = (req, res) => res.status(401).json({ error: 'denied' });
    const restrictedApp = buildApp({ registry, authMiddleware: denyAuth, services });
    const res = await request(restrictedApp)
      .post('/api/demos')
      .send({ userGoal: 'agent' });

    expect(res.status).toBe(401);
  });

  it('returns 503 when build services are not configured (generateDemo absent)', async () => {
    // Guard: honest 503 instead of TypeError→500 when server.js wiring is not yet done.
    const unconfiguredApp = buildApp({ registry, authMiddleware: passThroughAuth, services: {} });
    const res = await request(unconfiguredApp)
      .post('/api/demos')
      .send({ userGoal: 'agent' });

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/build service not configured/i);
  });

  it('calls scriptStore.save with demoId and setupScript after generateDemo', async () => {
    await request(app)
      .post('/api/demos')
      .send({ userGoal: 'agent' });

    expect(services.scriptStore.save).toHaveBeenCalledOnce();
    const [demoId, scriptText] = services.scriptStore.save.mock.calls[0];
    expect(demoId).toBe('demo-x-abcd1234');
    expect(scriptText).toBe('#!/bin/bash\necho hello');
  });

  it('calls registry.setScriptUri with demoId and the GCS URI after save', async () => {
    // Pre-register the demo so setScriptUri can find it (generateDemo stub does not
    // write to the registry itself).
    await registry.register({
      domain: 'x',
      suffix: 'abcd1234',
      ownerCe: 'ce@example.com',
      goal: 'agent',
      now: NOW,
    });

    await request(app)
      .post('/api/demos')
      .send({ userGoal: 'agent' });

    const demo = await registry.get('demo-x-abcd1234');
    expect(demo?.scriptGcsUri).toBe('gs://test-bucket/scripts/demo-x-abcd1234.sh');
  });

  it('tolerates scriptStore.save failure — still returns 202', async () => {
    services.scriptStore.save.mockRejectedValueOnce(new Error('GCS unavailable'));
    const res = await request(app)
      .post('/api/demos')
      .send({ userGoal: 'agent' });

    expect(res.status).toBe(202);
    expect(res.body.demoId).toBe('demo-x-abcd1234');
    expect(res.body.state).toBe('building');
  });

  it('calls scriptStore.saveHeadless with demoId and the deinteractivized script', async () => {
    await request(app)
      .post('/api/demos')
      .send({ userGoal: 'agent' });

    // Flush microtasks so saveHeadless (which precedes runProvision) completes
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(services.scriptStore.saveHeadless).toHaveBeenCalledOnce();
    const [demoId, headlessText] = services.scriptStore.saveHeadless.mock.calls[0];
    expect(demoId).toBe('demo-x-abcd1234');
    // deinteractivize stub appends '\n# headless'
    expect(headlessText).toBe('#!/bin/bash\necho hello\n# headless');
  });

  it('passes the GCS URI (not script text) as scriptRef to runProvision', async () => {
    await request(app)
      .post('/api/demos')
      .send({ userGoal: 'agent' });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(services.jobRunner.runProvision).toHaveBeenCalledOnce();
    const arg = services.jobRunner.runProvision.mock.calls[0][0];
    // scriptRef must be the GCS URI, not the ~600KB script text
    expect(arg.scriptRef).toBe('gs://test-bucket/scripts/demo-x-abcd1234-headless.sh');
    expect(arg.scriptRef).toMatch(/^gs:\/\//);
  });

  it('passes envRef from scriptStore.envRef(demoId) to runProvision', async () => {
    await request(app)
      .post('/api/demos')
      .send({ userGoal: 'agent' });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(services.jobRunner.runProvision).toHaveBeenCalledOnce();
    const arg = services.jobRunner.runProvision.mock.calls[0][0];
    // envRef must equal what scriptStore.envRef returned for the demoId
    expect(arg.envRef).toBe(services.scriptStore.envRef('demo-x-abcd1234'));
    expect(arg.envRef).toBe('gs://test-bucket/envs/demo-x-abcd1234.env');
  });

  it('tolerates scriptStore.saveHeadless failure — still kicks runProvision with fallback', async () => {
    services.scriptStore.saveHeadless.mockRejectedValueOnce(new Error('GCS write fail'));
    const res = await request(app)
      .post('/api/demos')
      .send({ userGoal: 'agent' });

    expect(res.status).toBe(202);

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // runProvision still called; scriptRef falls back to the raw headless text
    expect(services.jobRunner.runProvision).toHaveBeenCalledOnce();
  });
});

// ─── GET /api/demos/:id/status ────────────────────────────────────────────────

describe('GET /api/demos/:id/status', () => {
  let app;
  let registry;

  beforeEach(async () => {
    registry = new DemoRegistry(new MemoryStore());
    await registry.register({
      domain: 'retail',
      suffix: 'abc123',
      ownerCe: 'ce@example.com',
      goal: 'retail agent',
      now: NOW,
    });
    app = buildApp({ registry, authMiddleware: passThroughAuth, services: makeStubServices() });
  });

  it('returns state for a known demo id', async () => {
    const res = await request(app).get('/api/demos/demo-retail-abc123/status');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('demo-retail-abc123');
    expect(res.body.state).toBe('building');
  });

  it('returns 404 for an unknown demo id', async () => {
    const res = await request(app).get('/api/demos/demo-unknown-xyz/status');

    expect(res.status).toBe(404);
  });

  it('includes updatedAt in the response', async () => {
    const res = await request(app).get('/api/demos/demo-retail-abc123/status');

    expect(res.status).toBe(200);
    expect(res.body.updatedAt).toBe(NOW);
  });
});
