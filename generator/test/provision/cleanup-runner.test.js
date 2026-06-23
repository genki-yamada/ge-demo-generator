import { describe, it, expect, vi } from 'vitest';
import { makeCleanupRunner } from '../../src/provision/cleanup-runner.js';

const DEMO_ID = 'demo-retail-acme';
const DEMO = { id: DEMO_ID, state: 'deleting' };
const SCRIPT_TEXT = '#!/bin/bash\nread -p "Delete? (y/n)" -n 1 -r\n';
const HEADLESS_SCRIPT = '#!/bin/bash\nREPLY="${ASSUME_YES:+y}"; REPLY="${REPLY:-y}"  # auto-yes (headless)\n';
const CLEANUP_SCRIPT_REF = `gs://test-bucket/scripts/${DEMO_ID}-cleanup.sh`;
const EXEC_ID = 'projects/p/locations/r/jobs/j/executions/exec-cleanup-1';
const NOW_STRING = '2026-06-22T00:00:00.000Z';
const NOW_FN = () => NOW_STRING;

function makeStubs({ runCleanupOk = true } = {}) {
  const scriptStore = {
    fetch: vi.fn().mockResolvedValue(SCRIPT_TEXT),
    remove: vi.fn().mockResolvedValue(undefined),
    saveCleanup: vi.fn().mockResolvedValue(CLEANUP_SCRIPT_REF),
    removeCleanup: vi.fn().mockResolvedValue(undefined),
  };

  const deinteractivize = vi.fn().mockReturnValue(HEADLESS_SCRIPT);

  const jobRunner = {
    runCleanup: vi.fn().mockResolvedValue({
      demoId: DEMO_ID,
      executionId: EXEC_ID,
      ok: runCleanupOk,
    }),
  };

  const registry = {
    finishCleanup: vi.fn().mockResolvedValue({ ...DEMO, state: runCleanupOk ? 'deleted' : 'delete_failed' }),
  };

  return { scriptStore, deinteractivize, jobRunner, registry };
}

describe('makeCleanupRunner / runCleanup', () => {
  describe('orchestration order and dependencies', () => {
    it('fetches the script from scriptStore using demo.id', async () => {
      const { scriptStore, deinteractivize, jobRunner, registry } = makeStubs();
      const runner = makeCleanupRunner({ scriptStore, deinteractivize, jobRunner, registry, now: NOW_FN });

      await runner.runCleanup({ demo: DEMO });

      expect(scriptStore.fetch).toHaveBeenCalledOnce();
      expect(scriptStore.fetch).toHaveBeenCalledWith(DEMO_ID);
    });

    it('passes fetched script through deinteractivize', async () => {
      const { scriptStore, deinteractivize, jobRunner, registry } = makeStubs();
      const runner = makeCleanupRunner({ scriptStore, deinteractivize, jobRunner, registry, now: NOW_FN });

      await runner.runCleanup({ demo: DEMO });

      expect(deinteractivize).toHaveBeenCalledOnce();
      expect(deinteractivize).toHaveBeenCalledWith(SCRIPT_TEXT);
    });

    it('saves the headless script to GCS via scriptStore.saveCleanup', async () => {
      const { scriptStore, deinteractivize, jobRunner, registry } = makeStubs();
      const runner = makeCleanupRunner({ scriptStore, deinteractivize, jobRunner, registry, now: NOW_FN });

      await runner.runCleanup({ demo: DEMO });

      expect(scriptStore.saveCleanup).toHaveBeenCalledOnce();
      expect(scriptStore.saveCleanup).toHaveBeenCalledWith(DEMO_ID, HEADLESS_SCRIPT);
    });

    it('calls jobRunner.runCleanup with the GCS scriptRef (not inline script)', async () => {
      const { scriptStore, deinteractivize, jobRunner, registry } = makeStubs();
      const runner = makeCleanupRunner({ scriptStore, deinteractivize, jobRunner, registry, now: NOW_FN });

      await runner.runCleanup({ demo: DEMO });

      expect(jobRunner.runCleanup).toHaveBeenCalledOnce();
      const callArg = jobRunner.runCleanup.mock.calls[0][0];
      expect(callArg.demo).toBe(DEMO);
      expect(callArg.scriptRef).toBe(CLEANUP_SCRIPT_REF);
      expect(callArg).not.toHaveProperty('script');
    });

    it('calls registry.finishCleanup with demo.id, ok, and now() result', async () => {
      const { scriptStore, deinteractivize, jobRunner, registry } = makeStubs({ runCleanupOk: true });
      const runner = makeCleanupRunner({ scriptStore, deinteractivize, jobRunner, registry, now: NOW_FN });

      await runner.runCleanup({ demo: DEMO });

      expect(registry.finishCleanup).toHaveBeenCalledOnce();
      expect(registry.finishCleanup).toHaveBeenCalledWith(DEMO_ID, true, NOW_STRING);
    });

    it('always calls scriptStore.removeCleanup regardless of ok', async () => {
      for (const runCleanupOk of [true, false]) {
        const { scriptStore, deinteractivize, jobRunner, registry } = makeStubs({ runCleanupOk });
        const runner = makeCleanupRunner({ scriptStore, deinteractivize, jobRunner, registry, now: NOW_FN });

        await runner.runCleanup({ demo: DEMO });

        expect(scriptStore.removeCleanup).toHaveBeenCalledOnce();
        expect(scriptStore.removeCleanup).toHaveBeenCalledWith(DEMO_ID);
      }
    });
  });

  describe('on successful cleanup (ok=true)', () => {
    it('calls scriptStore.remove (original) after finishCleanup and removeCleanup', async () => {
      const { scriptStore, deinteractivize, jobRunner, registry } = makeStubs({ runCleanupOk: true });
      const runner = makeCleanupRunner({ scriptStore, deinteractivize, jobRunner, registry, now: NOW_FN });

      await runner.runCleanup({ demo: DEMO });

      expect(scriptStore.remove).toHaveBeenCalledOnce();
      expect(scriptStore.remove).toHaveBeenCalledWith(DEMO_ID);
    });

    it('returns { demoId, executionId, allOk: true }', async () => {
      const { scriptStore, deinteractivize, jobRunner, registry } = makeStubs({ runCleanupOk: true });
      const runner = makeCleanupRunner({ scriptStore, deinteractivize, jobRunner, registry, now: NOW_FN });

      const result = await runner.runCleanup({ demo: DEMO });

      expect(result).toEqual({ demoId: DEMO_ID, executionId: EXEC_ID, allOk: true });
    });
  });

  describe('on failed cleanup (ok=false)', () => {
    it('calls finishCleanup with ok=false', async () => {
      const { scriptStore, deinteractivize, jobRunner, registry } = makeStubs({ runCleanupOk: false });
      const runner = makeCleanupRunner({ scriptStore, deinteractivize, jobRunner, registry, now: NOW_FN });

      await runner.runCleanup({ demo: DEMO });

      expect(registry.finishCleanup).toHaveBeenCalledOnce();
      expect(registry.finishCleanup).toHaveBeenCalledWith(DEMO_ID, false, NOW_STRING);
    });

    it('calls scriptStore.removeCleanup even when ok=false (temp object always cleaned up)', async () => {
      const { scriptStore, deinteractivize, jobRunner, registry } = makeStubs({ runCleanupOk: false });
      const runner = makeCleanupRunner({ scriptStore, deinteractivize, jobRunner, registry, now: NOW_FN });

      await runner.runCleanup({ demo: DEMO });

      expect(scriptStore.removeCleanup).toHaveBeenCalledOnce();
      expect(scriptStore.removeCleanup).toHaveBeenCalledWith(DEMO_ID);
    });

    it('does NOT call scriptStore.remove (original) when ok=false', async () => {
      const { scriptStore, deinteractivize, jobRunner, registry } = makeStubs({ runCleanupOk: false });
      const runner = makeCleanupRunner({ scriptStore, deinteractivize, jobRunner, registry, now: NOW_FN });

      await runner.runCleanup({ demo: DEMO });

      expect(scriptStore.remove).not.toHaveBeenCalled();
    });

    it('returns { demoId, executionId, allOk: false }', async () => {
      const { scriptStore, deinteractivize, jobRunner, registry } = makeStubs({ runCleanupOk: false });
      const runner = makeCleanupRunner({ scriptStore, deinteractivize, jobRunner, registry, now: NOW_FN });

      const result = await runner.runCleanup({ demo: DEMO });

      expect(result).toEqual({ demoId: DEMO_ID, executionId: EXEC_ID, allOk: false });
    });
  });

  describe('with no secretStore (optional dep)', () => {
    it('passes empty secrets to jobRunner.runCleanup when secretStore is omitted', async () => {
      const { scriptStore, deinteractivize, jobRunner, registry } = makeStubs();
      // no secretStore passed
      const runner = makeCleanupRunner({ scriptStore, deinteractivize, jobRunner, registry, now: NOW_FN });

      await runner.runCleanup({ demo: DEMO });

      const callArg = jobRunner.runCleanup.mock.calls[0][0];
      expect(callArg.secrets).toEqual({});
    });
  });

  describe('robustness: pre-job failure (e.g. scriptStore.fetch rejects)', () => {
    it('calls registry.finishCleanup(demoId, false, now) even when scriptStore.fetch throws', async () => {
      // Simulates the case where scriptGcsUri was never set (non-fatal script save in build route)
      // so scriptStore.fetch rejects. The demo must NOT be left stuck in `deleting`.
      const { scriptStore, deinteractivize, jobRunner, registry } = makeStubs();
      const fetchError = new Error('GCS object not found');
      scriptStore.fetch = vi.fn().mockRejectedValue(fetchError);
      registry.finishCleanup = vi.fn().mockResolvedValue({ ...DEMO, state: 'delete_failed' });

      const runner = makeCleanupRunner({ scriptStore, deinteractivize, jobRunner, registry, now: NOW_FN });

      // runCleanup should not throw — it resolves (finishCleanup was called)
      await runner.runCleanup({ demo: DEMO });

      // Demo is transitioned to delete_failed, NOT stuck in deleting
      expect(registry.finishCleanup).toHaveBeenCalledOnce();
      expect(registry.finishCleanup).toHaveBeenCalledWith(DEMO_ID, false, NOW_STRING);
    });

    it('still calls scriptStore.removeCleanup (try/finally) even when scriptStore.fetch throws', async () => {
      const { scriptStore, deinteractivize, jobRunner, registry } = makeStubs();
      scriptStore.fetch = vi.fn().mockRejectedValue(new Error('GCS object not found'));
      registry.finishCleanup = vi.fn().mockResolvedValue({ ...DEMO, state: 'delete_failed' });

      const runner = makeCleanupRunner({ scriptStore, deinteractivize, jobRunner, registry, now: NOW_FN });

      await runner.runCleanup({ demo: DEMO });

      // removeCleanup must always run regardless of where the failure happened
      expect(scriptStore.removeCleanup).toHaveBeenCalledOnce();
      expect(scriptStore.removeCleanup).toHaveBeenCalledWith(DEMO_ID);
    });

    it('does NOT call scriptStore.remove (original) when scriptStore.fetch throws', async () => {
      const { scriptStore, deinteractivize, jobRunner, registry } = makeStubs();
      scriptStore.fetch = vi.fn().mockRejectedValue(new Error('GCS object not found'));
      registry.finishCleanup = vi.fn().mockResolvedValue({ ...DEMO, state: 'delete_failed' });

      const runner = makeCleanupRunner({ scriptStore, deinteractivize, jobRunner, registry, now: NOW_FN });

      await runner.runCleanup({ demo: DEMO });

      expect(scriptStore.remove).not.toHaveBeenCalled();
    });

    it('propagates if finishCleanup itself throws (concurrent-finish guard)', async () => {
      // If finishCleanup throws (e.g. concurrent job already finished → invalid transition),
      // runCleanup should let it propagate. removeCleanup still runs first (try/finally).
      const { scriptStore, deinteractivize, jobRunner, registry } = makeStubs();
      scriptStore.fetch = vi.fn().mockRejectedValue(new Error('fetch failed'));
      const finishError = new Error('invalid transition');
      registry.finishCleanup = vi.fn().mockRejectedValue(finishError);

      const runner = makeCleanupRunner({ scriptStore, deinteractivize, jobRunner, registry, now: NOW_FN });

      await expect(runner.runCleanup({ demo: DEMO })).rejects.toThrow('invalid transition');
      // removeCleanup still ran before the propagation
      expect(scriptStore.removeCleanup).toHaveBeenCalledOnce();
    });
  });
});
