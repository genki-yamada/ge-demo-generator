/**
 * app.static.test.js
 *
 * Verifies that GET / serves the static UI from generator/web/index.html.
 * Guard: only creates/removes the temp file if generator/web/index.html did NOT
 * already exist, so a real U-2 asset is never clobbered.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync, writeFileSync, unlinkSync, rmdirSync } from 'fs';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { DemoRegistry } from '../src/registry/registry.js';
import { MemoryStore } from '../src/registry/memory-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webDir    = join(__dirname, '..', 'web');
const indexHtml = join(webDir, 'index.html');

const TEMP_CONTENT = '<!doctype html><title>WEBTEST</title>';

let createdDir   = false;
let createdFile  = false;

function passThroughAuth(req, res, next) {
  req.user = { email: 'test@example.com' };
  next();
}

beforeAll(() => {
  if (!existsSync(webDir)) {
    mkdirSync(webDir, { recursive: true });
    createdDir = true;
  }
  if (!existsSync(indexHtml)) {
    writeFileSync(indexHtml, TEMP_CONTENT, 'utf8');
    createdFile = true;
  }
});

afterAll(() => {
  if (createdFile && existsSync(indexHtml)) {
    unlinkSync(indexHtml);
  }
  if (createdDir && existsSync(webDir)) {
    // Only remove if empty (don't accidentally remove a directory with other files)
    try { rmdirSync(webDir); } catch { /* non-empty; leave it */ }
  }
});

describe('static UI serving', () => {
  it('GET / returns 200 and serves generator/web/index.html when present', async () => {
    const registry = new DemoRegistry(new MemoryStore());
    const app = buildApp({ registry, authMiddleware: passThroughAuth, services: {} });

    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('WEBTEST');
  });
});
