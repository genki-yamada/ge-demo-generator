import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('returns correct defaults when env is empty', () => {
    const cfg = loadConfig({});
    expect(cfg.projectId).toBeUndefined();
    expect(cfg.region).toBe('asia-northeast1');
    expect(cfg.vertexLocation).toBe('global');
    expect(cfg.model).toBe('gemini-3.5-flash');
    expect(cfg.searchModel).toBe('gemini-3.1-flash-lite');
    expect(cfg.maxRetries).toBe(3);
    expect(cfg.retryDelayMs).toBe(1000);
    expect(cfg.databaseId).toBe('generator');
    expect(cfg.githubToken).toBeNull();
    expect(cfg.scriptsBucket).toBe('');
  });

  it('respects env overrides', () => {
    const cfg = loadConfig({
      GOOGLE_CLOUD_PROJECT: 'my-project',
      GENERATOR_REGION: 'us-central1',
      VERTEX_LOCATION: 'us-east1',
      AGENT_MODEL: 'gemini-custom',
      AGENT_SEARCH_MODEL: 'gemini-search-custom',
      AGENT_MAX_RETRIES: '5',
      AGENT_RETRY_DELAY_MS: '2000',
      FIRESTORE_DATABASE_ID: 'custom-db',
      GITHUB_TOKEN: 'ghp_secret',
      GENERATOR_SCRIPTS_BUCKET: 'my-scripts-bucket',
    });
    expect(cfg.projectId).toBe('my-project');
    expect(cfg.region).toBe('us-central1');
    expect(cfg.vertexLocation).toBe('us-east1');
    expect(cfg.model).toBe('gemini-custom');
    expect(cfg.searchModel).toBe('gemini-search-custom');
    expect(cfg.maxRetries).toBe(5);
    expect(cfg.retryDelayMs).toBe(2000);
    expect(cfg.databaseId).toBe('custom-db');
    expect(cfg.githubToken).toBe('ghp_secret');
    expect(cfg.scriptsBucket).toBe('my-scripts-bucket');
  });

  it('maxRetries and retryDelayMs are numbers (not strings)', () => {
    const cfg = loadConfig({ AGENT_MAX_RETRIES: '7', AGENT_RETRY_DELAY_MS: '500' });
    expect(typeof cfg.maxRetries).toBe('number');
    expect(typeof cfg.retryDelayMs).toBe('number');
    expect(cfg.maxRetries).toBe(7);
    expect(cfg.retryDelayMs).toBe(500);
  });

  it('uses process.env by default when called with no args', () => {
    // Simply confirm the function is callable with no args (will read process.env)
    const cfg = loadConfig();
    expect(cfg).toHaveProperty('vertexLocation');
    expect(cfg).toHaveProperty('model');
  });
});
