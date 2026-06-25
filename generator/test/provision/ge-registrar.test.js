import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeGeRegistrar } from '../../src/provision/ge-registrar.js';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const CONFIG = {
  projectId: 'ge-work-osaka',
  agentRegion: 'us-central1',
  geProjectNumber: '504753788734',
  geAppId: 'osaka-work-yamada_1782323841039',
  geLocation: 'global',
};

const DEMO_ID = 'demo-acme-001';
const REGION = 'us-central1';
const SERVICE_URI = 'https://demo-acme-001-abc123-uc.a.run.app';

const DE_SA_EMAIL =
  `service-${CONFIG.geProjectNumber}@gcp-sa-discoveryengine.iam.gserviceaccount.com`;

/** Async token stub — always resolves to "tok". */
const getToken = vi.fn().mockResolvedValue('tok');

/**
 * Build a minimal fetch-compatible mock that returns a single crafted Response.
 *
 * @param {object} opts
 * @param {boolean} [opts.ok=true]
 * @param {number}  [opts.status=200]
 * @param {object|null} [opts.jsonBody]   - value returned by res.json()
 * @param {string}  [opts.textBody='']   - value returned by res.text()
 */
function makeFetch({ ok = true, status = 200, jsonBody = null, textBody = '' } = {}) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: vi.fn().mockResolvedValue(jsonBody),
    text: vi.fn().mockResolvedValue(textBody),
  });
}

/**
 * Build a fetchImpl that returns different responses for sequential calls.
 * Each element in `responses` is passed to makeFetch.
 */
function makeMultiFetch(responses) {
  let idx = 0;
  return vi.fn().mockImplementation(() => {
    const opts = responses[idx] ?? responses[responses.length - 1];
    idx++;
    const res = {
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      json: vi.fn().mockResolvedValue(opts.jsonBody ?? null),
      text: vi.fn().mockResolvedValue(opts.textBody ?? ''),
    };
    return Promise.resolve(res);
  });
}

// ---------------------------------------------------------------------------
// setIngressAll
// ---------------------------------------------------------------------------

describe('makeGeRegistrar / setIngressAll', () => {
  it('does NOT PATCH and returns changed:false when ingress is already INGRESS_TRAFFIC_ALL', async () => {
    const fetchImpl = makeFetch({
      ok: true,
      status: 200,
      jsonBody: { ingress: 'INGRESS_TRAFFIC_ALL', uri: SERVICE_URI },
    });
    const registrar = makeGeRegistrar({ getToken, fetchImpl, config: CONFIG });

    const result = await registrar.setIngressAll(DEMO_ID, REGION);

    expect(result.changed).toBe(false);
    expect(result.uri).toBe(SERVICE_URI);
    // Only the GET call was issued — no PATCH
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toContain(`/services/${DEMO_ID}`);
    expect(url).not.toContain('updateMask');
  });

  it('PATCHes with updateMask=ingress and body ingress=INGRESS_TRAFFIC_ALL when ingress is internal', async () => {
    const fetchImpl = makeMultiFetch([
      // First call: GET — service has internal ingress
      { ok: true, status: 200, jsonBody: { ingress: 'INGRESS_TRAFFIC_INTERNAL_ONLY', uri: SERVICE_URI } },
      // Second call: PATCH — succeeds
      { ok: true, status: 200, jsonBody: {} },
    ]);
    const registrar = makeGeRegistrar({ getToken, fetchImpl, config: CONFIG });

    const result = await registrar.setIngressAll(DEMO_ID, REGION);

    expect(result.changed).toBe(true);
    expect(result.uri).toBe(SERVICE_URI);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    // Verify PATCH call shape
    const [patchUrl, patchOpts] = fetchImpl.mock.calls[1];
    expect(patchUrl).toContain('updateMask=ingress');
    expect(patchOpts.method).toBe('PATCH');
    const patchBody = JSON.parse(patchOpts.body);
    expect(patchBody.ingress).toBe('INGRESS_TRAFFIC_ALL');
  });

  it('returns the service uri from the GET response', async () => {
    const fetchImpl = makeFetch({
      ok: true,
      status: 200,
      jsonBody: { ingress: 'INGRESS_TRAFFIC_ALL', uri: SERVICE_URI },
    });
    const registrar = makeGeRegistrar({ getToken, fetchImpl, config: CONFIG });

    const result = await registrar.setIngressAll(DEMO_ID, REGION);
    expect(result.uri).toBe(SERVICE_URI);
  });

  it('attaches Authorization Bearer token on the GET call', async () => {
    const fetchImpl = makeFetch({
      ok: true,
      status: 200,
      jsonBody: { ingress: 'INGRESS_TRAFFIC_ALL', uri: SERVICE_URI },
    });
    const registrar = makeGeRegistrar({ getToken, fetchImpl, config: CONFIG });

    await registrar.setIngressAll(DEMO_ID, REGION);

    const [, opts] = fetchImpl.mock.calls[0];
    expect(opts.headers.Authorization).toBe('Bearer tok');
  });

  it('throws when GET returns non-ok', async () => {
    const fetchImpl = makeFetch({ ok: false, status: 403, textBody: 'Forbidden' });
    const registrar = makeGeRegistrar({ getToken, fetchImpl, config: CONFIG });

    await expect(registrar.setIngressAll(DEMO_ID, REGION)).rejects.toThrow('403');
  });
});

// ---------------------------------------------------------------------------
// grantInvokerToDeSa
// ---------------------------------------------------------------------------

describe('makeGeRegistrar / grantInvokerToDeSa', () => {
  it('returns changed:false and does NOT call setIamPolicy when DE SA is already in invoker binding', async () => {
    const existingPolicy = {
      bindings: [
        {
          role: 'roles/run.invoker',
          members: [`serviceAccount:${DE_SA_EMAIL}`, 'serviceAccount:other@example.com'],
        },
      ],
      etag: 'etag-abc',
    };
    const fetchImpl = makeFetch({ ok: true, status: 200, jsonBody: existingPolicy });
    const registrar = makeGeRegistrar({ getToken, fetchImpl, config: CONFIG });

    const result = await registrar.grantInvokerToDeSa(DEMO_ID, REGION);

    expect(result.changed).toBe(false);
    // Only getIamPolicy was called — no setIamPolicy
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toContain(':getIamPolicy');
    // Cloud Run Admin v2 binds :getIamPolicy as GET (POST → 404).
    expect(opts?.method).toBe('GET');
  });

  it('calls setIamPolicy with the DE SA added to the invoker binding when it was absent', async () => {
    const existingPolicy = {
      bindings: [
        { role: 'roles/run.invoker', members: ['serviceAccount:other@example.com'] },
        { role: 'roles/run.viewer', members: ['user:viewer@example.com'] },
      ],
      etag: 'etag-abc',
    };
    const fetchImpl = makeMultiFetch([
      { ok: true, status: 200, jsonBody: existingPolicy },       // getIamPolicy
      { ok: true, status: 200, jsonBody: existingPolicy },       // setIamPolicy
    ]);
    const registrar = makeGeRegistrar({ getToken, fetchImpl, config: CONFIG });

    const result = await registrar.grantInvokerToDeSa(DEMO_ID, REGION);

    expect(result.changed).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    // Verify setIamPolicy was called with the updated policy
    const [setPolicyUrl, setPolicyOpts] = fetchImpl.mock.calls[1];
    expect(setPolicyUrl).toContain(':setIamPolicy');
    const sentPolicy = JSON.parse(setPolicyOpts.body).policy;
    const invokerBinding = sentPolicy.bindings.find((b) => b.role === 'roles/run.invoker');
    expect(invokerBinding.members).toContain(`serviceAccount:${DE_SA_EMAIL}`);
    // Original member preserved
    expect(invokerBinding.members).toContain('serviceAccount:other@example.com');
  });

  it('creates a new invoker binding when none exists and preserves existing bindings', async () => {
    const existingPolicy = {
      bindings: [
        { role: 'roles/run.viewer', members: ['user:viewer@example.com'] },
      ],
      etag: 'etag-xyz',
    };
    const fetchImpl = makeMultiFetch([
      { ok: true, status: 200, jsonBody: existingPolicy },
      { ok: true, status: 200, jsonBody: existingPolicy },
    ]);
    const registrar = makeGeRegistrar({ getToken, fetchImpl, config: CONFIG });

    const result = await registrar.grantInvokerToDeSa(DEMO_ID, REGION);

    expect(result.changed).toBe(true);
    const [, setPolicyOpts] = fetchImpl.mock.calls[1];
    const sentPolicy = JSON.parse(setPolicyOpts.body).policy;
    // New invoker binding added
    const invokerBinding = sentPolicy.bindings.find((b) => b.role === 'roles/run.invoker');
    expect(invokerBinding).toBeDefined();
    expect(invokerBinding.members).toContain(`serviceAccount:${DE_SA_EMAIL}`);
    // Existing viewer binding untouched
    const viewerBinding = sentPolicy.bindings.find((b) => b.role === 'roles/run.viewer');
    expect(viewerBinding).toBeDefined();
    expect(viewerBinding.members).toContain('user:viewer@example.com');
  });

  it('attaches Authorization Bearer token on getIamPolicy call', async () => {
    const fetchImpl = makeFetch({
      ok: true,
      status: 200,
      jsonBody: {
        bindings: [{ role: 'roles/run.invoker', members: [`serviceAccount:${DE_SA_EMAIL}`] }],
        etag: 'etag',
      },
    });
    const registrar = makeGeRegistrar({ getToken, fetchImpl, config: CONFIG });

    await registrar.grantInvokerToDeSa(DEMO_ID, REGION);

    const [, opts] = fetchImpl.mock.calls[0];
    expect(opts.headers.Authorization).toBe('Bearer tok');
  });

  it('throws when getIamPolicy returns non-ok', async () => {
    const fetchImpl = makeFetch({ ok: false, status: 403, textBody: 'Forbidden' });
    const registrar = makeGeRegistrar({ getToken, fetchImpl, config: CONFIG });

    await expect(registrar.grantInvokerToDeSa(DEMO_ID, REGION)).rejects.toThrow('403');
  });
});

// ---------------------------------------------------------------------------
// registerAgent
// ---------------------------------------------------------------------------

describe('makeGeRegistrar / registerAgent', () => {
  it('builds correct GE endpoint URL for geLocation=global', async () => {
    const agentName = `projects/${CONFIG.geProjectNumber}/locations/global/collections/default_collection/engines/${CONFIG.geAppId}/assistants/default_assistant/agents/${DEMO_ID}`;
    const fetchImpl = makeFetch({ ok: true, status: 200, jsonBody: { name: agentName } });
    const registrar = makeGeRegistrar({ getToken, fetchImpl, config: CONFIG });

    await registrar.registerAgent({ demoId: DEMO_ID, serviceUrl: SERVICE_URI });

    const [url] = fetchImpl.mock.calls[0];
    expect(url).toMatch(/^https:\/\/discoveryengine\.googleapis\.com\//);
    expect(url).toContain(`/projects/${CONFIG.geProjectNumber}`);
    expect(url).toContain(`/engines/${CONFIG.geAppId}`);
    expect(url).toContain('/assistants/default_assistant/agents');
  });

  it('builds correct GE endpoint URL for a regional geLocation', async () => {
    const regionalConfig = { ...CONFIG, geLocation: 'us' };
    const agentName = `projects/${CONFIG.geProjectNumber}/locations/us/collections/default_collection/engines/${CONFIG.geAppId}/assistants/default_assistant/agents/${DEMO_ID}`;
    const fetchImpl = makeFetch({ ok: true, status: 200, jsonBody: { name: agentName } });
    const registrar = makeGeRegistrar({ getToken, fetchImpl, config: regionalConfig });

    await registrar.registerAgent({ demoId: DEMO_ID, serviceUrl: SERVICE_URI });

    const [url] = fetchImpl.mock.calls[0];
    expect(url).toMatch(/^https:\/\/us-discoveryengine\.googleapis\.com\//);
  });

  it('sends Authorization Bearer token and X-Goog-User-Project header', async () => {
    const agentName = `projects/${CONFIG.geProjectNumber}/locations/global/engines/${CONFIG.geAppId}/agents/${DEMO_ID}`;
    const fetchImpl = makeFetch({ ok: true, status: 200, jsonBody: { name: agentName } });
    const registrar = makeGeRegistrar({ getToken, fetchImpl, config: CONFIG });

    await registrar.registerAgent({ demoId: DEMO_ID, serviceUrl: SERVICE_URI });

    const [, opts] = fetchImpl.mock.calls[0];
    expect(opts.headers.Authorization).toBe('Bearer tok');
    expect(opts.headers['X-Goog-User-Project']).toBe(CONFIG.geProjectNumber);
  });

  it('sends a body with jsonAgentCard as a string, url ending /a2a/app, and ASCII-only displayName', async () => {
    const agentName = `projects/${CONFIG.geProjectNumber}/locations/global/engines/${CONFIG.geAppId}/agents/${DEMO_ID}`;
    const fetchImpl = makeFetch({ ok: true, status: 200, jsonBody: { name: agentName } });
    const registrar = makeGeRegistrar({ getToken, fetchImpl, config: CONFIG });

    await registrar.registerAgent({ demoId: DEMO_ID, serviceUrl: SERVICE_URI });

    const [, opts] = fetchImpl.mock.calls[0];
    const sentBody = JSON.parse(opts.body);

    // jsonAgentCard must be a STRING (not an object)
    expect(typeof sentBody.a2aAgentDefinition.jsonAgentCard).toBe('string');

    // The parsed card must contain the correct url
    const card = JSON.parse(sentBody.a2aAgentDefinition.jsonAgentCard);
    expect(card.url).toBe(`${SERVICE_URI}/a2a/app`);

    // displayName must be ASCII only (no non-ASCII characters)
    expect(/^[\x00-\x7F]*$/.test(sentBody.displayName)).toBe(true);
  });

  it('returns agentResourceName, agentId, alreadyRegistered:false on HTTP 200', async () => {
    const agentName = `projects/${CONFIG.geProjectNumber}/locations/global/collections/default_collection/engines/${CONFIG.geAppId}/assistants/default_assistant/agents/${DEMO_ID}`;
    const fetchImpl = makeFetch({ ok: true, status: 200, jsonBody: { name: agentName } });
    const registrar = makeGeRegistrar({ getToken, fetchImpl, config: CONFIG });

    const result = await registrar.registerAgent({ demoId: DEMO_ID, serviceUrl: SERVICE_URI });

    expect(result.alreadyRegistered).toBe(false);
    expect(result.agentResourceName).toBe(agentName);
    expect(result.agentId).toBe(DEMO_ID);
  });

  it('returns alreadyRegistered:true and does NOT throw on HTTP 409', async () => {
    const fetchImpl = makeFetch({ ok: false, status: 409, textBody: 'Agent already exists' });
    const registrar = makeGeRegistrar({ getToken, fetchImpl, config: CONFIG });

    const result = await registrar.registerAgent({ demoId: DEMO_ID, serviceUrl: SERVICE_URI });

    expect(result.alreadyRegistered).toBe(true);
    expect(result.agentId).toBeUndefined();
  });

  it('throws with status + body on HTTP 500', async () => {
    const fetchImpl = makeFetch({ ok: false, status: 500, textBody: 'Internal Server Error' });
    const registrar = makeGeRegistrar({ getToken, fetchImpl, config: CONFIG });

    await expect(
      registrar.registerAgent({ demoId: DEMO_ID, serviceUrl: SERVICE_URI }),
    ).rejects.toThrow('500');
  });
});

// ---------------------------------------------------------------------------
// registerToGe (orchestrator)
// ---------------------------------------------------------------------------

describe('makeGeRegistrar / registerToGe', () => {
  /** Build a fetchImpl that responds correctly for all three steps in order. */
  function makeOrchestratorFetch({ ingressAlready = false, saAlready = false, agentStatus = 200 } = {}) {
    const agentName = `projects/${CONFIG.geProjectNumber}/locations/global/engines/${CONFIG.geAppId}/agents/${DEMO_ID}`;

    const responses = [];

    // Step 1: setIngressAll — GET service
    responses.push({
      ok: true,
      status: 200,
      jsonBody: {
        ingress: ingressAlready ? 'INGRESS_TRAFFIC_ALL' : 'INGRESS_TRAFFIC_INTERNAL_ONLY',
        uri: SERVICE_URI,
      },
    });
    // If ingress was not already set, a PATCH follows
    if (!ingressAlready) {
      responses.push({ ok: true, status: 200, jsonBody: {} });
    }

    // Step 2: grantInvokerToDeSa — getIamPolicy
    const deSaMember = `serviceAccount:${DE_SA_EMAIL}`;
    responses.push({
      ok: true,
      status: 200,
      jsonBody: {
        bindings: saAlready
          ? [{ role: 'roles/run.invoker', members: [deSaMember] }]
          : [],
        etag: 'etag',
      },
    });
    // If SA was not already granted, setIamPolicy follows
    if (!saAlready) {
      responses.push({ ok: true, status: 200, jsonBody: {} });
    }

    // Step 3: registerAgent — POST to GE
    responses.push({
      ok: agentStatus !== 409 && agentStatus < 400,
      status: agentStatus,
      jsonBody: agentStatus === 200 ? { name: agentName } : null,
      textBody: agentStatus !== 200 ? `error ${agentStatus}` : '',
    });

    return makeMultiFetch(responses);
  }

  it('calls setIngressAll, grantInvokerToDeSa, registerAgent in order and returns summary', async () => {
    const fetchImpl = makeOrchestratorFetch();
    const registrar = makeGeRegistrar({ getToken, fetchImpl, config: CONFIG });

    const result = await registrar.registerToGe({ demoId: DEMO_ID });

    expect(result.demoId).toBe(DEMO_ID);
    expect(typeof result.agentId).toBe('string');
    expect(result.alreadyRegistered).toBe(false);
    expect(result.ingressChanged).toBe(true);
  });

  it('uses config.agentRegion when region is omitted', async () => {
    const fetchImpl = makeOrchestratorFetch({ ingressAlready: true, saAlready: true });
    const registrar = makeGeRegistrar({ getToken, fetchImpl, config: CONFIG });

    await registrar.registerToGe({ demoId: DEMO_ID });

    // Cloud Run API URLs should contain the default region
    const callUrls = fetchImpl.mock.calls.map(([url]) => url);
    expect(callUrls.some((u) => u.includes(CONFIG.agentRegion))).toBe(true);
  });

  it('uses provided region over config.agentRegion', async () => {
    const fetchImpl = makeOrchestratorFetch({ ingressAlready: true, saAlready: true });
    const registrar = makeGeRegistrar({ getToken, fetchImpl, config: CONFIG });

    await registrar.registerToGe({ demoId: DEMO_ID, region: 'asia-northeast1' });

    const callUrls = fetchImpl.mock.calls.map(([url]) => url);
    expect(callUrls.some((u) => u.includes('asia-northeast1'))).toBe(true);
  });

  it('returns ingressChanged:false when ingress was already set', async () => {
    const fetchImpl = makeOrchestratorFetch({ ingressAlready: true, saAlready: true });
    const registrar = makeGeRegistrar({ getToken, fetchImpl, config: CONFIG });

    const result = await registrar.registerToGe({ demoId: DEMO_ID });

    expect(result.ingressChanged).toBe(false);
  });

  it('returns alreadyRegistered:true when GE returns 409', async () => {
    const fetchImpl = makeOrchestratorFetch({ ingressAlready: true, saAlready: true, agentStatus: 409 });
    const registrar = makeGeRegistrar({ getToken, fetchImpl, config: CONFIG });

    const result = await registrar.registerToGe({ demoId: DEMO_ID });

    expect(result.alreadyRegistered).toBe(true);
    expect(result.agentId).toBeNull();
  });

  it('works when registerToGe is destructured from the returned object (no this-binding needed)', async () => {
    const fetchImpl = makeOrchestratorFetch({ ingressAlready: false, saAlready: false, agentStatus: 200 });

    // Destructure — simulates a caller doing `const { registerToGe } = makeGeRegistrar(...)`
    const { registerToGe } = makeGeRegistrar({ getToken, fetchImpl, config: CONFIG });

    // Must resolve without TypeError (no `this` reference inside registerToGe)
    const result = await registerToGe({ demoId: DEMO_ID });

    expect(result.demoId).toBe(DEMO_ID);
    expect(typeof result.agentId).toBe('string');
    expect(result.alreadyRegistered).toBe(false);
    expect(result.ingressChanged).toBe(true);
  });
});
