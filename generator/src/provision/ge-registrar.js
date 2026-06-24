/**
 * provision/ge-registrar.js — registers a demo's deployed Cloud Run agent to a
 * Gemini Enterprise (Discovery Engine) app via REST.
 *
 * Design: getToken and fetchImpl are injected for full testability — no real
 * network calls occur in unit tests. Follows the same injection pattern as
 * vertex.js and job-runner.js.
 *
 * @param {object} opts
 * @param {() => Promise<string>} opts.getToken  - returns a GCP cloud-platform Bearer token
 * @param {Function} opts.fetchImpl              - fetch-compatible function
 * @param {object} opts.config                   - static configuration
 * @param {string} opts.config.projectId         - GCP project hosting the Cloud Run agent (e.g. "ge-work-osaka")
 * @param {string} opts.config.agentRegion       - default region of the agent service (e.g. "us-central1")
 * @param {string} opts.config.geProjectNumber   - numeric project number for the GE app (e.g. "504753788734")
 * @param {string} opts.config.geAppId           - GE engine/app id (e.g. "osaka-work-yamada_1782323841039")
 * @param {string} opts.config.geLocation        - GE location (e.g. "global")
 * @returns {{ setIngressAll, grantInvokerToDeSa, registerAgent, registerToGe }}
 */
export function makeGeRegistrar({ getToken, fetchImpl, config }) {
  // Discovery Engine service account that must be granted run.invoker on the Cloud Run service.
  // Format: service-<projectNumber>@gcp-sa-discoveryengine.iam.gserviceaccount.com
  const deSaEmail = `service-${config.geProjectNumber}@gcp-sa-discoveryengine.iam.gserviceaccount.com`;

  /**
   * Internal helper: attach a Bearer token and issue a fetch request, returning
   * the raw Response. Callers are responsible for checking res.ok.
   *
   * @param {string} url
   * @param {object} [fetchOptions]  - method, headers (merged with Authorization), body, etc.
   * @returns {Promise<Response>}
   */
  async function authedFetch(url, fetchOptions = {}) {
    const token = await getToken();
    const { headers: extraHeaders = {}, ...rest } = fetchOptions;
    return fetchImpl(url, {
      ...rest,
      headers: {
        Authorization: `Bearer ${token}`,
        ...extraHeaders,
      },
    });
  }

  /**
   * Set the Cloud Run service's ingress to INGRESS_TRAFFIC_ALL.
   * If the service already has that setting, no PATCH is issued.
   *
   * @param {string} serviceName  - Cloud Run service name (e.g. the demo id)
   * @param {string} region       - Cloud Run region
   * @returns {Promise<{ changed: boolean, uri: string }>}
   */
  async function setIngressAll(serviceName, region) {
    const serviceUrl =
      `https://run.googleapis.com/v2/projects/${config.projectId}` +
      `/locations/${region}/services/${serviceName}`;

    // 1. GET current service state
    const getRes = await authedFetch(serviceUrl);
    if (!getRes.ok) {
      const body = await getRes.text();
      throw new Error(`Cloud Run GET service failed (${getRes.status}): ${body}`);
    }
    const svc = await getRes.json();
    const uri = svc.uri ?? '';

    // 2. Skip PATCH if already set
    if (svc.ingress === 'INGRESS_TRAFFIC_ALL') {
      return { changed: false, uri };
    }

    // 3. PATCH ingress field only
    const patchRes = await authedFetch(
      `${serviceUrl}?updateMask=ingress`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingress: 'INGRESS_TRAFFIC_ALL' }),
      },
    );
    if (!patchRes.ok) {
      const body = await patchRes.text();
      throw new Error(`Cloud Run PATCH ingress failed (${patchRes.status}): ${body}`);
    }

    return { changed: true, uri };
  }

  /**
   * Grant roles/run.invoker to the Discovery Engine SA on the Cloud Run service,
   * preserving all existing IAM bindings (read-modify-write).
   *
   * @param {string} serviceName  - Cloud Run service name
   * @param {string} region       - Cloud Run region
   * @returns {Promise<{ changed: boolean }>}
   */
  async function grantInvokerToDeSa(serviceName, region) {
    const baseUrl =
      `https://run.googleapis.com/v2/projects/${config.projectId}` +
      `/locations/${region}/services/${serviceName}`;

    // 1. Read current IAM policy
    const getPolicyRes = await authedFetch(`${baseUrl}:getIamPolicy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!getPolicyRes.ok) {
      const body = await getPolicyRes.text();
      throw new Error(`getIamPolicy failed (${getPolicyRes.status}): ${body}`);
    }
    const policy = await getPolicyRes.json();

    const bindings = policy.bindings ?? [];
    const member = `serviceAccount:${deSaEmail}`;
    const invokerRole = 'roles/run.invoker';

    // 2. Check whether the SA is already a member of the invoker binding
    const existingBinding = bindings.find((b) => b.role === invokerRole);
    if (existingBinding?.members?.includes(member)) {
      return { changed: false };
    }

    // 3. Mutate the policy in-memory (add member to existing binding or create new one)
    let updatedBindings;
    if (existingBinding) {
      updatedBindings = bindings.map((b) =>
        b.role === invokerRole
          ? { ...b, members: [...(b.members ?? []), member] }
          : b,
      );
    } else {
      updatedBindings = [...bindings, { role: invokerRole, members: [member] }];
    }
    const updatedPolicy = { ...policy, bindings: updatedBindings };

    // 4. Write back with setIamPolicy
    const setPolicyRes = await authedFetch(`${baseUrl}:setIamPolicy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ policy: updatedPolicy }),
    });
    if (!setPolicyRes.ok) {
      const body = await setPolicyRes.text();
      throw new Error(`setIamPolicy failed (${setPolicyRes.status}): ${body}`);
    }

    return { changed: true };
  }

  /**
   * POST the agent card to the Gemini Enterprise (Discovery Engine) app.
   *
   * The jsonAgentCard field must be a JSON string (GE v1alpha requirement).
   * displayName is ASCII only — GE v1alpha mangles non-ASCII characters.
   *
   * @param {object} opts
   * @param {string} opts.demoId      - unique demo identifier (used as agent name)
   * @param {string} opts.serviceUrl  - Cloud Run service URI (e.g. https://...)
   * @returns {Promise<{ agentResourceName?: string, agentId?: string, alreadyRegistered: boolean }>}
   */
  async function registerAgent({ demoId, serviceUrl }) {
    // Discovery Engine host depends on location
    const host =
      config.geLocation === 'global'
        ? 'discoveryengine.googleapis.com'
        : `${config.geLocation}-discoveryengine.googleapis.com`;

    const url =
      `https://${host}/v1alpha/projects/${config.geProjectNumber}` +
      `/locations/${config.geLocation}/collections/default_collection` +
      `/engines/${config.geAppId}/assistants/default_assistant/agents`;

    // Build the agent card (jsonAgentCard is serialized as a string per GE API spec)
    const agentCard = {
      protocolVersion: '1.0',
      name: demoId,
      description: 'Demo agent',
      url: `${serviceUrl}/a2a/app`,
      version: '1.0.0',
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain', 'application/json'],
      capabilities: {
        streaming: true,
        extensions: [{ uri: 'https://a2ui.org/a2a-extension/a2ui/v0.8' }],
      },
      preferredTransport: 'JSONRPC',
      skills: [
        {
          id: 'general',
          name: 'General Skill',
          description: 'Handles general queries',
          tags: [],
        },
      ],
    };

    const body = {
      name: demoId,
      // ASCII-only displayName — GE v1alpha mangles non-ASCII characters
      displayName: `Demo Agent (${demoId})`,
      description: 'Demo agent registered by GE Demo Generator',
      a2aAgentDefinition: {
        jsonAgentCard: JSON.stringify(agentCard),
      },
    };

    const res = await authedFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Required: charges quota to this project, not the caller's project
        'X-Goog-User-Project': config.geProjectNumber,
      },
      body: JSON.stringify(body),
    });

    // 409 Conflict means the agent was already registered — not an error
    if (res.status === 409) {
      return { alreadyRegistered: true };
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`registerAgent failed (${res.status}): ${text}`);
    }

    const data = await res.json();
    return {
      agentResourceName: data.name,
      agentId: data.name.split('/').pop(),
      alreadyRegistered: false,
    };
  }

  /**
   * Orchestrate the full registration flow for a demo's Cloud Run agent:
   *   1. Open ingress to allow all traffic (required for GE to reach the agent)
   *   2. Grant Discovery Engine SA the run.invoker role
   *   3. Register the agent card in the GE app
   *
   * @param {object} opts
   * @param {string} opts.demoId    - demo identifier; used as both Cloud Run service name and GE agent name
   * @param {string} [opts.region]  - Cloud Run region; defaults to config.agentRegion
   * @returns {Promise<{ demoId: string, agentId: string|null, alreadyRegistered: boolean, ingressChanged: boolean }>}
   */
  async function registerToGe({ demoId, region }) {
    const resolvedRegion = region || config.agentRegion;

    // 1. Open ingress and obtain the service URI
    const { changed: ingressChanged, uri } = await setIngressAll(demoId, resolvedRegion);

    // 2. Grant Discovery Engine SA run.invoker on the service
    await grantInvokerToDeSa(demoId, resolvedRegion);

    // 3. Register the agent card in GE
    const r = await registerAgent({ demoId, serviceUrl: uri });

    return {
      demoId,
      agentId: r.agentId ?? null,
      alreadyRegistered: !!r.alreadyRegistered,
      ingressChanged,
    };
  }

  return { setIngressAll, grantInvokerToDeSa, registerAgent, registerToGe };
}
