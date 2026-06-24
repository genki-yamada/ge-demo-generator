import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeJobRunner } from '../../src/provision/job-runner.js';

const PROJECT_ID = 'test-project';
const REGION = 'asia-northeast1';
const JOB_NAME = 'provisioner';

const EXPECTED_JOB_RESOURCE_NAME = `projects/${PROJECT_ID}/locations/${REGION}/jobs/${JOB_NAME}`;

const DEMO = { id: 'demo-acme-001', suffix: 'acme-001' };
const SCRIPT_REF = 'gs://bucket/scripts/acme-001.sh';
const SECRETS = { SLACK_TOKEN: 'xoxb-abc', BQ_DATASET: 'my_dataset' };
const NOW_STRING = '2026-06-22T00:00:00.000Z';
const NOW_FN = () => NOW_STRING;

/** Build a stub jobsClient where runJob resolves successfully. */
function makeStubJobsClient({ execName = 'exec-001', fail = false } = {}) {
  const execResult = {
    name: execName,
    uid: 'uid-001',
    completionTime: NOW_STRING,
    failedCount: fail ? 1 : 0,
  };

  const operation = {
    promise: fail
      ? vi.fn().mockRejectedValue(Object.assign(new Error('Job execution failed'), { code: 2 }))
      : vi.fn().mockResolvedValue([execResult]),
  };

  return {
    runJob: vi.fn().mockResolvedValue([operation]),
  };
}

/** Build a stub registry. */
function makeStubRegistry() {
  return {
    transition: vi.fn().mockImplementation(async (id, nextState, now) => ({
      ...DEMO,
      state: nextState,
      updatedAt: now,
    })),
  };
}

describe('makeJobRunner / runProvision', () => {
  describe('calls jobsClient.runJob with correct arguments', () => {
    it('uses the fully-qualified job resource name', async () => {
      const jobsClient = makeStubJobsClient();
      const registry = makeStubRegistry();
      const runner = makeJobRunner({ jobsClient, projectId: PROJECT_ID, region: REGION, jobName: JOB_NAME });

      await runner.runProvision({ demo: DEMO, scriptRef: SCRIPT_REF, secrets: SECRETS, registry, now: NOW_FN });

      expect(jobsClient.runJob).toHaveBeenCalledOnce();
      const [callArg] = jobsClient.runJob.mock.calls[0];
      expect(callArg.name).toBe(EXPECTED_JOB_RESOURCE_NAME);
    });

    it('passes ASSUME_YES=1 in container env overrides', async () => {
      const jobsClient = makeStubJobsClient();
      const registry = makeStubRegistry();
      const runner = makeJobRunner({ jobsClient, projectId: PROJECT_ID, region: REGION, jobName: JOB_NAME });

      await runner.runProvision({ demo: DEMO, scriptRef: SCRIPT_REF, secrets: SECRETS, registry, now: NOW_FN });

      const [callArg] = jobsClient.runJob.mock.calls[0];
      const envVars = callArg.overrides.containerOverrides[0].env;
      const assumeYes = envVars.find(e => e.name === 'ASSUME_YES');
      expect(assumeYes).toBeDefined();
      expect(assumeYes.value).toBe('1');
    });

    it('passes SCRIPT_REF in container env overrides', async () => {
      const jobsClient = makeStubJobsClient();
      const registry = makeStubRegistry();
      const runner = makeJobRunner({ jobsClient, projectId: PROJECT_ID, region: REGION, jobName: JOB_NAME });

      await runner.runProvision({ demo: DEMO, scriptRef: SCRIPT_REF, secrets: SECRETS, registry, now: NOW_FN });

      const [callArg] = jobsClient.runJob.mock.calls[0];
      const envVars = callArg.overrides.containerOverrides[0].env;
      const scriptRefEnv = envVars.find(e => e.name === 'SCRIPT_REF');
      expect(scriptRefEnv).toBeDefined();
      expect(scriptRefEnv.value).toBe(SCRIPT_REF);
    });

    it('passes all secrets keys as env vars in container overrides', async () => {
      const jobsClient = makeStubJobsClient();
      const registry = makeStubRegistry();
      const runner = makeJobRunner({ jobsClient, projectId: PROJECT_ID, region: REGION, jobName: JOB_NAME });

      await runner.runProvision({ demo: DEMO, scriptRef: SCRIPT_REF, secrets: SECRETS, registry, now: NOW_FN });

      const [callArg] = jobsClient.runJob.mock.calls[0];
      const envVars = callArg.overrides.containerOverrides[0].env;

      for (const [key, value] of Object.entries(SECRETS)) {
        const envEntry = envVars.find(e => e.name === key);
        expect(envEntry, `env var ${key} should be present`).toBeDefined();
        expect(envEntry.value).toBe(value);
      }
    });
  });

  describe('on successful execution', () => {
    it('transitions demo state to active', async () => {
      const execName = 'projects/test-project/locations/asia-northeast1/jobs/provisioner/executions/exec-abc';
      const jobsClient = makeStubJobsClient({ execName });
      const registry = makeStubRegistry();
      const runner = makeJobRunner({ jobsClient, projectId: PROJECT_ID, region: REGION, jobName: JOB_NAME });

      const result = await runner.runProvision({ demo: DEMO, scriptRef: SCRIPT_REF, secrets: SECRETS, registry, now: NOW_FN });

      expect(registry.transition).toHaveBeenCalledOnce();
      expect(registry.transition).toHaveBeenCalledWith(DEMO.id, 'active', NOW_STRING);
      expect(result.state).toBe('active');
      expect(result.ok).toBe(true);
    });

    it('returns the executionId from the operation result', async () => {
      const execName = 'projects/test-project/locations/asia-northeast1/jobs/provisioner/executions/exec-abc';
      const jobsClient = makeStubJobsClient({ execName });
      const registry = makeStubRegistry();
      const runner = makeJobRunner({ jobsClient, projectId: PROJECT_ID, region: REGION, jobName: JOB_NAME });

      const result = await runner.runProvision({ demo: DEMO, scriptRef: SCRIPT_REF, secrets: SECRETS, registry, now: NOW_FN });

      expect(result.executionId).toBe(execName);
      expect(result.demoId).toBe(DEMO.id);
    });
  });

  describe('on failed execution (operation rejects)', () => {
    it('transitions demo state to build_failed', async () => {
      const jobsClient = makeStubJobsClient({ fail: true });
      const registry = makeStubRegistry();
      const runner = makeJobRunner({ jobsClient, projectId: PROJECT_ID, region: REGION, jobName: JOB_NAME });

      const result = await runner.runProvision({ demo: DEMO, scriptRef: SCRIPT_REF, secrets: SECRETS, registry, now: NOW_FN });

      expect(registry.transition).toHaveBeenCalledOnce();
      expect(registry.transition).toHaveBeenCalledWith(DEMO.id, 'build_failed', NOW_STRING);
      expect(result.state).toBe('build_failed');
      expect(result.ok).toBe(false);
    });

    it('returns ok=false and demoId on failure', async () => {
      const jobsClient = makeStubJobsClient({ fail: true });
      const registry = makeStubRegistry();
      const runner = makeJobRunner({ jobsClient, projectId: PROJECT_ID, region: REGION, jobName: JOB_NAME });

      const result = await runner.runProvision({ demo: DEMO, scriptRef: SCRIPT_REF, secrets: SECRETS, registry, now: NOW_FN });

      expect(result.ok).toBe(false);
      expect(result.demoId).toBe(DEMO.id);
    });
  });

  describe('on failed execution (operation resolves but failedCount > 0)', () => {
    it('transitions demo state to build_failed', async () => {
      // Stub: operation resolves (no infra error) but execution reports task failures
      const execName = 'exec-001';
      const operation = {
        promise: vi.fn().mockResolvedValue([{ name: execName, failedCount: 1 }]),
      };
      const jobsClient = { runJob: vi.fn().mockResolvedValue([operation]) };
      const registry = makeStubRegistry();
      const runner = makeJobRunner({ jobsClient, projectId: PROJECT_ID, region: REGION, jobName: JOB_NAME });

      const result = await runner.runProvision({ demo: DEMO, scriptRef: SCRIPT_REF, secrets: SECRETS, registry, now: NOW_FN });

      expect(registry.transition).toHaveBeenCalledOnce();
      expect(registry.transition).toHaveBeenCalledWith(DEMO.id, 'build_failed', NOW_STRING);
      expect(result.state).toBe('build_failed');
      expect(result.ok).toBe(false);
      // executionId is populated because the operation resolved (execution.name is available)
      expect(result.executionId).toBe(execName);
      expect(result.demoId).toBe(DEMO.id);
    });
  });

  describe('with empty secrets', () => {
    it('still passes ASSUME_YES and SCRIPT_REF even with no secrets', async () => {
      const jobsClient = makeStubJobsClient();
      const registry = makeStubRegistry();
      const runner = makeJobRunner({ jobsClient, projectId: PROJECT_ID, region: REGION, jobName: JOB_NAME });

      await runner.runProvision({ demo: DEMO, scriptRef: SCRIPT_REF, secrets: {}, registry, now: NOW_FN });

      const [callArg] = jobsClient.runJob.mock.calls[0];
      const envVars = callArg.overrides.containerOverrides[0].env;
      expect(envVars.find(e => e.name === 'ASSUME_YES')).toBeDefined();
      expect(envVars.find(e => e.name === 'SCRIPT_REF')).toBeDefined();
    });
  });

  describe('with envRef provided', () => {
    const ENV_REF = 'gs://my-bucket/envs/demo-acme-001.env';

    it('appends DEMO_DIR=demo.id and ENV_REF to the env array', async () => {
      const jobsClient = makeStubJobsClient();
      const registry = makeStubRegistry();
      const runner = makeJobRunner({ jobsClient, projectId: PROJECT_ID, region: REGION, jobName: JOB_NAME });

      await runner.runProvision({ demo: DEMO, scriptRef: SCRIPT_REF, secrets: SECRETS, registry, now: NOW_FN, envRef: ENV_REF });

      const [callArg] = jobsClient.runJob.mock.calls[0];
      const envVars = callArg.overrides.containerOverrides[0].env;
      const demoDir = envVars.find(e => e.name === 'DEMO_DIR');
      const envRefEntry = envVars.find(e => e.name === 'ENV_REF');
      expect(demoDir).toBeDefined();
      expect(demoDir.value).toBe(DEMO.id);
      expect(envRefEntry).toBeDefined();
      expect(envRefEntry.value).toBe(ENV_REF);
    });

    it('still includes SCRIPT_REF, ASSUME_YES, and secrets when envRef is provided', async () => {
      const jobsClient = makeStubJobsClient();
      const registry = makeStubRegistry();
      const runner = makeJobRunner({ jobsClient, projectId: PROJECT_ID, region: REGION, jobName: JOB_NAME });

      await runner.runProvision({ demo: DEMO, scriptRef: SCRIPT_REF, secrets: SECRETS, registry, now: NOW_FN, envRef: ENV_REF });

      const [callArg] = jobsClient.runJob.mock.calls[0];
      const envVars = callArg.overrides.containerOverrides[0].env;
      expect(envVars.find(e => e.name === 'SCRIPT_REF')?.value).toBe(SCRIPT_REF);
      expect(envVars.find(e => e.name === 'ASSUME_YES')?.value).toBe('1');
      for (const [key, value] of Object.entries(SECRETS)) {
        expect(envVars.find(e => e.name === key)?.value).toBe(value);
      }
    });
  });

  describe('without envRef (backward-compat)', () => {
    it('does NOT include DEMO_DIR or ENV_REF when envRef is omitted', async () => {
      const jobsClient = makeStubJobsClient();
      const registry = makeStubRegistry();
      const runner = makeJobRunner({ jobsClient, projectId: PROJECT_ID, region: REGION, jobName: JOB_NAME });

      await runner.runProvision({ demo: DEMO, scriptRef: SCRIPT_REF, secrets: SECRETS, registry, now: NOW_FN });

      const [callArg] = jobsClient.runJob.mock.calls[0];
      const envVars = callArg.overrides.containerOverrides[0].env;
      expect(envVars.find(e => e.name === 'DEMO_DIR')).toBeUndefined();
      expect(envVars.find(e => e.name === 'ENV_REF')).toBeUndefined();
    });

    it('does NOT include DEMO_DIR or ENV_REF when envRef is an empty string', async () => {
      const jobsClient = makeStubJobsClient();
      const registry = makeStubRegistry();
      const runner = makeJobRunner({ jobsClient, projectId: PROJECT_ID, region: REGION, jobName: JOB_NAME });

      await runner.runProvision({ demo: DEMO, scriptRef: SCRIPT_REF, secrets: SECRETS, registry, now: NOW_FN, envRef: '' });

      const [callArg] = jobsClient.runJob.mock.calls[0];
      const envVars = callArg.overrides.containerOverrides[0].env;
      expect(envVars.find(e => e.name === 'DEMO_DIR')).toBeUndefined();
      expect(envVars.find(e => e.name === 'ENV_REF')).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// runCleanup
// ---------------------------------------------------------------------------

const CLEANUP_SCRIPT_REF = 'gs://bucket/scripts/acme-001-cleanup.sh';

describe('makeJobRunner / runCleanup', () => {
  describe('calls jobsClient.runJob with correct arguments', () => {
    it('uses the fully-qualified job resource name', async () => {
      const jobsClient = makeStubJobsClient();
      const runner = makeJobRunner({ jobsClient, projectId: PROJECT_ID, region: REGION, jobName: JOB_NAME });

      await runner.runCleanup({ demo: DEMO, scriptRef: CLEANUP_SCRIPT_REF, secrets: {} });

      expect(jobsClient.runJob).toHaveBeenCalledOnce();
      const [callArg] = jobsClient.runJob.mock.calls[0];
      expect(callArg.name).toBe(EXPECTED_JOB_RESOURCE_NAME);
    });

    it('passes args: ["--cleanup"] in containerOverrides', async () => {
      const jobsClient = makeStubJobsClient();
      const runner = makeJobRunner({ jobsClient, projectId: PROJECT_ID, region: REGION, jobName: JOB_NAME });

      await runner.runCleanup({ demo: DEMO, scriptRef: CLEANUP_SCRIPT_REF, secrets: {} });

      const [callArg] = jobsClient.runJob.mock.calls[0];
      const override = callArg.overrides.containerOverrides[0];
      expect(override.args).toEqual(['--cleanup']);
    });

    it('passes ASSUME_YES=1 in container env overrides', async () => {
      const jobsClient = makeStubJobsClient();
      const runner = makeJobRunner({ jobsClient, projectId: PROJECT_ID, region: REGION, jobName: JOB_NAME });

      await runner.runCleanup({ demo: DEMO, scriptRef: CLEANUP_SCRIPT_REF, secrets: {} });

      const [callArg] = jobsClient.runJob.mock.calls[0];
      const envVars = callArg.overrides.containerOverrides[0].env;
      const assumeYes = envVars.find(e => e.name === 'ASSUME_YES');
      expect(assumeYes).toBeDefined();
      expect(assumeYes.value).toBe('1');
    });

    it('passes CLEANUP_MODE=1 in container env overrides', async () => {
      const jobsClient = makeStubJobsClient();
      const runner = makeJobRunner({ jobsClient, projectId: PROJECT_ID, region: REGION, jobName: JOB_NAME });

      await runner.runCleanup({ demo: DEMO, scriptRef: CLEANUP_SCRIPT_REF, secrets: {} });

      const [callArg] = jobsClient.runJob.mock.calls[0];
      const envVars = callArg.overrides.containerOverrides[0].env;
      const cleanupMode = envVars.find(e => e.name === 'CLEANUP_MODE');
      expect(cleanupMode).toBeDefined();
      expect(cleanupMode.value).toBe('1');
    });

    it('passes SCRIPT_REF (GCS URI) in container env overrides — no base64 inline script', async () => {
      const jobsClient = makeStubJobsClient();
      const runner = makeJobRunner({ jobsClient, projectId: PROJECT_ID, region: REGION, jobName: JOB_NAME });

      await runner.runCleanup({ demo: DEMO, scriptRef: CLEANUP_SCRIPT_REF, secrets: {} });

      const [callArg] = jobsClient.runJob.mock.calls[0];
      const envVars = callArg.overrides.containerOverrides[0].env;
      const scriptRefEnv = envVars.find(e => e.name === 'SCRIPT_REF');
      expect(scriptRefEnv).toBeDefined();
      expect(scriptRefEnv.value).toBe(CLEANUP_SCRIPT_REF);
      // SCRIPT_CONTENT (base64 inline delivery) must not be present — it would exceed env var limits
      expect(envVars.find(e => e.name === 'SCRIPT_CONTENT')).toBeUndefined();
    });

    it('passes all secrets keys as env vars in container overrides', async () => {
      const jobsClient = makeStubJobsClient();
      const runner = makeJobRunner({ jobsClient, projectId: PROJECT_ID, region: REGION, jobName: JOB_NAME });

      await runner.runCleanup({ demo: DEMO, scriptRef: CLEANUP_SCRIPT_REF, secrets: SECRETS });

      const [callArg] = jobsClient.runJob.mock.calls[0];
      const envVars = callArg.overrides.containerOverrides[0].env;

      for (const [key, value] of Object.entries(SECRETS)) {
        const envEntry = envVars.find(e => e.name === key);
        expect(envEntry, `env var ${key} should be present`).toBeDefined();
        expect(envEntry.value).toBe(value);
      }
    });
  });

  describe('does NOT perform a state transition (no registry param)', () => {
    // makeJobRunner receives no registry — the structural guarantee is that it cannot
    // call registry.transition even if it wanted to. These tests confirm the return
    // shape has no `state` key, proving no transition was attempted by runCleanup.
    it('return value has no state key on success (transition belongs to cleanup-runner)', async () => {
      const jobsClient = makeStubJobsClient();
      const runner = makeJobRunner({ jobsClient, projectId: PROJECT_ID, region: REGION, jobName: JOB_NAME });

      const result = await runner.runCleanup({ demo: DEMO, scriptRef: CLEANUP_SCRIPT_REF, secrets: {} });

      expect(result).not.toHaveProperty('state');
    });

    it('return value has no state key on failure (transition belongs to cleanup-runner)', async () => {
      const jobsClient = makeStubJobsClient({ fail: true });
      const runner = makeJobRunner({ jobsClient, projectId: PROJECT_ID, region: REGION, jobName: JOB_NAME });

      const result = await runner.runCleanup({ demo: DEMO, scriptRef: CLEANUP_SCRIPT_REF, secrets: {} });

      expect(result).not.toHaveProperty('state');
    });
  });

  describe('on successful execution', () => {
    it('returns ok=true and executionId', async () => {
      const execName = 'projects/test-project/locations/asia-northeast1/jobs/provisioner/executions/exec-cleanup-1';
      const jobsClient = makeStubJobsClient({ execName });
      const runner = makeJobRunner({ jobsClient, projectId: PROJECT_ID, region: REGION, jobName: JOB_NAME });

      const result = await runner.runCleanup({ demo: DEMO, scriptRef: CLEANUP_SCRIPT_REF, secrets: {} });

      expect(result.ok).toBe(true);
      expect(result.executionId).toBe(execName);
      expect(result.demoId).toBe(DEMO.id);
    });
  });

  describe('on failed execution (operation rejects)', () => {
    it('returns ok=false and demoId', async () => {
      const jobsClient = makeStubJobsClient({ fail: true });
      const runner = makeJobRunner({ jobsClient, projectId: PROJECT_ID, region: REGION, jobName: JOB_NAME });

      const result = await runner.runCleanup({ demo: DEMO, scriptRef: CLEANUP_SCRIPT_REF, secrets: {} });

      expect(result.ok).toBe(false);
      expect(result.demoId).toBe(DEMO.id);
    });
  });

  describe('on failed execution (operation resolves but failedCount > 0)', () => {
    it('returns ok=false', async () => {
      const execName = 'exec-cleanup-fail';
      const operation = {
        promise: vi.fn().mockResolvedValue([{ name: execName, failedCount: 1 }]),
      };
      const jobsClient = { runJob: vi.fn().mockResolvedValue([operation]) };
      const runner = makeJobRunner({ jobsClient, projectId: PROJECT_ID, region: REGION, jobName: JOB_NAME });

      const result = await runner.runCleanup({ demo: DEMO, scriptRef: CLEANUP_SCRIPT_REF, secrets: {} });

      expect(result.ok).toBe(false);
      expect(result.executionId).toBe(execName);
      expect(result.demoId).toBe(DEMO.id);
    });
  });

  describe('with envRef provided', () => {
    const ENV_REF = 'gs://my-bucket/envs/demo-acme-001.env';

    it('appends DEMO_DIR=demo.id and ENV_REF to the env array', async () => {
      const jobsClient = makeStubJobsClient();
      const runner = makeJobRunner({ jobsClient, projectId: PROJECT_ID, region: REGION, jobName: JOB_NAME });

      await runner.runCleanup({ demo: DEMO, scriptRef: CLEANUP_SCRIPT_REF, secrets: SECRETS, envRef: ENV_REF });

      const [callArg] = jobsClient.runJob.mock.calls[0];
      const envVars = callArg.overrides.containerOverrides[0].env;
      const demoDir = envVars.find(e => e.name === 'DEMO_DIR');
      const envRefEntry = envVars.find(e => e.name === 'ENV_REF');
      expect(demoDir).toBeDefined();
      expect(demoDir.value).toBe(DEMO.id);
      expect(envRefEntry).toBeDefined();
      expect(envRefEntry.value).toBe(ENV_REF);
    });

    it('still includes SCRIPT_REF, ASSUME_YES, CLEANUP_MODE, and secrets when envRef is provided', async () => {
      const jobsClient = makeStubJobsClient();
      const runner = makeJobRunner({ jobsClient, projectId: PROJECT_ID, region: REGION, jobName: JOB_NAME });

      await runner.runCleanup({ demo: DEMO, scriptRef: CLEANUP_SCRIPT_REF, secrets: SECRETS, envRef: ENV_REF });

      const [callArg] = jobsClient.runJob.mock.calls[0];
      const envVars = callArg.overrides.containerOverrides[0].env;
      expect(envVars.find(e => e.name === 'SCRIPT_REF')?.value).toBe(CLEANUP_SCRIPT_REF);
      expect(envVars.find(e => e.name === 'ASSUME_YES')?.value).toBe('1');
      expect(envVars.find(e => e.name === 'CLEANUP_MODE')?.value).toBe('1');
      for (const [key, value] of Object.entries(SECRETS)) {
        expect(envVars.find(e => e.name === key)?.value).toBe(value);
      }
    });
  });

  describe('without envRef (backward-compat)', () => {
    it('does NOT include DEMO_DIR or ENV_REF when envRef is omitted', async () => {
      const jobsClient = makeStubJobsClient();
      const runner = makeJobRunner({ jobsClient, projectId: PROJECT_ID, region: REGION, jobName: JOB_NAME });

      await runner.runCleanup({ demo: DEMO, scriptRef: CLEANUP_SCRIPT_REF, secrets: SECRETS });

      const [callArg] = jobsClient.runJob.mock.calls[0];
      const envVars = callArg.overrides.containerOverrides[0].env;
      expect(envVars.find(e => e.name === 'DEMO_DIR')).toBeUndefined();
      expect(envVars.find(e => e.name === 'ENV_REF')).toBeUndefined();
    });

    it('does NOT include DEMO_DIR or ENV_REF when envRef is an empty string', async () => {
      const jobsClient = makeStubJobsClient();
      const runner = makeJobRunner({ jobsClient, projectId: PROJECT_ID, region: REGION, jobName: JOB_NAME });

      await runner.runCleanup({ demo: DEMO, scriptRef: CLEANUP_SCRIPT_REF, secrets: SECRETS, envRef: '' });

      const [callArg] = jobsClient.runJob.mock.calls[0];
      const envVars = callArg.overrides.containerOverrides[0].env;
      expect(envVars.find(e => e.name === 'DEMO_DIR')).toBeUndefined();
      expect(envVars.find(e => e.name === 'ENV_REF')).toBeUndefined();
    });
  });
});
