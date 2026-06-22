import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildServices } from '../src/services.js';

/**
 * services.test.js — composition root (W-B).
 *
 * buildServices takes INJECTED fake clients (no network). We assert that the
 * returned `services` object has the expected shape and that a few representative
 * bound functions call through to the injected fakes with the right deps.
 * Deep behaviour of each bound fn is covered by its own module's tests; here we
 * verify the WIRING (correct deps, correct shape, partial generateDemo).
 */

const NOW_RE = /^\d{4}-\d{2}-\d{2}T/;

function makeFakeClients(overrides = {}) {
  // vertexClient.generateContent returns text (string). Default returns a value
  // research/optimizeGoal can JSON-parse or trim; we tune per-test where needed.
  const generateContent = vi.fn().mockResolvedValue('plain text');
  const vertexClient = { generateContent };

  const tableGet = vi.fn().mockResolvedValue(undefined);
  const tablesList = vi.fn().mockResolvedValue({ tables: [] });
  const bqClient = { tableGet, tablesList };

  const runJob = vi.fn();
  const jobsClient = { runJob };

  const createSecret = vi.fn().mockResolvedValue([{}]);
  const addSecretVersion = vi.fn().mockResolvedValue([{}]);
  const accessSecretVersion = vi.fn();
  const secretManagerClient = { createSecret, addSecretVersion, accessSecretVersion };

  const config = {
    projectId: 'proj-123',
    region: 'asia-northeast1',
    vertexLocation: 'global',
    model: 'gemini-3.5-flash',
    searchModel: 'gemini-3.1-flash-lite',
    maxRetries: 3,
    retryDelayMs: 1000,
    databaseId: 'generator',
    githubToken: 'ghp_fake',
    jobName: 'provisioner',
    appVersion: 'v10.100-public',
  };

  return { vertexClient, bqClient, jobsClient, secretManagerClient, config, ...overrides };
}

describe('buildServices — composition root', () => {
  let clients;
  let services;

  beforeEach(() => {
    clients = makeFakeClients();
    ({ services } = buildServices(clients));
  });

  it('returns a services object with the expected keys', () => {
    expect(services).toBeTypeOf('object');
    for (const key of [
      'generateDemo',
      'deinteractivize',
      'jobRunner',
      'makeSecretStore',
      'research',
      'optimizeGoal',
      'analyzeMcp',
      'now',
    ]) {
      expect(services, `missing key: ${key}`).toHaveProperty(key);
    }
    // The retired single-instance secretStore must NOT be present.
    expect(services).not.toHaveProperty('secretStore');
  });

  it('binds research to call vertexClient.generateContent', async () => {
    clients.vertexClient.generateContent.mockResolvedValueOnce(
      JSON.stringify({ companyName: 'Acme', suggestedGoal: 'do things' })
    );
    const result = await services.research('acme.com');
    expect(clients.vertexClient.generateContent).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    expect(result.companyName).toBe('Acme');
  });

  it('binds optimizeGoal to call vertexClient.generateContent', async () => {
    clients.vertexClient.generateContent.mockResolvedValueOnce('  # Optimized\nbody  ');
    const result = await services.optimizeGoal('raw goal');
    expect(clients.vertexClient.generateContent).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    expect(result.optimizedGoal).toBe('# Optimized\nbody');
  });

  it('binds analyzeMcp as a single-arg (repoUrl) function', () => {
    // analyzeMcp reaches GitHub via global fetch (no injection point through this
    // binding), so we don't exercise the network path here — mcp.js's own tests
    // cover behaviour. We assert the WIRING: a function taking just the repoUrl,
    // with vertexClient + config.githubToken pre-bound.
    expect(typeof services.analyzeMcp).toBe('function');
    expect(services.analyzeMcp.length).toBe(1);
  });

  it('makeSecretStore(suffix) returns a per-request store bound to the injected client', async () => {
    const store = services.makeSecretStore('sfx01');
    expect(store).toHaveProperty('putSecret');
    expect(typeof store.putSecret).toBe('function');

    await store.putSecret('SLACK_TOKEN', 'xoxb-1');
    // Name must contain the per-request suffix (cleanup-grep invariant).
    expect(clients.secretManagerClient.createSecret).toHaveBeenCalledOnce();
    expect(clients.secretManagerClient.createSecret.mock.calls[0][0].secretId).toBe(
      'demo-sfx01-SLACK_TOKEN'
    );
    expect(clients.secretManagerClient.addSecretVersion).toHaveBeenCalledOnce();
  });

  it('jobRunner is bound with runProvision', () => {
    expect(services.jobRunner).toHaveProperty('runProvision');
    expect(typeof services.jobRunner.runProvision).toBe('function');
  });

  it('generateDemo is a partial: a function the route completes with {userEmail, registry, now}', () => {
    expect(typeof services.generateDemo).toBe('function');
    // Arity: (userGoal, options, routeDeps)
    expect(services.generateDemo.length).toBe(3);
  });

  it('deinteractivize is bound (the raw transformer)', () => {
    expect(typeof services.deinteractivize).toBe('function');
    const out = services.deinteractivize('#!/bin/bash\necho hi');
    expect(out).toContain('echo hi');
  });

  it('now() returns an ISO timestamp string', () => {
    expect(typeof services.now).toBe('function');
    expect(services.now()).toMatch(NOW_RE);
  });
});
