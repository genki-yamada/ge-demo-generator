/**
 * cleanup-runner.js — orchestrates headless cleanup of a demo via Cloud Run Job.
 *
 * Lifecycle (all deps injected, fully testable without network):
 *   1. Fetch saved setup script from GCS via scriptStore.
 *   2. Deinteractivize the script (strip read -p prompts) so it runs headlessly.
 *   3. Collect secrets (optional; secretStore not yet implemented — defaults to {}).
 *   4. Dispatch the Cloud Run Job with --cleanup arg via jobRunner.runCleanup.
 *   5. Transition lifecycle state via registry.finishCleanup (deleting → deleted | delete_failed).
 *   6. On success only: remove the script from GCS (ADR-0004 — keep GCS clean).
 *   7. Return { demoId, executionId, allOk }.
 *
 * Per-resource structured results (which GCP resource was deleted/failed) are DEFERRED.
 * They require Cloud Logging integration to parse Job task output. This is tracked as a
 * follow-up task. For now, allOk is the single success signal.
 *
 * Script delivery: the headless script is passed as SCRIPT_CONTENT (base64 env var) to
 * the Cloud Run Job. See job-runner.runCleanup for the rationale and size considerations.
 *
 * @param {object} opts
 * @param {object} opts.scriptStore      - { fetch(demoId), remove(demoId) }
 * @param {Function} opts.deinteractivize - (scriptText) => headlessScript
 * @param {object} opts.jobRunner        - { runCleanup({ demo, script, secrets, now }) }
 * @param {object} opts.registry         - { finishCleanup(id, ok, now) }
 * @param {object} [opts.secretStore]    - Optional. Not yet implemented; reserved for future.
 * @param {Function} opts.now            - () => ISO date string
 */
export function makeCleanupRunner({ scriptStore, deinteractivize, jobRunner, registry, secretStore = null, now }) {
  return {
    /**
     * Run the cleanup lifecycle for a demo that is already in `deleting` state.
     *
     * @param {object} opts
     * @param {object} opts.demo  - Demo object in `deleting` state (must have .id)
     * @returns {Promise<{ demoId: string, executionId: string|null, allOk: boolean }>}
     */
    async runCleanup({ demo }) {
      // 1. Fetch the saved provisioning script from GCS
      const script = await scriptStore.fetch(demo.id);

      // 2. Deinteractivize: strip read -p prompts so it runs headlessly with ASSUME_YES
      const headless = deinteractivize(script);

      // 3. Collect secrets for the Job (secretStore integration is deferred; use empty map)
      // TODO: when secretStore is wired, collect demo-scoped secrets here.
      const secrets = {};

      // 4. Dispatch the Cloud Run Job with --cleanup arg
      const { ok, executionId } = await jobRunner.runCleanup({ demo, script: headless, secrets, now });

      // 5. Transition lifecycle: deleting → deleted (ok) | delete_failed (!ok)
      await registry.finishCleanup(demo.id, ok, now());

      // 6. On success only: remove the script from GCS (keep storage clean; ADR-0004)
      if (ok) {
        await scriptStore.remove(demo.id);
      }

      // 7. Return summary. Per-resource structured results are deferred (need Cloud Logging).
      return { demoId: demo.id, executionId, allOk: ok };
    },
  };
}
