/**
 * rpc-facade.js
 *
 * Provides window.google.script.run with GAS-equivalent semantics so the
 * ported index.html works against the Express backend without modification.
 *
 * Semantics:
 *   - google.script.run is a getter that returns a fresh runner on every access
 *     (matches GAS: you cannot re-use a runner for concurrent calls).
 *   - runner.withSuccessHandler(cb) / runner.withFailureHandler(cb) store the
 *     callback and return the same runner for chaining.
 *   - Unknown chain methods (e.g. withUserObject) are proxied to return the
 *     runner so they are safe no-ops.
 *   - Each server function dispatches a fetch and calls the stored handler.
 *
 * Endpoint map (9 entries):
 *   researchCompanyByDomain(domain)                     POST /api/research          {domain}
 *   optimizeGoalWithMagicWand(rawGoal)                   POST /api/optimize-goal     {rawGoal}
 *   regenerateGoalForWorkflows(companyInfo, workflows)   POST /api/regenerate-goal   {companyInfo, selectedWorkflows}
 *   generateDemo(userGoal, options)                      POST /api/generate          {userGoal, options}
 *   updateSystemInstruction(s, b, t)                     POST /api/update-instruction {setupScript,businessInstruction,technicalInstruction}
 *                                                        → unwraps data.setupScript (UI expects a plain string)
 *   analyzeMcpRepository(repoUrl)                        POST /api/mcp/analyze       {repoUrl}
 *   checkSpreadsheet()                                   STUB → onSuccess({success:false}) immediately
 *   logDirect(...args)                                   STUB → no-op (never calls onSuccess/onFailure)
 *   generatePdfFromServer(fileContent, fileName)         STUB → onSuccess({success:false, error:'PDF generation not available'})
 *
 * Config bootstrap:
 *   loadAppConfig() → GET /api/config → {appVersion, model, userEmail}
 *   Stored in window.__APP_CONFIG__ and applied to DOM labels.
 *
 * Export / installation:
 *   installRpcFacade({ win, fetchImpl }) — dependency-injected for testing.
 *   In the browser the module self-installs with window / window.fetch.
 */

/**
 * Install the google.script.run facade and the loadAppConfig helper on `win`.
 *
 * @param {object} [opts]
 * @param {object} [opts.win=window]           - Target global object (inject fake in tests)
 * @param {Function} [opts.fetchImpl]          - fetch implementation (inject fake in tests)
 */
export function installRpcFacade({ win = window, fetchImpl = window.fetch.bind(window) } = {}) {

  // ---- internal helper -------------------------------------------------------

  /**
   * Make a POST JSON fetch and dispatch to the runner's stored handlers.
   *
   * @param {object} runner
   * @param {string} url
   * @param {object} body
   * @param {Function} [transform]  - Optional transform applied to the resolved data
   *                                  before calling onSuccess.
   */
  function dispatch(runner, url, body, transform) {
    fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(r => r.json())
      .then(data => {
        const result = transform ? transform(data) : data;
        if (runner._onSuccess) runner._onSuccess(result);
      })
      .catch(err => {
        if (runner._onFailure) runner._onFailure(err);
      });
  }

  // ---- runner factory --------------------------------------------------------

  function makeRunner() {
    const runner = {
      _onSuccess: null,
      _onFailure: null,

      withSuccessHandler(cb) {
        this._onSuccess = cb;
        return this;
      },

      withFailureHandler(cb) {
        this._onFailure = cb;
        return this;
      },

      // ----- server functions -------------------------------------------------

      researchCompanyByDomain(domain) {
        dispatch(this, '/api/research', { domain });
      },

      optimizeGoalWithMagicWand(rawGoal) {
        dispatch(this, '/api/optimize-goal', { rawGoal });
      },

      regenerateGoalForWorkflows(companyInfo, selectedWorkflows) {
        dispatch(this, '/api/regenerate-goal', { companyInfo, selectedWorkflows });
      },

      generateDemo(userGoal, options) {
        dispatch(this, '/api/generate', { userGoal, options });
      },

      updateSystemInstruction(setupScript, businessInstruction, technicalInstruction) {
        dispatch(
          this,
          '/api/update-instruction',
          { setupScript, businessInstruction, technicalInstruction },
          data => data.setupScript,   // UI expects the plain script string, not the wrapper object
        );
      },

      analyzeMcpRepository(repoUrl) {
        dispatch(this, '/api/mcp/analyze', { repoUrl });
      },

      // ----- stubs (no fetch) -------------------------------------------------

      checkSpreadsheet() {
        // Spreadsheet integration is deprecated in the ported app.
        // Report "not connected" immediately so the diagnostic indicator shows
        // the expected non-connected state without crashing.
        const onSuccess = this._onSuccess;
        if (onSuccess) setTimeout(() => onSuccess({ success: false }), 0);
      },

      logDirect(/* ...args */) {
        // Server-side logging is a no-op in the ported app.
        // Intentionally does not call onSuccess or onFailure.
      },

      generatePdfFromServer(/* fileContent, fileName */) {
        // Server-side PDF generation is not yet implemented in the Express backend.
        // Return a structured failure so the UI's error path is exercised instead
        // of crashing.  A real /api/pdf endpoint is a deferred follow-up.
        const onSuccess = this._onSuccess;
        if (onSuccess) {
          setTimeout(() => onSuccess({ success: false, error: 'PDF generation not available' }), 0);
        }
      },
    };

    // Wrap runner in a Proxy so that:
    //  - Known functions are called with `target` as this (they use target._onSuccess etc.)
    //    but their return value is re-mapped: when they return `this` (target), substitute
    //    the proxy so callers get back the proxy for further chaining.
    //  - Unknown properties return a function that returns the proxy (safe no-op for
    //    unrecognised chain methods like withUserObject).
    const proxy = new Proxy(runner, {
      get(target, prop, receiverProxy) {
        const value = prop in target ? target[prop] : undefined;
        if (typeof value === 'function') {
          return function (...args) {
            const ret = value.apply(target, args);
            // If the function returned the raw target (chaining return), give back the proxy.
            return ret === target ? receiverProxy : ret;
          };
        }
        if (value !== undefined) return value;
        // Unknown property: return a function that returns the proxy (safe no-op)
        return (..._args) => receiverProxy;
      },
    });
    return proxy;
  }

  // ---- google.script.run installation ----------------------------------------

  // Define google.script.run as a getter so every access produces a fresh runner.
  // This matches GAS semantics (each call chain gets its own handler slots).
  if (!win.google) {
    win.google = {};
  }
  if (!win.google.script) {
    win.google.script = {};
  }

  Object.defineProperty(win.google.script, 'run', {
    get() { return makeRunner(); },
    configurable: true,
    enumerable: true,
  });

  // ---- config bootstrap -------------------------------------------------------

  /**
   * Fetch /api/config and return {appVersion, model, userEmail}.
   * Also stores the result in win.__APP_CONFIG__ and updates DOM labels
   * (if present) after the initial render with defaults.
   *
   * @returns {Promise<{appVersion:string|null, model:string|null, userEmail:string|null}>}
   */
  win.loadAppConfig = async function loadAppConfig() {
    const cfg = await fetchImpl('/api/config').then(r => r.json());
    win.__APP_CONFIG__ = cfg;

    // Update DOM version label (scriptlet @1299)
    const versionEl = win.document && win.document.getElementById('appVersionLabel');
    if (versionEl && cfg.appVersion) {
      versionEl.textContent = cfg.appVersion;
    }

    // Update DOM model label (scriptlet @1945)
    const modelEl = win.document && win.document.getElementById('generatorModelLabel');
    if (modelEl && cfg.model) {
      modelEl.textContent = cfg.model;
    }

    // Update JS variables exposed on window (scriptlets @2532, @2533)
    if (cfg.model)     win.GENERATOR_MODEL     = cfg.model;
    if (cfg.userEmail) win.CURRENT_USER_EMAIL   = cfg.userEmail;

    return cfg;
  };
}

// Auto-install in a browser context (not during module tests where window is absent)
if (typeof window !== 'undefined') {
  installRpcFacade();
}
