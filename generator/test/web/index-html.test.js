/**
 * index-html.test.js
 *
 * Structural gate for the ported generator/web/index.html.
 * Checks:
 *   1. No <?= scriptlets remain (zero GAS template syntax).
 *   2. The rpc-facade.js script tag is present.
 *   3. Key DOM markers inserted during scriptlet resolution are present.
 *   4. GET / via supertest returns 200 and the body contains the markers.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { DemoRegistry } from '../../src/registry/registry.js';
import { MemoryStore } from '../../src/registry/memory-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexPath = join(__dirname, '..', '..', 'web', 'index.html');
const html = readFileSync(indexPath, 'utf8');

function passThroughAuth(req, res, next) {
  req.user = { email: 'test@example.com' };
  next();
}

describe('generator/web/index.html structural gate', () => {
  it('contains no GAS scriptlets (zero <?= occurrences)', () => {
    expect(html).not.toMatch(/<\?=/);
  });

  it('includes the rpc-facade.js script tag', () => {
    expect(html).toMatch(/src=["']rpc-facade\.js["']/);
  });

  it('contains id="appVersionLabel" (scriptlet @1299 resolved)', () => {
    expect(html).toContain('id="appVersionLabel"');
  });

  it('contains id="generatorModelLabel" (scriptlet @1945 resolved)', () => {
    expect(html).toContain('id="generatorModelLabel"');
  });

  it('declares GENERATOR_MODEL and CURRENT_USER_EMAIL as let (not const with scriptlet)', () => {
    expect(html).toMatch(/let GENERATOR_MODEL\s*=/);
    expect(html).toMatch(/let CURRENT_USER_EMAIL\s*=/);
  });

  it('contains a loadAppConfig() call in window.onload', () => {
    expect(html).toContain('loadAppConfig()');
  });
});

describe('GET / serves generator/web/index.html with 200', () => {
  it('returns 200 and the HTML body contains appVersionLabel', async () => {
    const registry = new DemoRegistry(new MemoryStore());
    const app = buildApp({ registry, authMiddleware: passThroughAuth, services: {} });

    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('id="appVersionLabel"');
  });

  it('returns 200 and the body contains rpc-facade.js reference', async () => {
    const registry = new DemoRegistry(new MemoryStore());
    const app = buildApp({ registry, authMiddleware: passThroughAuth, services: {} });

    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('rpc-facade.js');
  });
});
