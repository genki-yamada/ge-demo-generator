/**
 * demos-app.js
 *
 * Demo list + name-confirm cleanup UI logic.
 *
 * Design: pure helper functions are exported for unit-testing (no DOM required).
 * DOM wiring lives only in installDemosApp(), which is thin and not separately tested.
 *
 * Endpoints used:
 *   GET  /api/demos             → { demos }
 *   POST /api/demos/:id/cleanup → { demoId, state:'deleting' } | 400/409/503/404
 *   GET  /api/demos/:id         → { demo }
 *
 * Export / installation:
 *   installDemosApp({ doc, fetchImpl, pollInterval, autoLoad }) — dependency-injected for tests.
 *   In the browser the module self-installs with document / window.fetch.
 */

// ---------------------------------------------------------------------------
// State display label mapping (Japanese — display only, not data values)
// ---------------------------------------------------------------------------

/** @type {Record<string, string>} */
const STATE_LABELS = {
  building:     '構築中',
  active:       '稼働中',
  build_failed: '構築失敗',
  deleting:     '削除中',
  deleted:      '削除済み',
  delete_failed: '削除失敗',
};

/**
 * Return the Japanese display label for a raw state enum value.
 * Falls back to the raw value if not found.
 * @param {string} state
 * @returns {string}
 */
function stateLabel(state) {
  return STATE_LABELS[state] ?? state;
}

/**
 * Format an ISO timestamp into Japan Standard Time (Asia/Tokyo) for display.
 * Returns '' for empty input and the raw value for unparseable input.
 * Display only — the registry/API value stays ISO/UTC.
 * @param {string} iso
 * @returns {string}
 */
export function formatJst(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
  return parts + ' JST';
}

// ---------------------------------------------------------------------------
// Pure helper functions (exported for unit tests — no DOM dependency)
// ---------------------------------------------------------------------------

/**
 * Validate that the typed confirmation name matches the demo id.
 * Returns true only when they are identical non-empty strings.
 *
 * @param {string} typed   - Value typed by the user in the confirm input
 * @param {string} demoId  - The demo id to confirm against
 * @returns {boolean}
 */
export function validateConfirm(typed, demoId) {
  return typeof typed === 'string' && typed.length > 0 && typed === demoId;
}

/**
 * Build the fetch options object for POST /api/demos/:id/cleanup.
 *
 * @param {string} confirmName - The typed confirmation name
 * @returns {{ method: string, headers: object, body: string }}
 */
export function buildCleanupRequest(confirmName) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmName }),
  };
}

/**
 * Return the CSS class(es) for a given demo state badge.
 *
 * @param {string} state
 * @returns {string}
 */
export function stateBadgeClass(state) {
  const map = {
    building: 'badge-building',
    active: 'badge-active',
    build_failed: 'badge-failed',
    deleting: 'badge-deleting',
    deleted: 'badge-deleted',
    delete_failed: 'badge-delete-failed',
  };
  return map[state] ?? 'badge-unknown';
}

/**
 * Render a single table row for a demo object.
 * Returns an object { id, cells } where cells is an array of text values
 * (so tests can assert on content without a real DOM).
 *
 * @param {object} demo
 * @returns {{ id: string, cells: string[], state: string }}
 */
export function renderRowData(demo) {
  return {
    id: demo.id,
    state: demo.state,
    cells: [
      demo.id,
      demo.ownerCe ?? '',
      demo.goal ?? '',
      demo.state ?? '',
      demo.createdAt ?? '',
    ],
  };
}

// ---------------------------------------------------------------------------
// installDemosApp — DOM wiring (injectable for tests via minimal doc stub)
// ---------------------------------------------------------------------------

/**
 * Install the demos app on the given document.
 *
 * @param {object} [opts]
 * @param {object} [opts.doc=document]    - Target document (inject fake in tests)
 * @param {Function} [opts.fetchImpl]     - fetch implementation (inject fake in tests)
 * @param {number} [opts.pollInterval]    - ms between polls (default 3000; use >0 in browser)
 * @param {boolean} [opts.autoLoad=true]  - if true, calls loadDemos() on install
 * @returns {{ loadDemos: Function, startCleanup: Function, pollStatus: Function }}
 */
export function installDemosApp({
  doc = (typeof document !== 'undefined' ? document : null),
  fetchImpl = (typeof window !== 'undefined' ? window.fetch.bind(window) : null),
  pollInterval = 3000,
  autoLoad = true,
} = {}) {

  // ---- internal state -------------------------------------------------------

  /** @type {Map<string, object>} demoId → latest demo snapshot */
  const _demos = new Map();
  /** @type {Map<string, ReturnType<typeof setTimeout>>} active poll timers */
  const _polls = new Map();
  /** Currently pending confirm modal target */
  let _pendingId = null;

  // ---- DOM helpers ----------------------------------------------------------

  function el(id) { return doc && doc.getElementById(id); }

  function showToast(msg, isError = false) {
    const toast = el('toastArea');
    if (!toast) return;
    toast.textContent = msg;
    toast.className = 'toast ' + (isError ? 'toast-error' : 'toast-info');
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 4000);
  }

  function renderTable(demos) {
    const tbody = el('demosTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    tbody._children = [];
    if (!demos || demos.length === 0) {
      const tr = doc.createElement('tr');
      const td = doc.createElement('td');
      td.colSpan = 6;
      td.textContent = 'デモが見つかりません。';
      td.style.textAlign = 'center';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    demos.forEach(demo => {
      const row = renderRowData(demo);
      const tr = doc.createElement('tr');
      tr.dataset.demoId = demo.id;

      // id, ownerCe, goal
      row.cells.slice(0, 3).forEach(text => {
        const td = doc.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      });

      // state badge
      const stateTd = doc.createElement('td');
      const badge = doc.createElement('span');
      badge.className = 'badge ' + stateBadgeClass(demo.state);
      badge.textContent = stateLabel(demo.state);
      badge.id = `state-${demo.id}`;
      stateTd.appendChild(badge);
      tr.appendChild(stateTd);

      // createdAt
      const dateTd = doc.createElement('td');
      dateTd.textContent = formatJst(demo.createdAt);
      tr.appendChild(dateTd);

      // actions
      const actionTd = doc.createElement('td');
      const canDelete = demo.state !== 'building' && demo.state !== 'deleting' && demo.state !== 'deleted';

      if (canDelete) {
        const btn = doc.createElement('button');
        btn.className = 'btn-delete';
        btn.textContent = demo.state === 'delete_failed' ? '再クリーンアップ' : 'クリーンアップ';
        btn.dataset.demoId = demo.id;
        btn.addEventListener('click', () => openConfirmModal(demo.id));
        actionTd.appendChild(btn);
      } else if (demo.state === 'deleting') {
        const span = doc.createElement('span');
        span.textContent = '削除中...';
        actionTd.appendChild(span);
      }

      tr.appendChild(actionTd);
      tbody.appendChild(tr);
    });
  }

  function updateStateDisplay(demoId, state) {
    const badge = el(`state-${demoId}`);
    if (badge) {
      badge.className = 'badge ' + stateBadgeClass(state);
      badge.textContent = stateLabel(state);
    }

    // Update the action cell: find the row in tbody
    const tbody = el('demosTableBody');
    if (!tbody) return;
    const row = tbody.querySelector(`[data-demo-id="${demoId}"]`);
    if (!row) return;
    const cells = row.cells ?? row._children;
    if (!cells || cells.length === 0) return;
    const actionTd = cells[cells.length - 1];
    if (!actionTd) return;
    actionTd.innerHTML = '';
    actionTd._children = [];

    if (state === 'delete_failed') {
      const btn = doc.createElement('button');
      btn.className = 'btn-delete';
      btn.textContent = '再クリーンアップ';
      btn.dataset.demoId = demoId;
      btn.addEventListener('click', () => openConfirmModal(demoId));
      actionTd.appendChild(btn);
    } else if (state === 'deleting') {
      const span = doc.createElement('span');
      span.textContent = '削除中...';
      actionTd.appendChild(span);
    } else if (state !== 'building' && state !== 'deleted') {
      const btn = doc.createElement('button');
      btn.className = 'btn-delete';
      btn.textContent = 'クリーンアップ';
      btn.dataset.demoId = demoId;
      btn.addEventListener('click', () => openConfirmModal(demoId));
      actionTd.appendChild(btn);
    }
  }

  function openConfirmModal(demoId) {
    _pendingId = demoId;
    const modal = el('confirmModal');
    const input = el('confirmInput');
    const btn   = el('confirmBtn');
    const label = el('confirmLabel');
    if (label) label.textContent = `削除を確認するためにデモ ID を入力してください: ${demoId}`;
    if (input) { input.value = ''; }
    if (btn)   { btn.disabled = true; }
    if (modal) { modal.style.display = 'flex'; }
  }

  function closeConfirmModal() {
    _pendingId = null;
    const modal = el('confirmModal');
    if (modal) modal.style.display = 'none';
    const input = el('confirmInput');
    if (input) input.value = '';
  }

  // ---- core logic -----------------------------------------------------------

  /**
   * Load all demos from GET /api/demos and render the table.
   * Throws on HTTP error (!r.ok).
   * @returns {Promise<object[]>}
   */
  async function loadDemos() {
    const r = await fetchImpl('/api/demos');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const { demos } = await r.json();
    const list = demos ?? [];
    _demos.clear();
    list.forEach(d => _demos.set(d.id, d));
    renderTable(list);
    return list;
  }

  /**
   * Poll GET /api/demos/:id until state is terminal (deleted / delete_failed).
   * Updates the state badge on each tick.
   * On HTTP error: shows a toast and stops polling.
   *
   * @param {string} demoId
   * @returns {Promise<void>}
   */
  async function pollStatus(demoId) {
    // Clear any existing poll for this id
    if (_polls.has(demoId)) {
      clearTimeout(_polls.get(demoId));
      _polls.delete(demoId);
    }

    const tick = async () => {
      let r;
      try {
        r = await fetchImpl(`/api/demos/${demoId}`);
      } catch (fetchErr) {
        showToast('ポーリングエラー: ' + fetchErr.message, true);
        return;
      }

      if (!r.ok) {
        showToast('ポーリングエラー: HTTP ' + r.status, true);
        return;
      }

      let demo;
      try {
        const body = await r.json();
        demo = body.demo;
      } catch (parseErr) {
        showToast('ポーリングエラー: ' + parseErr.message, true);
        return;
      }

      if (!demo) {
        showToast('ポーリングエラー: レスポンスにデモ情報がありません', true);
        return;
      }

      _demos.set(demo.id, demo);
      updateStateDisplay(demo.id, demo.state);

      // Terminal states: stop polling
      if (demo.state === 'deleted' || demo.state === 'delete_failed') {
        _polls.delete(demoId);
        return;
      }

      // Schedule next tick (only if pollInterval > 0)
      if (pollInterval > 0) {
        const timer = setTimeout(() => { tick().catch(() => {}); }, pollInterval);
        _polls.set(demoId, timer);
      }
    };

    await tick();
  }

  /**
   * Perform cleanup POST for `demoId` after user has confirmed.
   * Only fires the POST if typed name === demoId (safety guard).
   * Starts polling on 202.
   *
   * @param {string} demoId
   * @param {string} typedName - value from the confirm input
   * @returns {Promise<void>}
   */
  async function startCleanup(demoId, typedName) {
    if (!validateConfirm(typedName, demoId)) {
      showToast('確認 ID が一致しません。クリーンアップを中止しました。', true);
      return;
    }

    let r;
    try {
      r = await fetchImpl(
        `/api/demos/${demoId}/cleanup`,
        buildCleanupRequest(typedName),
      );
    } catch (fetchErr) {
      showToast('クリーンアップエラー: ' + fetchErr.message, true);
      return;
    }

    if (!r.ok) {
      let errMsg = 'HTTP ' + r.status;
      try {
        const body = await r.json();
        if (body && body.error) errMsg = body.error;
      } catch (_) { /* ignore json parse error */ }
      showToast('クリーンアップに失敗しました: ' + errMsg, true);
      return;
    }

    // 202 accepted — update badge optimistically and start polling
    updateStateDisplay(demoId, 'deleting');
    await pollStatus(demoId);
  }

  // ---- event wiring (runs only if doc is available) -------------------------

  if (doc) {
    // Confirm input: enable/disable the confirm button based on match
    const confirmInputEl = el('confirmInput');
    if (confirmInputEl) {
      confirmInputEl.addEventListener('input', () => {
        const btn = el('confirmBtn');
        if (btn) btn.disabled = !validateConfirm(confirmInputEl.value, _pendingId);
      });
    }

    // Confirm button: submit cleanup
    const confirmBtnEl = el('confirmBtn');
    if (confirmBtnEl) {
      confirmBtnEl.addEventListener('click', async () => {
        const typed = el('confirmInput')?.value ?? '';
        const id = _pendingId;
        closeConfirmModal();
        await startCleanup(id, typed);
      });
    }

    // Cancel button: close modal
    const cancelBtnEl = el('cancelBtn');
    if (cancelBtnEl) {
      cancelBtnEl.addEventListener('click', closeConfirmModal);
    }

    // Optionally load demos on install (can be suppressed in tests)
    if (autoLoad) {
      loadDemos().catch(err => showToast('デモの読み込みに失敗しました: ' + err.message, true));
    }
  }

  return { loadDemos, startCleanup, pollStatus };
}

// Auto-install in a browser context (not during module tests where window/document is absent)
if (typeof document !== 'undefined') {
  installDemosApp();
}
