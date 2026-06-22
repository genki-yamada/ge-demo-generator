import { describe, it, expect } from 'vitest';
import { generateSetupScript } from '../../src/codegen/generate-setup-script.js';

// golden-independent minimum guarantees.
const DEPS = {
  appVersion: 'v10.100-public',
  now: () => '2025-01-01T00:00:00.000Z',
  callVertexAI: () => { throw new Error('unavailable in test'); },
};

const base = {
  datasetId: 'ge_demo_smoke_ds',
  systemInstruction: 'You are a helpful assistant.',
  referenceDate: '2025-01-01',
  publicDatasetId: '',
  suffix: 'smk01',
  tables: [],
  firestore: null,
  userGoal: 'Smoke-test minimal setup.',
  dirName: 'ge-demo-smoke',
  agentShortName: 'SmokeAgent',
  oneSentenceSummary: 'A smoke-test demo agent.',
  enableWorkspaceMcp: false,
  metadata: null,
};

describe('generateSetupScript smoke', () => {
  it('produces a bash script with cleanup wiring', () => {
    // spread so the test stays isolated if `base` ever gains importedMcpList
    // (generateSetupScript mutates that field in place)
    const out = generateSetupScript({ ...base }, DEPS);
    expect(out.startsWith('#!/bin/bash')).toBe(true);
    expect(out).toContain('--cleanup');
    expect(out).toContain('CLEANUP_MODE');
  });
});
