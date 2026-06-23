/**
 * demos-app.test.js
 *
 * Unit tests for generator/web/demos-app.js.
 *
 * Strategy: the pure helper exports (validateConfirm, buildCleanupRequest,
 * renderRowData, stateBadgeClass) are tested directly without any DOM.
 * For installDemosApp we supply a minimal DOM stub + fake fetch so we can
 * exercise loadDemos, startCleanup (confirm-match guard + POST body), pollStatus
 * (state transitions + terminal stop), retry on delete_failed, and HTTP-error
 * handling — all without jsdom or a real browser.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateConfirm,
  buildCleanupRequest,
  renderRowData,
  stateBadgeClass,
  installDemosApp,
} from '../../web/demos-app.js';

// ---------------------------------------------------------------------------
// Pure helper tests
// ---------------------------------------------------------------------------

describe('validateConfirm', () => {
  it('returns true when typed === demoId (non-empty)', () => {
    expect(validateConfirm('demo-acme-abc1', 'demo-acme-abc1')).toBe(true);
  });

  it('returns false when typed !== demoId', () => {
    expect(validateConfirm('wrong-id', 'demo-acme-abc1')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(validateConfirm('', 'demo-acme-abc1')).toBe(false);
  });

  it('returns false for null or undefined typed', () => {
    expect(validateConfirm(null, 'demo-acme-abc1')).toBe(false);
    expect(validateConfirm(undefined, 'demo-acme-abc1')).toBe(false);
  });

  it('returns false when demoId is empty (even if typed is empty)', () => {
    expect(validateConfirm('', '')).toBe(false);
  });
});

describe('buildCleanupRequest', () => {
  it('builds a POST JSON request with confirmName', () => {
    const req = buildCleanupRequest('demo-acme-abc1');
    expect(req.method).toBe('POST');
    expect(req.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(req.body)).toEqual({ confirmName: 'demo-acme-abc1' });
  });
});

describe('renderRowData', () => {
  it('returns id, state, and cells array', () => {
    const demo = {
      id: 'demo-acme-abc1',
      ownerCe: 'ce@example.com',
      goal: 'test goal',
      state: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const row = renderRowData(demo);
    expect(row.id).toBe('demo-acme-abc1');
    expect(row.state).toBe('active');
    expect(row.cells[0]).toBe('demo-acme-abc1');
    expect(row.cells[1]).toBe('ce@example.com');
    expect(row.cells[2]).toBe('test goal');
    expect(row.cells[3]).toBe('active');
    expect(row.cells[4]).toBe('2026-01-01T00:00:00.000Z');
  });

  it('uses empty strings for missing optional fields', () => {
    const row = renderRowData({ id: 'demo-x-1', state: 'building' });
    expect(row.cells[1]).toBe('');
    expect(row.cells[2]).toBe('');
    expect(row.cells[4]).toBe('');
  });
});

describe('stateBadgeClass', () => {
  it.each([
    ['building',      'badge-building'],
    ['active',        'badge-active'],
    ['build_failed',  'badge-failed'],
    ['deleting',      'badge-deleting'],
    ['deleted',       'badge-deleted'],
    ['delete_failed', 'badge-delete-failed'],
  ])('state "%s" → class "%s"', (state, cls) => {
    expect(stateBadgeClass(state)).toBe(cls);
  });

  it('returns badge-unknown for unrecognised state', () => {
    expect(stateBadgeClass('mystery')).toBe('badge-unknown');
  });
});

// ---------------------------------------------------------------------------
// DOM-stub helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal DOM stub sufficient for installDemosApp.
 * Implements getElementById and createElement with enough fidelity for the
 * tested paths. Not a full DOM — just what the app touches.
 */
function makeDomStub() {
  const elements = {};

  function makeEl(tag) {
    const el = {
      tag,
      id: null,
      className: '',
      textContent: '',
      innerHTML: '',
      style: {},
      dataset: {},
      disabled: false,
      value: '',
      colSpan: 1,
      cells: [],
      _listeners: {},
      _children: [],
      addEventListener(evt, fn) {
        if (!this._listeners[evt]) this._listeners[evt] = [];
        this._listeners[evt].push(fn);
      },
      dispatchEvent(evt) {
        const handlers = this._listeners[evt.type] ?? [];
        handlers.forEach(h => h(evt));
      },
      appendChild(child) {
        this._children.push(child);
        // For tr, maintain cells array
        if (this.tag === 'tr') this.cells.push(child);
      },
      querySelector(sel) {
        // Simple data-demo-id selector support
        const m = sel.match(/\[data-demo-id="([^"]+)"\]/);
        if (m) {
          return this._children.find(c =>
            c.dataset && c.dataset['demo-id'] === m[1]
          ) ?? null;
        }
        return null;
      },
    };
    return el;
  }

  // Pre-create the elements the app looks up by id
  const ids = [
    'demosTableBody', 'confirmModal', 'confirmInput', 'confirmBtn',
    'cancelBtn', 'confirmLabel', 'toastArea',
  ];
  ids.forEach(id => {
    const el = makeEl('div');
    el.id = id;
    elements[id] = el;
  });

  // demosTableBody is a tbody — give it a querySelector that walks _children
  elements.demosTableBody.querySelector = function(sel) {
    const m = sel.match(/\[data-demo-id="([^"]+)"\]/);
    if (!m) return null;
    return this._children.find(tr => tr.dataset && tr.dataset.demoId === m[1]) ?? null;
  };

  return {
    getElementById(id) { return elements[id] ?? null; },
    createElement(tag) { return makeEl(tag); },
    _elements: elements,
  };
}

/**
 * Build a fake fetch that can be configured per-call via a queue of responses.
 * Each entry is { ok, status, body } where body is the object to return as JSON.
 */
function makeFetch(responses = []) {
  let idx = 0;
  const fn = vi.fn((_url, _opts) => {
    const entry = responses[idx] ?? { ok: true, status: 200, body: {} };
    idx++;
    return Promise.resolve({
      ok: entry.ok,
      status: entry.status ?? (entry.ok ? 200 : 500),
      json: () => Promise.resolve(entry.body),
    });
  });
  return fn;
}

// ---------------------------------------------------------------------------
// installDemosApp — loadDemos
// ---------------------------------------------------------------------------

describe('installDemosApp – loadDemos', () => {
  it('calls GET /api/demos and renders rows for returned demos', async () => {
    const demos = [
      { id: 'demo-a-111', ownerCe: 'ce@x.com', goal: 'g1', state: 'active', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'demo-b-222', ownerCe: 'ce@y.com', goal: 'g2', state: 'building', createdAt: '2026-01-02T00:00:00.000Z' },
    ];
    const fetchImpl = makeFetch([{ ok: true, body: { demos } }]);
    const doc = makeDomStub();

    const app = installDemosApp({ doc, fetchImpl, pollInterval: 0, autoLoad: false });
    const result = await app.loadDemos();

    // fetch called for /api/demos
    expect(fetchImpl).toHaveBeenCalledWith('/api/demos');
    // returned demos
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('demo-a-111');
    // rows appended to tbody
    expect(doc._elements.demosTableBody._children).toHaveLength(2);
  });

  it('renders a "No demos found" row when demos array is empty', async () => {
    const fetchImpl = makeFetch([{ ok: true, body: { demos: [] } }]);
    const doc = makeDomStub();

    const app = installDemosApp({ doc, fetchImpl, pollInterval: 0, autoLoad: false });
    await app.loadDemos();

    const tbody = doc._elements.demosTableBody;
    expect(tbody._children).toHaveLength(1);
    const tdText = tbody._children[0]._children[0].textContent;
    expect(tdText).toBe('No demos found.');
  });

  it('throws (rejects) on non-ok response (!r.ok)', async () => {
    const fetchImpl = makeFetch([{ ok: false, status: 503, body: { error: 'down' } }]);
    const doc = makeDomStub();

    const app = installDemosApp({ doc, fetchImpl, pollInterval: 0, autoLoad: false });
    await expect(app.loadDemos()).rejects.toThrow('HTTP 503');
  });
});

// ---------------------------------------------------------------------------
// installDemosApp – startCleanup (confirm-match guard + POST body)
// ---------------------------------------------------------------------------

describe('installDemosApp – startCleanup', () => {
  it('does NOT call POST when typed name does not match demoId', async () => {
    const fetchImpl = makeFetch([]);
    const doc = makeDomStub();
    const app = installDemosApp({ doc, fetchImpl, pollInterval: 0, autoLoad: false });

    await app.startCleanup('demo-acme-abc1', 'wrong-name');

    // No fetch calls made
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('calls POST /api/demos/:id/cleanup with {confirmName: id} when names match', async () => {
    const demoId = 'demo-acme-abc1';
    const fetchImpl = makeFetch([
      { ok: true, status: 202, body: { demoId, state: 'deleting' } },    // cleanup
      { ok: true, status: 200, body: { demo: { id: demoId, state: 'deleted' } } }, // poll
    ]);
    const doc = makeDomStub();
    const app = installDemosApp({ doc, fetchImpl, pollInterval: 0, autoLoad: false });

    await app.startCleanup(demoId, demoId);

    const cleanupCall = fetchImpl.mock.calls[0];
    expect(cleanupCall[0]).toBe(`/api/demos/${demoId}/cleanup`);
    expect(cleanupCall[1].method).toBe('POST');
    expect(JSON.parse(cleanupCall[1].body)).toEqual({ confirmName: demoId });
  });

  it('shows toast and does not poll when server returns 409', async () => {
    const demoId = 'demo-acme-abc1';
    const fetchImpl = makeFetch([
      { ok: false, status: 409, body: { error: 'cleanup already in progress' } },
    ]);
    const doc = makeDomStub();
    const app = installDemosApp({ doc, fetchImpl, pollInterval: 0, autoLoad: false });

    await app.startCleanup(demoId, demoId);

    // Only one fetch call (cleanup POST) — no poll
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // Toast shown with error
    expect(doc._elements.toastArea.textContent).toContain('cleanup already in progress');
  });

  it('shows toast and does not poll when server returns 400', async () => {
    const demoId = 'demo-acme-abc1';
    const fetchImpl = makeFetch([
      { ok: false, status: 400, body: { error: 'confirmName must match the demo id' } },
    ]);
    const doc = makeDomStub();
    const app = installDemosApp({ doc, fetchImpl, pollInterval: 0, autoLoad: false });

    await app.startCleanup(demoId, demoId);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(doc._elements.toastArea.textContent).toContain('confirmName must match');
  });

  it('shows toast and does not poll when server returns 503', async () => {
    const demoId = 'demo-acme-abc1';
    const fetchImpl = makeFetch([
      { ok: false, status: 503, body: { error: 'cleanup service not configured' } },
    ]);
    const doc = makeDomStub();
    const app = installDemosApp({ doc, fetchImpl, pollInterval: 0, autoLoad: false });

    await app.startCleanup(demoId, demoId);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(doc._elements.toastArea.textContent).toContain('cleanup service not configured');
  });
});

// ---------------------------------------------------------------------------
// installDemosApp – pollStatus (state transitions + terminal stop)
// ---------------------------------------------------------------------------

describe('installDemosApp – pollStatus', () => {
  it('polls GET /api/demos/:id and stops when state becomes "deleted"', async () => {
    const demoId = 'demo-acme-abc1';
    // Single response that is already terminal
    const fetchImpl = makeFetch([
      { ok: true, body: { demo: { id: demoId, state: 'deleted' } } },
    ]);
    const doc = makeDomStub();
    const app = installDemosApp({ doc, fetchImpl, pollInterval: 0, autoLoad: false });

    await app.pollStatus(demoId);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(`/api/demos/${demoId}`);
  });

  it('stops polling when state becomes "delete_failed"', async () => {
    const demoId = 'demo-acme-abc1';
    const fetchImpl = makeFetch([
      { ok: true, body: { demo: { id: demoId, state: 'delete_failed' } } },
    ]);
    const doc = makeDomStub();
    const app = installDemosApp({ doc, fetchImpl, pollInterval: 0, autoLoad: false });

    await app.pollStatus(demoId);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('transitions through deleting → deleted in two poll ticks (pollInterval=0)', async () => {
    // pollInterval=0 means we schedule next tick via setTimeout(tick, 0).
    // We use two responses: first deleting, second deleted.
    const demoId = 'demo-acme-abc1';
    const fetchImpl = makeFetch([
      { ok: true, body: { demo: { id: demoId, state: 'deleting' } } },
      { ok: true, body: { demo: { id: demoId, state: 'deleted' } } },
    ]);
    const doc = makeDomStub();
    // Use pollInterval=1 so we can flush timers manually
    const app = installDemosApp({ doc, fetchImpl, pollInterval: 1, autoLoad: false });

    // Start poll — first tick resolves synchronously due to await in tick()
    const pollPromise = app.pollStatus(demoId);

    // Flush the pending microtask queue + timeout
    await new Promise(resolve => setTimeout(resolve, 50));
    await pollPromise;

    // Both ticks fired
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('shows toast and stops on HTTP error during poll', async () => {
    const demoId = 'demo-acme-abc1';
    const fetchImpl = makeFetch([
      { ok: false, status: 500, body: { error: 'server error' } },
    ]);
    const doc = makeDomStub();
    const app = installDemosApp({ doc, fetchImpl, pollInterval: 0, autoLoad: false });

    await app.pollStatus(demoId);

    // No further polling after error
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(doc._elements.toastArea.textContent).toContain('Poll error');
  });
});

// ---------------------------------------------------------------------------
// installDemosApp – retry on delete_failed
// ---------------------------------------------------------------------------

describe('installDemosApp – retry on delete_failed', () => {
  it('allows a second startCleanup call (retry) after delete_failed', async () => {
    const demoId = 'demo-acme-abc1';
    const fetchImpl = makeFetch([
      // First attempt — fails
      { ok: true, status: 202, body: { demoId, state: 'deleting' } },
      { ok: true, body: { demo: { id: demoId, state: 'delete_failed' } } },
      // Second attempt (retry) — succeeds
      { ok: true, status: 202, body: { demoId, state: 'deleting' } },
      { ok: true, body: { demo: { id: demoId, state: 'deleted' } } },
    ]);
    const doc = makeDomStub();
    const app = installDemosApp({ doc, fetchImpl, pollInterval: 0, autoLoad: false });

    await app.startCleanup(demoId, demoId);
    await app.startCleanup(demoId, demoId);

    // Four fetch calls total: 2 POSTs + 2 polls
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const calls = fetchImpl.mock.calls.map(c => c[0]);
    expect(calls[0]).toBe(`/api/demos/${demoId}/cleanup`);
    expect(calls[1]).toBe(`/api/demos/${demoId}`);
    expect(calls[2]).toBe(`/api/demos/${demoId}/cleanup`);
    expect(calls[3]).toBe(`/api/demos/${demoId}`);
  });
});

// ---------------------------------------------------------------------------
// installDemosApp – HTTP error (!r.ok) in loadDemos + startCleanup
// ---------------------------------------------------------------------------

describe('installDemosApp – HTTP error handling', () => {
  it('loadDemos rejects with "HTTP 503" on non-ok response', async () => {
    const fetchImpl = makeFetch([{ ok: false, status: 503, body: {} }]);
    const doc = makeDomStub();
    const app = installDemosApp({ doc, fetchImpl, pollInterval: 0, autoLoad: false });

    await expect(app.loadDemos()).rejects.toThrow('HTTP 503');
  });

  it('startCleanup shows toast "Cleanup failed: HTTP 404" for 404 with no error field', async () => {
    const demoId = 'demo-acme-abc1';
    const fetchImpl = makeFetch([{ ok: false, status: 404, body: {} }]);
    const doc = makeDomStub();
    const app = installDemosApp({ doc, fetchImpl, pollInterval: 0, autoLoad: false });

    await app.startCleanup(demoId, demoId);

    expect(doc._elements.toastArea.textContent).toContain('HTTP 404');
  });
});
