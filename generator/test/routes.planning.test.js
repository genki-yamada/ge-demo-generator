import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { DemoRegistry } from '../src/registry/registry.js';
import { MemoryStore } from '../src/registry/memory-store.js';

function passThroughAuth(req, res, next) {
  req.user = { email: 'ce@example.com' };
  next();
}

function makeStubServices(overrides = {}) {
  return {
    generateDemo: vi.fn(),
    deinteractivize: vi.fn((s) => s),
    jobRunner: { runProvision: vi.fn().mockResolvedValue({ ok: true }) },
    secretStore: { putSecret: vi.fn().mockResolvedValue(undefined) },
    research: vi.fn().mockResolvedValue({ success: true, companyName: 'Acme' }),
    optimizeGoal: vi.fn().mockResolvedValue({ success: true, optimizedGoal: 'refined' }),
    analyzeMcp: vi.fn().mockResolvedValue({ success: true, data: { is_supported: true } }),
    now: vi.fn().mockReturnValue('2026-06-22T00:00:00.000Z'),
    ...overrides,
  };
}

// ─── POST /api/research ───────────────────────────────────────────────────────

describe('POST /api/research', () => {
  let app;
  let services;

  beforeEach(() => {
    services = makeStubServices();
    app = buildApp({
      registry: new DemoRegistry(new MemoryStore()),
      authMiddleware: passThroughAuth,
      services,
    });
  });

  it('returns research result for valid domain', async () => {
    const res = await request(app)
      .post('/api/research')
      .send({ domain: 'toyota.co.jp' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.companyName).toBe('Acme');
  });

  it('calls research service with the domain', async () => {
    await request(app)
      .post('/api/research')
      .send({ domain: 'toyota.co.jp' });

    expect(services.research).toHaveBeenCalledOnce();
    expect(services.research).toHaveBeenCalledWith('toyota.co.jp');
  });

  it('returns 400 when domain is missing', async () => {
    const res = await request(app)
      .post('/api/research')
      .send({ other: 'field' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/domain/i);
  });

  it('returns 400 when body is empty', async () => {
    const res = await request(app)
      .post('/api/research')
      .send({});

    expect(res.status).toBe(400);
  });

  it('passes through service failure response (success:false) as 200', async () => {
    services.research.mockResolvedValue({ success: false, error: 'not found' });
    const res = await request(app)
      .post('/api/research')
      .send({ domain: 'notfound.example' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('not found');
  });

  it('returns 401 when auth middleware rejects', async () => {
    const denyAuth = (req, res) => res.status(401).json({ error: 'denied' });
    const restrictedApp = buildApp({
      registry: new DemoRegistry(new MemoryStore()),
      authMiddleware: denyAuth,
      services,
    });
    const res = await request(restrictedApp)
      .post('/api/research')
      .send({ domain: 'toyota.co.jp' });

    expect(res.status).toBe(401);
  });
});

// ─── POST /api/optimize-goal ──────────────────────────────────────────────────

describe('POST /api/optimize-goal', () => {
  let app;
  let services;

  beforeEach(() => {
    services = makeStubServices();
    app = buildApp({
      registry: new DemoRegistry(new MemoryStore()),
      authMiddleware: passThroughAuth,
      services,
    });
  });

  it('returns optimized goal for valid rawGoal', async () => {
    const res = await request(app)
      .post('/api/optimize-goal')
      .send({ rawGoal: 'build a retail agent' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.optimizedGoal).toBe('refined');
  });

  it('calls optimizeGoal service with rawGoal', async () => {
    await request(app)
      .post('/api/optimize-goal')
      .send({ rawGoal: 'build a retail agent' });

    expect(services.optimizeGoal).toHaveBeenCalledOnce();
    expect(services.optimizeGoal).toHaveBeenCalledWith('build a retail agent');
  });

  it('returns 400 when rawGoal is missing', async () => {
    const res = await request(app)
      .post('/api/optimize-goal')
      .send({ other: 'field' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rawGoal/i);
  });

  it('passes through service failure response as 200', async () => {
    services.optimizeGoal.mockResolvedValue({ success: false, error: 'AI failed' });
    const res = await request(app)
      .post('/api/optimize-goal')
      .send({ rawGoal: 'whatever' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
  });
});

// ─── POST /api/mcp/analyze ────────────────────────────────────────────────────

describe('POST /api/mcp/analyze', () => {
  let app;
  let services;

  beforeEach(() => {
    services = makeStubServices();
    app = buildApp({
      registry: new DemoRegistry(new MemoryStore()),
      authMiddleware: passThroughAuth,
      services,
    });
  });

  it('returns analysis result for valid repoUrl', async () => {
    const res = await request(app)
      .post('/api/mcp/analyze')
      .send({ repoUrl: 'https://github.com/example/mcp-server' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.is_supported).toBe(true);
  });

  it('calls analyzeMcp service with repoUrl', async () => {
    await request(app)
      .post('/api/mcp/analyze')
      .send({ repoUrl: 'https://github.com/example/mcp-server' });

    expect(services.analyzeMcp).toHaveBeenCalledOnce();
    expect(services.analyzeMcp).toHaveBeenCalledWith('https://github.com/example/mcp-server');
  });

  it('returns 400 when repoUrl is missing', async () => {
    const res = await request(app)
      .post('/api/mcp/analyze')
      .send({ other: 'field' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/repoUrl/i);
  });

  it('passes through service failure response as 200', async () => {
    services.analyzeMcp.mockResolvedValue({ success: false, message: 'Invalid GitHub URL' });
    const res = await request(app)
      .post('/api/mcp/analyze')
      .send({ repoUrl: 'https://github.com/example/mcp-server' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 when auth middleware rejects', async () => {
    const denyAuth = (req, res) => res.status(401).json({ error: 'denied' });
    const restrictedApp = buildApp({
      registry: new DemoRegistry(new MemoryStore()),
      authMiddleware: denyAuth,
      services,
    });
    const res = await request(restrictedApp)
      .post('/api/mcp/analyze')
      .send({ repoUrl: 'https://github.com/example/mcp-server' });

    expect(res.status).toBe(401);
  });
});
