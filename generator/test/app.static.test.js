/**
 * app.static.test.js
 *
 * Verifies that GET / serves the static UI from generator/web/index.html.
 *
 * U-2 delivered the real index.html — the test now asserts against markers
 * present in the ported file (appVersionLabel, rpc-facade.js) instead of
 * the WEBTEST placeholder used before U-2.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { DemoRegistry } from '../src/registry/registry.js';
import { MemoryStore } from '../src/registry/memory-store.js';

function passThroughAuth(req, res, next) {
  req.user = { email: 'test@example.com' };
  next();
}

describe('static UI serving', () => {
  it('GET / returns 200 and serves the ported generator/web/index.html', async () => {
    const registry = new DemoRegistry(new MemoryStore());
    const app = buildApp({ registry, authMiddleware: passThroughAuth, services: {} });

    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    // Markers from the U-2 ported file: scriptlet-resolution IDs and facade include.
    expect(res.text).toContain('id="appVersionLabel"');
    expect(res.text).toContain('rpc-facade.js');
  });
});
