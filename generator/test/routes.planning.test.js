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

// ─── POST /api/regenerate-goal ────────────────────────────────────────────────

describe('POST /api/regenerate-goal', () => {
  let app;
  let services;

  beforeEach(() => {
    services = makeStubServices({
      regenerateGoal: vi.fn().mockResolvedValue({ success: true, goal: 'New scenario text' }),
    });
    app = buildApp({
      registry: new DemoRegistry(new MemoryStore()),
      authMiddleware: passThroughAuth,
      services,
    });
  });

  it('returns goal for valid companyInfo and selectedWorkflows', async () => {
    const companyInfo = { companyName: 'Acme', industry: 'Retail', companySummary: 'A retailer.' };
    const selectedWorkflows = [{ name: 'Inventory', reason: 'Automatable.' }];
    const res = await request(app)
      .post('/api/regenerate-goal')
      .send({ companyInfo, selectedWorkflows });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.goal).toBe('New scenario text');
  });

  it('calls regenerateGoal service with companyInfo and selectedWorkflows', async () => {
    const companyInfo = { companyName: 'Acme', industry: 'Retail', companySummary: 'A retailer.' };
    const selectedWorkflows = [{ name: 'Inventory', reason: 'Automatable.' }];
    await request(app)
      .post('/api/regenerate-goal')
      .send({ companyInfo, selectedWorkflows });

    expect(services.regenerateGoal).toHaveBeenCalledOnce();
    expect(services.regenerateGoal).toHaveBeenCalledWith(companyInfo, selectedWorkflows);
  });

  it('returns 400 when companyInfo is missing', async () => {
    const res = await request(app)
      .post('/api/regenerate-goal')
      .send({ selectedWorkflows: [{ name: 'W', reason: 'R' }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/companyInfo/i);
  });

  it('returns 400 when selectedWorkflows is missing', async () => {
    const res = await request(app)
      .post('/api/regenerate-goal')
      .send({ companyInfo: { companyName: 'Acme' } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/selectedWorkflows/i);
  });

  it('returns 400 when body is empty', async () => {
    const res = await request(app)
      .post('/api/regenerate-goal')
      .send({});

    expect(res.status).toBe(400);
  });

  it('passes through service failure as 200', async () => {
    services.regenerateGoal.mockResolvedValue({ success: false, error: 'AI failed' });
    const res = await request(app)
      .post('/api/regenerate-goal')
      .send({
        companyInfo: { companyName: 'Acme', industry: 'Retail', companySummary: 'A retailer.' },
        selectedWorkflows: [{ name: 'W', reason: 'R' }],
      });

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
      .post('/api/regenerate-goal')
      .send({
        companyInfo: { companyName: 'Acme', industry: 'Retail', companySummary: '' },
        selectedWorkflows: [{ name: 'W', reason: 'R' }],
      });

    expect(res.status).toBe(401);
  });
});

// ─── POST /api/update-instruction ────────────────────────────────────────────

describe('POST /api/update-instruction', () => {
  let app;
  let services;
  const UPDATED_SCRIPT = '#!/bin/bash\n# updated';

  beforeEach(() => {
    services = makeStubServices({
      updateInstruction: vi.fn().mockReturnValue(UPDATED_SCRIPT),
    });
    app = buildApp({
      registry: new DemoRegistry(new MemoryStore()),
      authMiddleware: passThroughAuth,
      services,
    });
  });

  it('returns { setupScript } for valid inputs', async () => {
    const res = await request(app)
      .post('/api/update-instruction')
      .send({
        setupScript: '#!/bin/bash\noriginal',
        businessInstruction: 'Business text.',
        technicalInstruction: 'Technical text.',
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('setupScript', UPDATED_SCRIPT);
  });

  it('calls updateInstruction with setupScript, businessInstruction, technicalInstruction', async () => {
    await request(app)
      .post('/api/update-instruction')
      .send({
        setupScript: 'original',
        businessInstruction: 'Biz.',
        technicalInstruction: 'Tech.',
      });

    expect(services.updateInstruction).toHaveBeenCalledOnce();
    expect(services.updateInstruction).toHaveBeenCalledWith('original', 'Biz.', 'Tech.');
  });

  it('returns 400 when setupScript is missing', async () => {
    const res = await request(app)
      .post('/api/update-instruction')
      .send({ businessInstruction: 'Biz.', technicalInstruction: 'Tech.' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/setupScript/i);
  });

  it('returns 400 when businessInstruction is missing', async () => {
    const res = await request(app)
      .post('/api/update-instruction')
      .send({ setupScript: 'original', technicalInstruction: 'Tech.' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/businessInstruction/i);
  });

  it('returns 400 when technicalInstruction is missing', async () => {
    const res = await request(app)
      .post('/api/update-instruction')
      .send({ setupScript: 'original', businessInstruction: 'Biz.' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/technicalInstruction/i);
  });

  it('returns 401 when auth middleware rejects', async () => {
    const denyAuth = (req, res) => res.status(401).json({ error: 'denied' });
    const restrictedApp = buildApp({
      registry: new DemoRegistry(new MemoryStore()),
      authMiddleware: denyAuth,
      services,
    });
    const res = await request(restrictedApp)
      .post('/api/update-instruction')
      .send({ setupScript: 'x', businessInstruction: 'y', technicalInstruction: 'z' });

    expect(res.status).toBe(401);
  });
});

// ─── GET /api/config ──────────────────────────────────────────────────────────

describe('GET /api/config', () => {
  let app;
  let services;

  beforeEach(() => {
    services = makeStubServices({
      appConfig: { appVersion: 'v10.100-public', model: 'gemini-3.5-flash' },
    });
    app = buildApp({
      registry: new DemoRegistry(new MemoryStore()),
      authMiddleware: passThroughAuth,
      services,
    });
  });

  it('returns { appVersion, model, userEmail } when authenticated', async () => {
    const res = await request(app).get('/api/config');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      appVersion: 'v10.100-public',
      model: 'gemini-3.5-flash',
      userEmail: 'ce@example.com',
    });
  });

  it('returns 401 when auth middleware rejects', async () => {
    const denyAuth = (req, res) => res.status(401).json({ error: 'denied' });
    const restrictedApp = buildApp({
      registry: new DemoRegistry(new MemoryStore()),
      authMiddleware: denyAuth,
      services,
    });
    const res = await request(restrictedApp).get('/api/config');
    expect(res.status).toBe(401);
  });

  it('returns empty/fallback appConfig when services.appConfig is not provided', async () => {
    const servicesWithoutConfig = makeStubServices();
    // appConfig not in makeStubServices default — omit it
    delete servicesWithoutConfig.appConfig;
    const appWithoutConfig = buildApp({
      registry: new DemoRegistry(new MemoryStore()),
      authMiddleware: passThroughAuth,
      services: servicesWithoutConfig,
    });
    const res = await request(appWithoutConfig).get('/api/config');
    // Should still return 200 with graceful empty/null values
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('userEmail', 'ce@example.com');
  });
});
