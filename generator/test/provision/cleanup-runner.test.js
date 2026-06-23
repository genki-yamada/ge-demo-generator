import { describe, it, expect, vi } from 'vitest';
import { makeCleanupRunner } from '../../src/provision/cleanup-runner.js';

const DEMO_ID = 'demo-retail-acme';
const DEMO = { id: DEMO_ID, state: 'deleting' };
const SCRIPT_TEXT = '#!/bin/bash\nread -p "Delete? (y/n)" -n 1 -r\n';
const HEADLESS_SCRIPT = '#!/bin/bash\nREPLY="${ASSUME_YES:+y}"; REPLY="${REPLY:-y}"  # auto-yes (headless)\n';
const EXEC_ID = 'projects/p/locations/r/jobs/j/executions/exec-cleanup-1';
const NOW_STRING = '2026-06-22T00:00:00.000Z';
const NOW_FN = () => NOW_STRING;

function makeStubs({ runCleanupOk = true } = {}) {
  const scriptStore = {
    fetch: vi.fn().mockResolvedValue(SCRIPT_TEXT),
    remove: vi.fn().mockResolvedValue(undefined),
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

    it('calls jobRunner.runCleanup with the headless (deinteractivized) script', async () => {
      const { scriptStore, deinteractivize, jobRunner, registry } = makeStubs();
      const runner = makeCleanupRunner({ scriptStore, deinteractivize, jobRunner, registry, now: NOW_FN });

      await runner.runCleanup({ demo: DEMO });

      expect(jobRunner.runCleanup).toHaveBeenCalledOnce();
      const callArg = jobRunner.runCleanup.mock.calls[0][0];
      expect(callArg.demo).toBe(DEMO);
      expect(callArg.script).toBe(HEADLESS_SCRIPT);
    });

    it('calls registry.finishCleanup with demo.id, ok, and now() result', async () => {
      const { scriptStore, deinteractivize, jobRunner, registry } = makeStubs({ runCleanupOk: true });
      const runner = makeCleanupRunner({ scriptStore, deinteractivize, jobRunner, registry, now: NOW_FN });

      await runner.runCleanup({ demo: DEMO });

      expect(registry.finishCleanup).toHaveBeenCalledOnce();
      expect(registry.finishCleanup).toHaveBeenCalledWith(DEMO_ID, true, NOW_STRING);
    });
  });

  describe('on successful cleanup (ok=true)', () => {
    it('calls scriptStore.remove after finishCleanup', async () => {
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

    it('does NOT call scriptStore.remove when ok=false', async () => {
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
});
