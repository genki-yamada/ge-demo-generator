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
  const runProvision = vi.fn().mockResolvedValue({ ok: true });
  const jobRunner = { runProvision };
  const deinteractivize = vi.fn((s) => s + '\n# headless');
  const scriptStore = {
    fetch: vi.fn().mockResolvedValue('#!/bin/bash\necho hi'),
    saveHeadless: vi.fn().mockResolvedValue('gs://b/scripts/demo-x-abcd1234-headless.sh'),
    envRef: vi.fn((demoId) => `gs://b/envs/${demoId}.env`),
  };
  const now = vi.fn().mockReturnValue(NOW);
  return { jobRunner, deinteractivize, scriptStore, now, ...overrides };
}

// Register a fresh demo in `building` state and return its id.
async function seedBuildingDemo(registry) {
  const demo = await registry.register({
    domain: 'x', suffix: 'abcd1234', ownerCe: 'ce@example.com', now: NOW,
  });
  return demo.id; // demo-x-abcd1234
}

describe('POST /api/demos/:id/provision — cloud auto-execution', () => {
  let app, registry, services;

  beforeEach(() => {
    registry = new DemoRegistry(new MemoryStore());
    services = makeStubServices();
    app = buildApp({ registry, authMiddleware: passThroughAuth, services });
  });

  it('202s and kicks runProvision with scriptRef + envRef for a building demo', async () => {
    const id = await seedBuildingDemo(registry);
    const res = await request(app).post(`/api/demos/${id}/provision`).send({});
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ demoId: id, state: 'building' });

    // fire-and-forget — let the microtask run
    await new Promise((r) => setTimeout(r, 0));
    expect(services.scriptStore.fetch).toHaveBeenCalledWith(id);
    expect(services.deinteractivize).toHaveBeenCalled();
    expect(services.scriptStore.saveHeadless).toHaveBeenCalledWith(id, expect.stringContaining('# headless'));
    expect(services.scriptStore.envRef).toHaveBeenCalledWith(id);
    expect(services.jobRunner.runProvision).toHaveBeenCalledTimes(1);
    const arg = services.jobRunner.runProvision.mock.calls[0][0];
    expect(arg.demo.id).toBe(id);
    expect(arg.scriptRef).toBe('gs://b/scripts/demo-x-abcd1234-headless.sh');
    expect(arg.envRef).toBe(`gs://b/envs/${id}.env`);
    expect(typeof arg.now).toBe('function');
  });

  it('404 when the demo does not exist', async () => {
    const res = await request(app).post('/api/demos/demo-missing-00000000/provision').send({});
    expect(res.status).toBe(404);
    expect(services.jobRunner.runProvision).not.toHaveBeenCalled();
  });

  it('409 when the demo is not in building state', async () => {
    const id = await seedBuildingDemo(registry);
    await registry.transition(id, 'active', NOW);
    const res = await request(app).post(`/api/demos/${id}/provision`).send({});
    expect(res.status).toBe(409);
    expect(services.jobRunner.runProvision).not.toHaveBeenCalled();
  });

  it('503 when provision services are not configured', async () => {
    const bare = buildApp({ registry, authMiddleware: passThroughAuth, services: {} });
    const id = await seedBuildingDemo(registry);
    const res = await request(bare).post(`/api/demos/${id}/provision`).send({});
    expect(res.status).toBe(503);
  });

  it('409 when the saved setup script is unavailable', async () => {
    const id = await seedBuildingDemo(registry);
    services.scriptStore.fetch.mockRejectedValueOnce(new Error('not found'));
    const res = await request(app).post(`/api/demos/${id}/provision`).send({});
    expect(res.status).toBe(409);
    expect(services.jobRunner.runProvision).not.toHaveBeenCalled();
  });
});
