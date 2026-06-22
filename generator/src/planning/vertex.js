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
   */
  async function callVertexAI(prompt) {
    // Code.gs:15710-15711: location determines host
    const loc = location || 'global';
    const host =
      loc === 'global'
        ? 'aiplatform.googleapis.com'
        : `${loc}-aiplatform.googleapis.com`;

    const url = `https://${host}/v1/projects/${projectId}/locations/${loc}/publishers/google/models/${model}:generateContent`;

    const payload = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 65535 },
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
    return data.candidates[0].content.parts[0].text;
  }

  /**
   * Equivalent of Code.gs callVertexAIWithSearch (lines 15724-15744).
   * Uses searchModel and adds Google Search grounding tool.
   */
  async function callVertexAIWithSearch(prompt) {
    const loc = location || 'global';
    const host =
      loc === 'global'
        ? 'aiplatform.googleapis.com'
        : `${loc}-aiplatform.googleapis.com`;

    // Code.gs:15728: uses searchModel (hardcoded 'gemini-3.1-flash-lite')
    const url = `https://${host}/v1/projects/${projectId}/locations/${loc}/publishers/google/models/${searchModel}:generateContent`;

    // Code.gs:15730-15734: search payload with tools and different generationConfig
    const payload = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ googleSearch: {} }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
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

    // Code.gs:15743: same parse path
    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
  }

  /**
   * Public API: generateContent(prompt, { search = false })
   * Equivalent of callVertexAIWithRetry (Code.gs:15707) wrapping callVertexAI/callVertexAIWithSearch.
   */
  async function generateContent(prompt, { search = false } = {}) {
    return executeWithRetry(() =>
      search ? callVertexAIWithSearch(prompt) : callVertexAI(prompt)
    );
  }

  return { generateContent };
}
