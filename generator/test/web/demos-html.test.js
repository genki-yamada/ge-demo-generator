/**
 * demos-html.test.js
 *
 * Structural gate for generator/web/demos.html.
 * Checks:
 *   1. GET /demos.html via Supertest returns 200.
 *   2. The body contains the required DOM marker ids (demosTable, confirmModal,
 *      confirmInput, confirmBtn, demos-app.js script include).
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
const demosHtmlPath = join(__dirname, '..', '..', 'web', 'demos.html');
const html = readFileSync(demosHtmlPath, 'utf8');

function passThroughAuth(req, res, next) {
  req.user = { email: 'test@example.com' };
  next();
}

// ── Static file content checks ─────────────────────────────────────────────

describe('generator/web/demos.html structural markers', () => {
  it('contains id="demosTable" (list table)', () => {
    expect(html).toContain('id="demosTable"');
  });

  it('contains id="demosTableBody" (tbody for rows)', () => {
    expect(html).toContain('id="demosTableBody"');
  });

  it('contains id="confirmModal" (name-confirm modal)', () => {
    expect(html).toContain('id="confirmModal"');
  });

  it('contains id="confirmInput" (typed-name input)', () => {
    expect(html).toContain('id="confirmInput"');
  });

  it('contains id="confirmBtn" (confirm execute button)', () => {
    expect(html).toContain('id="confirmBtn"');
  });

  it('includes demos-app.js script tag', () => {
    expect(html).toMatch(/src=["']demos-app\.js["']/);
  });

  it('loads demos-app.js as a module', () => {
    expect(html).toMatch(/type=["']module["'][^>]*src=["']demos-app\.js["']|src=["']demos-app\.js["'][^>]*type=["']module["']/);
  });
});

// ── Supertest serving check ────────────────────────────────────────────────

describe('GET /demos.html is served with 200 by express.static', () => {
  it('returns 200 and the body contains demosTable marker', async () => {
    const registry = new DemoRegistry(new MemoryStore());
    const app = buildApp({ registry, authMiddleware: passThroughAuth, services: {} });

    const res = await request(app).get('/demos.html');
    expect(res.status).toBe(200);
    expect(res.text).toContain('id="demosTable"');
  });

  it('returns 200 and the body contains confirmModal marker', async () => {
    const registry = new DemoRegistry(new MemoryStore());
    const app = buildApp({ registry, authMiddleware: passThroughAuth, services: {} });

    const res = await request(app).get('/demos.html');
    expect(res.status).toBe(200);
    expect(res.text).toContain('id="confirmModal"');
  });

  it('returns 200 and the body contains demos-app.js reference', async () => {
    const registry = new DemoRegistry(new MemoryStore());
    const app = buildApp({ registry, authMiddleware: passThroughAuth, services: {} });

    const res = await request(app).get('/demos.html');
    expect(res.status).toBe(200);
    expect(res.text).toContain('demos-app.js');
  });
});
