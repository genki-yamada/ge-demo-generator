import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { DemoRegistry } from '../src/registry/registry.js';
import { MemoryStore } from '../src/registry/memory-store.js';

const NOW = '2026-06-25T00:00:00.000Z';

function passThroughAuth(req, res, next) {
  req.user = { email: 'ce@example.com' };
  next();
}

function makeStubServices(overrides = {}) {
  const registerToGe = vi.fn().mockResolvedValue({ demoId: undefined, agentId: '123', alreadyRegistered: false });
  const geRegistrar = { registerToGe };
  const now = vi.fn().mockReturnValue(NOW);
  return { geRegistrar, config: { agentRegion: 'us-central1' }, now, ...overrides };
}

// Register a fresh demo in `building` state, then transition it to `active`.
async function seedActiveDemo(registry) {
  const demo = await registry.register({
    domain: 'x', suffix: 'abcd1234', ownerCe: 'ce@example.com', now: NOW,
  });
  await registry.transition(demo.id, 'active', NOW);
  return demo.id; // demo-x-abcd1234
}

describe('POST /api/demos/:id/register-ge — GE registration', () => {
  let app, registry, services;

  beforeEach(() => {
    registry = new DemoRegistry(new MemoryStore());
    services = makeStubServices();
    app = buildApp({ registry, authMiddleware: passThroughAuth, services });
  });

  it('200 with {demoId, agentId, alreadyRegistered:false} for an active demo', async () => {
    const id = await seedActiveDemo(registry);
    services.geRegistrar.registerToGe.mockResolvedValueOnce({ demoId: id, agentId: '123', alreadyRegistered: false });
    const res = await request(app).post(`/api/demos/${id}/register-ge`).send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ demoId: id, agentId: '123', alreadyRegistered: false });
    expect(services.geRegistrar.registerToGe).toHaveBeenCalledWith({ demoId: id, region: 'us-central1' });
  });

  it('200 with alreadyRegistered:true passthrough', async () => {
    const id = await seedActiveDemo(registry);
    services.geRegistrar.registerToGe.mockResolvedValueOnce({ demoId: id, agentId: 'existing-agent', alreadyRegistered: true });
    const res = await request(app).post(`/api/demos/${id}/register-ge`).send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ demoId: id, agentId: 'existing-agent', alreadyRegistered: true });
    expect(services.geRegistrar.registerToGe).toHaveBeenCalledWith({ demoId: id, region: 'us-central1' });
  });

  it('503 when geRegistrar is not configured', async () => {
    const bare = buildApp({ registry, authMiddleware: passThroughAuth, services: {} });
    const id = await seedActiveDemo(registry);
    const res = await request(bare).post(`/api/demos/${id}/register-ge`).send({});
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'GE registration not configured' });
  });

  it('404 when demo does not exist', async () => {
    const res = await request(app).post('/api/demos/demo-missing-00000000/register-ge').send({});
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not found' });
    expect(services.geRegistrar.registerToGe).not.toHaveBeenCalled();
  });

  it('409 when demo is not active (building state)', async () => {
    const demo = await registry.register({
      domain: 'y', suffix: 'bbbb1234', ownerCe: 'ce@example.com', now: NOW,
    });
    // demo starts in building state — do NOT transition to active
    const res = await request(app).post(`/api/demos/${demo.id}/register-ge`).send({});
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'cannot register in state: building' });
    expect(services.geRegistrar.registerToGe).not.toHaveBeenCalled();
  });

  it('500 when registerToGe rejects', async () => {
    const id = await seedActiveDemo(registry);
    services.geRegistrar.registerToGe.mockRejectedValueOnce(new Error('GE API unavailable'));
    const res = await request(app).post(`/api/demos/${id}/register-ge`).send({});
    expect(res.status).toBe(500);
    expect(services.geRegistrar.registerToGe).toHaveBeenCalled();
  });
});
