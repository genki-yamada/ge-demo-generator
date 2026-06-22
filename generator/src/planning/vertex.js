/**
 * planning/vertex.js — Node port of Code.gs callVertexAI / callVertexAIWithSearch / executeWithRetry.
 *
 * Faithful to:
 *   Code.gs:15709-15743  callVertexAI + callVertexAIWithSearch
 *   Code.gs:15707        callVertexAIWithRetry
 *   Code.gs:15815-15821  executeWithRetry
 *
 * Design: getToken, fetchImpl, and sleep are injected for full testability
 * (no real network or auth required in unit tests).
 *
 * @param {object} opts
 * @param {string} opts.projectId
 * @param {string} opts.location            - e.g. 'global' or 'us-central1'
 * @param {string} opts.model               - default model (CONFIG.MODEL)
 * @param {string} opts.searchModel         - model for search calls (hardcoded 'gemini-3.1-flash-lite' in Code.gs)
 * @param {() => Promise<string>} opts.getToken  - returns Bearer token (production: google-auth-library)
 * @param {Function} [opts.fetchImpl]       - fetch-compatible function; defaults to global fetch
 * @param {number} [opts.maxRetries]        - Code.gs CONFIG.MAX_RETRIES = 3
 * @param {number} [opts.retryDelayMs]      - Code.gs CONFIG.RETRY_DELAY_MS = 1000
 * @param {(ms: number) => Promise<void>} [opts.sleep]  - injectable for tests
 * @returns {{ generateContent: Function }}
 */
export function makeVertexClient({
  projectId,
  location,
  model,
  searchModel,
  getToken,
  fetchImpl = fetch,
  maxRetries = 3,
  retryDelayMs = 1000,
  sleep,
}) {
  // Default sleep implementation (matches Utilities.sleep from Code.gs:15818)
  const sleepFn = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  /**
   * Equivalent of Code.gs executeWithRetry (lines 15815-15821).
   * Retries fn up to maxRetries times; sleeps retryDelayMs * attempt after each failure.
   */
  async function executeWithRetry(fn) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        await sleepFn(retryDelayMs * attempt);
      }
    }
    throw lastError;
  }

  /**
   * Equivalent of Code.gs callVertexAI (lines 15709-15718).
   * Builds the URL, sends the payload, parses the response.
   *
   * @param {string} prompt
   * @param {object} [overrideGenerationConfig] - optional generationConfig fields to merge over default
   * @param {string} [overrideModel] - optional model override; defaults to opts.model
   * @param {boolean} [multiPart] - if true, concatenate all parts (for grounding responses)
   */
  async function callVertexAI(prompt, overrideGenerationConfig, overrideModel, multiPart) {
    // Code.gs:15710-15711: location determines host
    const loc = location || 'global';
    const host =
      loc === 'global'
        ? 'aiplatform.googleapis.com'
        : `${loc}-aiplatform.googleapis.com`;

    const resolvedModel = overrideModel || model;
    const url = `https://${host}/v1/projects/${projectId}/locations/${loc}/publishers/google/models/${resolvedModel}:generateContent`;

    const baseGenerationConfig = { temperature: 0.4, maxOutputTokens: 65535 };
    const payload = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: overrideGenerationConfig
        ? { ...baseGenerationConfig, ...overrideGenerationConfig }
        : baseGenerationConfig,
    };

    const token = await getToken();
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify(payload),
    });

    // Code.gs:15716: non-200 throws "AI Error: <body>"
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`AI Error: ${body}`);
    }

    // Code.gs:15717: parse candidates[0].content.parts[0].text
    const data = await response.json();
    if (multiPart) {
      // Concatenate all text parts (needed for grounding responses, Code.gs:15592-15596)
      return data.candidates[0].content.parts
        .filter((p) => p.text)
        .map((p) => p.text)
        .join('');
    }
    return data.candidates[0].content.parts[0].text;
  }

  /**
   * Equivalent of Code.gs callVertexAIWithSearch (lines 15724-15744).
   * Uses searchModel and adds Google Search grounding tool.
   *
   * @param {string} prompt
   * @param {object} [overrideGenerationConfig] - optional generationConfig fields to merge over default
   * @param {boolean} [multiPart] - if true, concatenate all parts (for grounding responses)
   */
  async function callVertexAIWithSearch(prompt, overrideGenerationConfig, multiPart) {
    const loc = location || 'global';
    const host =
      loc === 'global'
        ? 'aiplatform.googleapis.com'
        : `${loc}-aiplatform.googleapis.com`;

    // Code.gs:15728: uses searchModel (hardcoded 'gemini-3.1-flash-lite')
    const url = `https://${host}/v1/projects/${projectId}/locations/${loc}/publishers/google/models/${searchModel}:generateContent`;

    // Code.gs:15730-15734: search payload with tools and different generationConfig
    const baseGenerationConfig = { temperature: 0.2, maxOutputTokens: 2048 };
    const payload = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ googleSearch: {} }],
      generationConfig: overrideGenerationConfig
        ? { ...baseGenerationConfig, ...overrideGenerationConfig }
        : baseGenerationConfig,
    };

    const token = await getToken();
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify(payload),
    });

    // Code.gs:15742: non-200 throws "AI Search Error: <body>"
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`AI Search Error: ${body}`);
    }

    // Code.gs:15743: same parse path (or multiPart for grounding)
    const data = await response.json();
    if (multiPart) {
      return data.candidates[0].content.parts
        .filter((p) => p.text)
        .map((p) => p.text)
        .join('');
    }
    return data.candidates[0].content.parts[0].text;
  }

  /**
   * Public API: generateContent(prompt, { search, generationConfig, model, multiPart })
   * Equivalent of callVertexAIWithRetry (Code.gs:15707) wrapping callVertexAI/callVertexAIWithSearch.
   *
   * Extensions over original Task 1 interface (minimal, for research.js faithfulness):
   *   - generationConfig: optional override merged over per-path defaults
   *   - model: optional model override for standard (non-search) path
   *   - multiPart: if true, concatenate all text parts (Code.gs:15592-15596 researchCompanyByDomain)
   */
  async function generateContent(prompt, { search = false, generationConfig, model: modelOverride, multiPart = false } = {}) {
    return executeWithRetry(() =>
      search
        ? callVertexAIWithSearch(prompt, generationConfig, multiPart)
        : callVertexAI(prompt, generationConfig, modelOverride, multiPart)
    );
  }

  return { generateContent };
}
