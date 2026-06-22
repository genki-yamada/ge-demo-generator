import { describe, it, expect, vi } from 'vitest';
import { makeVertexClient } from '../../src/planning/vertex.js';

const PROJECT_ID = 'test-project';
const LOCATION = 'global';
const MODEL = 'gemini-3.5-flash';
const SEARCH_MODEL = 'gemini-3.1-flash-lite';
const TOKEN = 'fake-token';

function makeOkResponse(text) {
  const body = JSON.stringify({
    candidates: [{ content: { parts: [{ text }] } }],
  });
  return {
    ok: true,
    status: 200,
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

function makeErrorResponse(status, bodyText = 'server error') {
  return {
    ok: false,
    status,
    text: async () => bodyText,
    json: async () => ({ error: bodyText }),
  };
}

describe('makeVertexClient', () => {
  describe('generateContent (standard)', () => {
    it('calls correct URL for global location', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(makeOkResponse('hello'));
      const getToken = vi.fn().mockResolvedValue(TOKEN);
      const sleep = vi.fn().mockResolvedValue(undefined);

      const client = makeVertexClient({
        projectId: PROJECT_ID,
        location: LOCATION,
        model: MODEL,
        searchModel: SEARCH_MODEL,
        getToken,
        fetchImpl,
        maxRetries: 3,
        retryDelayMs: 1000,
        sleep,
      });

      await client.generateContent('test prompt');

      const url = fetchImpl.mock.calls[0][0];
      expect(url).toBe(
        `https://aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent`
      );
    });

    it('uses regional host when location is not global', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(makeOkResponse('hello'));
      const getToken = vi.fn().mockResolvedValue(TOKEN);
      const sleep = vi.fn().mockResolvedValue(undefined);

      const client = makeVertexClient({
        projectId: PROJECT_ID,
        location: 'us-central1',
        model: MODEL,
        searchModel: SEARCH_MODEL,
        getToken,
        fetchImpl,
        maxRetries: 3,
        retryDelayMs: 1000,
        sleep,
      });

      await client.generateContent('test prompt');

      const url = fetchImpl.mock.calls[0][0];
      expect(url).toBe(
        `https://us-central1-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/us-central1/publishers/google/models/${MODEL}:generateContent`
      );
    });

    it('sends correct body with temperature 0.4 and maxOutputTokens 65535', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(makeOkResponse('hello'));
      const getToken = vi.fn().mockResolvedValue(TOKEN);
      const sleep = vi.fn().mockResolvedValue(undefined);

      const client = makeVertexClient({
        projectId: PROJECT_ID,
        location: LOCATION,
        model: MODEL,
        searchModel: SEARCH_MODEL,
        getToken,
        fetchImpl,
        maxRetries: 3,
        retryDelayMs: 1000,
        sleep,
      });

      await client.generateContent('my prompt');

      const init = fetchImpl.mock.calls[0][1];
      const body = JSON.parse(init.body);

      expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'my prompt' }] }]);
      expect(body.generationConfig.temperature).toBe(0.4);
      expect(body.generationConfig.maxOutputTokens).toBe(65535);
      expect(body.tools).toBeUndefined();
    });

    it('sends Bearer Authorization header', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(makeOkResponse('hello'));
      const getToken = vi.fn().mockResolvedValue(TOKEN);
      const sleep = vi.fn().mockResolvedValue(undefined);

      const client = makeVertexClient({
        projectId: PROJECT_ID,
        location: LOCATION,
        model: MODEL,
        searchModel: SEARCH_MODEL,
        getToken,
        fetchImpl,
        maxRetries: 3,
        retryDelayMs: 1000,
        sleep,
      });

      await client.generateContent('my prompt');

      const init = fetchImpl.mock.calls[0][1];
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(init.headers['Authorization']).toBe(`Bearer ${TOKEN}`);
    });

    it('returns candidates[0].content.parts[0].text', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(makeOkResponse('the answer'));
      const getToken = vi.fn().mockResolvedValue(TOKEN);
      const sleep = vi.fn().mockResolvedValue(undefined);

      const client = makeVertexClient({
        projectId: PROJECT_ID,
        location: LOCATION,
        model: MODEL,
        searchModel: SEARCH_MODEL,
        getToken,
        fetchImpl,
        maxRetries: 3,
        retryDelayMs: 1000,
        sleep,
      });

      const result = await client.generateContent('my prompt');
      expect(result).toBe('the answer');
    });

    it('throws "AI Error: <body>" on non-200', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(makeErrorResponse(500, 'Internal Server Error'));
      const getToken = vi.fn().mockResolvedValue(TOKEN);
      const sleep = vi.fn().mockResolvedValue(undefined);

      const client = makeVertexClient({
        projectId: PROJECT_ID,
        location: LOCATION,
        model: MODEL,
        searchModel: SEARCH_MODEL,
        getToken,
        fetchImpl,
        maxRetries: 1,
        retryDelayMs: 0,
        sleep,
      });

      await expect(client.generateContent('my prompt')).rejects.toThrow('AI Error: Internal Server Error');
    });
  });

  describe('generateContent with search:true', () => {
    it('uses searchModel in the URL', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(makeOkResponse('result'));
      const getToken = vi.fn().mockResolvedValue(TOKEN);
      const sleep = vi.fn().mockResolvedValue(undefined);

      const client = makeVertexClient({
        projectId: PROJECT_ID,
        location: LOCATION,
        model: MODEL,
        searchModel: SEARCH_MODEL,
        getToken,
        fetchImpl,
        maxRetries: 3,
        retryDelayMs: 1000,
        sleep,
      });

      await client.generateContent('search prompt', { search: true });

      const url = fetchImpl.mock.calls[0][0];
      expect(url).toContain(`/models/${SEARCH_MODEL}:generateContent`);
      expect(url).not.toContain(MODEL + ':generateContent');
    });

    it('sends tools:[{googleSearch:{}}] in body', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(makeOkResponse('result'));
      const getToken = vi.fn().mockResolvedValue(TOKEN);
      const sleep = vi.fn().mockResolvedValue(undefined);

      const client = makeVertexClient({
        projectId: PROJECT_ID,
        location: LOCATION,
        model: MODEL,
        searchModel: SEARCH_MODEL,
        getToken,
        fetchImpl,
        maxRetries: 3,
        retryDelayMs: 1000,
        sleep,
      });

      await client.generateContent('search prompt', { search: true });

      const init = fetchImpl.mock.calls[0][1];
      const body = JSON.parse(init.body);
      expect(body.tools).toEqual([{ googleSearch: {} }]);
    });

    it('sends temperature 0.2 and maxOutputTokens 2048 for search', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(makeOkResponse('result'));
      const getToken = vi.fn().mockResolvedValue(TOKEN);
      const sleep = vi.fn().mockResolvedValue(undefined);

      const client = makeVertexClient({
        projectId: PROJECT_ID,
        location: LOCATION,
        model: MODEL,
        searchModel: SEARCH_MODEL,
        getToken,
        fetchImpl,
        maxRetries: 3,
        retryDelayMs: 1000,
        sleep,
      });

      await client.generateContent('search prompt', { search: true });

      const init = fetchImpl.mock.calls[0][1];
      const body = JSON.parse(init.body);
      expect(body.generationConfig.temperature).toBe(0.2);
      expect(body.generationConfig.maxOutputTokens).toBe(2048);
    });

    it('throws "AI Search Error: <body>" on non-200', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(makeErrorResponse(429, 'quota exceeded'));
      const getToken = vi.fn().mockResolvedValue(TOKEN);
      const sleep = vi.fn().mockResolvedValue(undefined);

      const client = makeVertexClient({
        projectId: PROJECT_ID,
        location: LOCATION,
        model: MODEL,
        searchModel: SEARCH_MODEL,
        getToken,
        fetchImpl,
        maxRetries: 1,
        retryDelayMs: 0,
        sleep,
      });

      await expect(client.generateContent('search prompt', { search: true })).rejects.toThrow('AI Search Error: quota exceeded');
    });
  });

  describe('retry behavior (executeWithRetry equivalent)', () => {
    it('retries up to maxRetries times and then throws last error', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(makeErrorResponse(500, 'fail'));
      const getToken = vi.fn().mockResolvedValue(TOKEN);
      const sleep = vi.fn().mockResolvedValue(undefined);
      const MAX_RETRIES = 3;

      const client = makeVertexClient({
        projectId: PROJECT_ID,
        location: LOCATION,
        model: MODEL,
        searchModel: SEARCH_MODEL,
        getToken,
        fetchImpl,
        maxRetries: MAX_RETRIES,
        retryDelayMs: 1000,
        sleep,
      });

      await expect(client.generateContent('prompt')).rejects.toThrow();
      // Should have been called exactly MAX_RETRIES times
      expect(fetchImpl).toHaveBeenCalledTimes(MAX_RETRIES);
    });

    it('calls sleep with retryDelayMs * attempt for each retry', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(makeErrorResponse(500, 'fail'));
      const getToken = vi.fn().mockResolvedValue(TOKEN);
      const sleep = vi.fn().mockResolvedValue(undefined);
      const MAX_RETRIES = 3;
      const RETRY_DELAY_MS = 1000;

      const client = makeVertexClient({
        projectId: PROJECT_ID,
        location: LOCATION,
        model: MODEL,
        searchModel: SEARCH_MODEL,
        getToken,
        fetchImpl,
        maxRetries: MAX_RETRIES,
        retryDelayMs: RETRY_DELAY_MS,
        sleep,
      });

      await expect(client.generateContent('prompt')).rejects.toThrow();

      // sleep called once per attempt (attempt 1, 2, 3)
      expect(sleep).toHaveBeenCalledTimes(MAX_RETRIES);
      expect(sleep).toHaveBeenNthCalledWith(1, RETRY_DELAY_MS * 1);
      expect(sleep).toHaveBeenNthCalledWith(2, RETRY_DELAY_MS * 2);
      expect(sleep).toHaveBeenNthCalledWith(3, RETRY_DELAY_MS * 3);
    });

    it('does not retry on 200 success', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(makeOkResponse('success'));
      const getToken = vi.fn().mockResolvedValue(TOKEN);
      const sleep = vi.fn().mockResolvedValue(undefined);

      const client = makeVertexClient({
        projectId: PROJECT_ID,
        location: LOCATION,
        model: MODEL,
        searchModel: SEARCH_MODEL,
        getToken,
        fetchImpl,
        maxRetries: 3,
        retryDelayMs: 1000,
        sleep,
      });

      const result = await client.generateContent('prompt');
      expect(result).toBe('success');
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    });

    it('returns immediately on first success after some failures', async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(makeErrorResponse(503, 'unavailable'))
        .mockResolvedValueOnce(makeOkResponse('recovered'));
      const getToken = vi.fn().mockResolvedValue(TOKEN);
      const sleep = vi.fn().mockResolvedValue(undefined);

      const client = makeVertexClient({
        projectId: PROJECT_ID,
        location: LOCATION,
        model: MODEL,
        searchModel: SEARCH_MODEL,
        getToken,
        fetchImpl,
        maxRetries: 3,
        retryDelayMs: 1000,
        sleep,
      });

      const result = await client.generateContent('prompt');
      expect(result).toBe('recovered');
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledTimes(1); // only slept after first failure
    });
  });
});
