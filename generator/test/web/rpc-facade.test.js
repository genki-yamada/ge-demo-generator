/**
 * rpc-facade.test.js
 *
 * Unit-tests for generator/web/rpc-facade.js.
 * Uses a fake window and fake fetch — no real network, no DOM.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installRpcFacade } from '../../web/rpc-facade.js';

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/**
 * Build a minimal fake window and a controlled fetchImpl.
 * fetchImpl is a vi.fn() that resolves with the given JSON payload by default.
 *
 * @param {object} [jsonResponse] - The object that fetch resolves to.
 */
function setup(jsonResponse = {}) {
  const win = {
    document: {
      getElementById: vi.fn(() => null),
    },
  };

  const fetchImpl = vi.fn(() =>
    Promise.resolve({
      json: () => Promise.resolve(jsonResponse),
    }),
  );

  installRpcFacade({ win, fetchImpl });

  return { win, fetchImpl };
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('installRpcFacade', () => {
  describe('google.script.run getter — fresh runner per access', () => {
    it('returns a different runner on each access (independence)', () => {
      const { win } = setup();
      const r1 = win.google.script.run;
      const r2 = win.google.script.run;
      expect(r1).not.toBe(r2);
    });

    it('handlers on one runner do not leak to another runner (no cross-contamination)', async () => {
      const { win, fetchImpl } = setup({ domain: 'ok' });

      const cb1 = vi.fn();
      const cb2 = vi.fn();

      // Two concurrent calls — each runner gets its own handler.
      win.google.script.run.withSuccessHandler(cb1).researchCompanyByDomain('a.com');
      win.google.script.run.withSuccessHandler(cb2).researchCompanyByDomain('b.com');

      // Wait for both fetches to resolve.
      await new Promise(r => setTimeout(r, 0));

      expect(cb1).toHaveBeenCalledOnce();
      expect(cb2).toHaveBeenCalledOnce();
    });
  });

  describe('withSuccessHandler / withFailureHandler chaining', () => {
    it('withSuccessHandler returns the runner (chainable)', () => {
      const { win } = setup();
      const run = win.google.script.run;
      const cb = vi.fn();
      expect(run.withSuccessHandler(cb)).toBe(run);
    });

    it('withFailureHandler returns the runner (chainable)', () => {
      const { win } = setup();
      const run = win.google.script.run;
      const cb = vi.fn();
      expect(run.withFailureHandler(cb)).toBe(run);
    });

    it('unknown chain method (e.g. withUserObject) returns the runner', () => {
      const { win } = setup();
      const run = win.google.script.run;
      expect(run.withUserObject({ id: 1 })).toBe(run);
    });
  });

  // ---- RPC 1: researchCompanyByDomain ----------------------------------------
  describe('researchCompanyByDomain', () => {
    it('POSTs to /api/research with {domain} and passes data to onSuccess', async () => {
      const payload = { success: true, companyName: 'Acme' };
      const { win, fetchImpl } = setup(payload);

      const cb = vi.fn();
      win.google.script.run.withSuccessHandler(cb).researchCompanyByDomain('acme.com');

      await new Promise(r => setTimeout(r, 0));

      expect(fetchImpl).toHaveBeenCalledWith('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: 'acme.com' }),
      });
      expect(cb).toHaveBeenCalledWith(payload);
    });

    it('calls onFailure on network error', async () => {
      const win = { document: { getElementById: vi.fn(() => null) } };
      const fetchImpl = vi.fn(() => Promise.reject(new Error('net fail')));
      installRpcFacade({ win, fetchImpl });

      const onFailure = vi.fn();
      win.google.script.run
        .withFailureHandler(onFailure)
        .researchCompanyByDomain('fail.com');

      await new Promise(r => setTimeout(r, 0));
      expect(onFailure).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // ---- RPC 2: optimizeGoalWithMagicWand --------------------------------------
  describe('optimizeGoalWithMagicWand', () => {
    it('POSTs to /api/optimize-goal with {rawGoal}', async () => {
      const payload = { success: true, optimizedGoal: 'Better goal' };
      const { win, fetchImpl } = setup(payload);

      const cb = vi.fn();
      win.google.script.run.withSuccessHandler(cb).optimizeGoalWithMagicWand('raw goal text');

      await new Promise(r => setTimeout(r, 0));

      expect(fetchImpl).toHaveBeenCalledWith('/api/optimize-goal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawGoal: 'raw goal text' }),
      });
      expect(cb).toHaveBeenCalledWith(payload);
    });
  });

  // ---- RPC 3: regenerateGoalForWorkflows -------------------------------------
  describe('regenerateGoalForWorkflows', () => {
    it('POSTs to /api/regenerate-goal with {companyInfo, selectedWorkflows}', async () => {
      const companyInfo = { companyName: 'Acme', industry: 'Retail' };
      const workflows = ['crm', 'logistics'];
      const payload = { success: true, goal: 'New goal' };
      const { win, fetchImpl } = setup(payload);

      const cb = vi.fn();
      win.google.script.run
        .withSuccessHandler(cb)
        .regenerateGoalForWorkflows(companyInfo, workflows);

      await new Promise(r => setTimeout(r, 0));

      expect(fetchImpl).toHaveBeenCalledWith('/api/regenerate-goal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyInfo, selectedWorkflows: workflows }),
      });
      expect(cb).toHaveBeenCalledWith(payload);
    });
  });

  // ---- RPC 4: generateDemo ---------------------------------------------------
  describe('generateDemo', () => {
    it('POSTs to /api/generate with {userGoal, options}', async () => {
      const payload = { success: true, setupScript: '#!/bin/bash' };
      const { win, fetchImpl } = setup(payload);

      const opts = { mcpList: [] };
      const cb = vi.fn();
      win.google.script.run
        .withSuccessHandler(cb)
        .generateDemo('my goal', opts);

      await new Promise(r => setTimeout(r, 0));

      expect(fetchImpl).toHaveBeenCalledWith('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userGoal: 'my goal', options: opts }),
      });
      expect(cb).toHaveBeenCalledWith(payload);
    });

    it('calls onFailure when fetch rejects', async () => {
      const win = { document: { getElementById: vi.fn(() => null) } };
      const fetchImpl = vi.fn(() => Promise.reject(new Error('timeout')));
      installRpcFacade({ win, fetchImpl });

      const onFailure = vi.fn();
      win.google.script.run.withFailureHandler(onFailure).generateDemo('g', {});

      await new Promise(r => setTimeout(r, 0));
      expect(onFailure).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // ---- RPC 5: updateSystemInstruction ----------------------------------------
  describe('updateSystemInstruction', () => {
    it('POSTs to /api/update-instruction and unwraps data.setupScript', async () => {
      const newScript = '#!/bin/bash\necho hello';
      const serverResponse = { setupScript: newScript };
      const { win, fetchImpl } = setup(serverResponse);

      const cb = vi.fn();
      win.google.script.run
        .withSuccessHandler(cb)
        .updateSystemInstruction('old script', 'biz instr', 'tech instr');

      await new Promise(r => setTimeout(r, 0));

      expect(fetchImpl).toHaveBeenCalledWith('/api/update-instruction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          setupScript: 'old script',
          businessInstruction: 'biz instr',
          technicalInstruction: 'tech instr',
        }),
      });
      // UI handler expects the plain script string, not the wrapper object
      expect(cb).toHaveBeenCalledWith(newScript);
    });
  });

  // ---- RPC 6: analyzeMcpRepository -------------------------------------------
  describe('analyzeMcpRepository', () => {
    it('POSTs to /api/mcp/analyze with {repoUrl}', async () => {
      const payload = { success: true, data: { is_supported: true } };
      const { win, fetchImpl } = setup(payload);

      const cb = vi.fn();
      win.google.script.run
        .withSuccessHandler(cb)
        .analyzeMcpRepository('https://github.com/org/mcp-server');

      await new Promise(r => setTimeout(r, 0));

      expect(fetchImpl).toHaveBeenCalledWith('/api/mcp/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: 'https://github.com/org/mcp-server' }),
      });
      expect(cb).toHaveBeenCalledWith(payload);
    });
  });

  // ---- RPC 7: checkSpreadsheet (stub) ----------------------------------------
  describe('checkSpreadsheet (stub)', () => {
    it('does not fetch and calls onSuccess with {success:false}', async () => {
      const { win, fetchImpl } = setup();

      const cb = vi.fn();
      win.google.script.run.withSuccessHandler(cb).checkSpreadsheet();

      await new Promise(r => setTimeout(r, 0));

      expect(fetchImpl).not.toHaveBeenCalled();
      expect(cb).toHaveBeenCalledWith({ success: false });
    });
  });

  // ---- RPC 8: logDirect (stub / no-op) ----------------------------------------
  describe('logDirect (stub)', () => {
    it('does not fetch and does not call onSuccess or onFailure', async () => {
      const { win, fetchImpl } = setup();

      const onSuccess = vi.fn();
      const onFailure = vi.fn();
      win.google.script.run
        .withSuccessHandler(onSuccess)
        .withFailureHandler(onFailure)
        .logDirect('warn', 'some message');

      await new Promise(r => setTimeout(r, 0));

      expect(fetchImpl).not.toHaveBeenCalled();
      expect(onSuccess).not.toHaveBeenCalled();
      expect(onFailure).not.toHaveBeenCalled();
    });

    it('does not throw when called with no handlers', () => {
      const { win } = setup();
      expect(() => win.google.script.run.logDirect('info', 'msg')).not.toThrow();
    });
  });

  // ---- RPC 9: generatePdfFromServer (stub) -----------------------------------
  describe('generatePdfFromServer (stub)', () => {
    it('does not fetch and calls onSuccess with {success:false, error:...}', async () => {
      const { win, fetchImpl } = setup();

      const cb = vi.fn();
      win.google.script.run
        .withSuccessHandler(cb)
        .generatePdfFromServer('csv,data', 'report.pdf');

      await new Promise(r => setTimeout(r, 0));

      expect(fetchImpl).not.toHaveBeenCalled();
      expect(cb).toHaveBeenCalledWith({
        success: false,
        error: 'PDF generation not available',
      });
    });
  });

  // ---- loadAppConfig ---------------------------------------------------------
  describe('loadAppConfig', () => {
    it('GETs /api/config and returns {appVersion, model, userEmail}', async () => {
      const cfg = { appVersion: 'v1.2.3', model: 'gemini-pro', userEmail: 'user@example.com' };
      const win = { document: { getElementById: vi.fn(() => null) } };
      const fetchImpl = vi.fn(() =>
        Promise.resolve({ json: () => Promise.resolve(cfg) }),
      );
      installRpcFacade({ win, fetchImpl });

      const result = await win.loadAppConfig();

      expect(fetchImpl).toHaveBeenCalledWith('/api/config');
      expect(result).toEqual(cfg);
    });

    it('stores result in win.__APP_CONFIG__', async () => {
      const cfg = { appVersion: 'v0.1', model: 'gemini-flash', userEmail: 'a@b.com' };
      const win = { document: { getElementById: vi.fn(() => null) } };
      const fetchImpl = vi.fn(() =>
        Promise.resolve({ json: () => Promise.resolve(cfg) }),
      );
      installRpcFacade({ win, fetchImpl });

      await win.loadAppConfig();
      expect(win.__APP_CONFIG__).toEqual(cfg);
    });

    it('updates DOM elements and window variables when config arrives', async () => {
      const cfg = { appVersion: 'v2', model: 'gemini-2.0', userEmail: 'x@y.com' };
      const versionEl = { textContent: '' };
      const modelEl = { textContent: '' };
      const win = {
        document: {
          getElementById: vi.fn(id => {
            if (id === 'appVersionLabel') return versionEl;
            if (id === 'generatorModelLabel') return modelEl;
            return null;
          }),
        },
      };
      const fetchImpl = vi.fn(() =>
        Promise.resolve({ json: () => Promise.resolve(cfg) }),
      );
      installRpcFacade({ win, fetchImpl });

      await win.loadAppConfig();

      expect(versionEl.textContent).toBe('v2');
      expect(modelEl.textContent).toBe('gemini-2.0');
      expect(win.GENERATOR_MODEL).toBe('gemini-2.0');
      expect(win.CURRENT_USER_EMAIL).toBe('x@y.com');
    });
  });
});
