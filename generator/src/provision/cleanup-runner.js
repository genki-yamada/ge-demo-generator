/**
 * cleanup-runner.js — orchestrates headless cleanup of a demo via Cloud Run Job.
 *
 * Lifecycle (all deps injected, fully testable without network):
 *   1. Fetch saved setup script from GCS via scriptStore.
 *   2. Deinteractivize the script (strip read -p prompts) so it runs headlessly.
 *   3. Upload the headless script to GCS as a temporary cleanup object via scriptStore.saveCleanup.
 *   4. Collect secrets (optional; secretStore not yet implemented — defaults to {}).
 *   5. Dispatch the Cloud Run Job with --cleanup arg and SCRIPT_REF (GCS URI) via jobRunner.runCleanup.
 *   6. Transition lifecycle state via registry.finishCleanup (deleting → deleted | delete_failed).
 *   7. Always: remove the temporary cleanup script from GCS (scriptStore.removeCleanup).
 *   8. On success only: remove the original setup script from GCS (ADR-0004 — keep GCS clean).
 *   9. Return { demoId, executionId, allOk }.
 *
 * Per-resource structured results (which GCP resource was deleted/failed) are DEFERRED.
 * They require Cloud Logging integration to parse Job task output. This is tracked as a
 * follow-up task. For now, allOk is the single success signal.
 *
 * Script delivery: the headless cleanup script is uploaded to GCS as a temporary object
 * (scripts/<demoId>-cleanup.sh) and delivered via the SCRIPT_REF env var. This matches the
 * provisioning flow and avoids Cloud Run env var size limits (~32 KiB), which real generated
 * scripts (~600 KB / ~800 KB base64) would exceed.
 *
 * @param {object} opts
 * @param {object} opts.scriptStore      - { fetch(demoId), remove(demoId), saveCleanup(demoId, text), removeCleanup(demoId) }
 * @param {Function} opts.deinteractivize - (scriptText) => headlessScript
 * @param {object} opts.jobRunner        - { runCleanup({ demo, scriptRef, secrets }) }
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
      let ok = false;
      let executionId = null;

      // Steps 1–5: fetch, deinteractivize, save, dispatch. Any failure here is caught
      // below so finishCleanup is still reached (demo never stuck in `deleting`).
      try {
        // 1. Fetch the saved provisioning script from GCS
        const script = await scriptStore.fetch(demo.id);

        // 2. Deinteractivize: strip read -p prompts so it runs headlessly with ASSUME_YES
        const headless = deinteractivize(script);

        // 3. Upload headless cleanup script to GCS (temp object; removed in finally regardless of outcome)
        const scriptRef = await scriptStore.saveCleanup(demo.id, headless);

        // 4. Collect secrets for the Job (secretStore integration is deferred; use empty map)
        // TODO: when secretStore is wired, collect demo-scoped secrets here.
        const secrets = {};

        // 5. Dispatch the Cloud Run Job with --cleanup arg and SCRIPT_REF (GCS URI)
        ({ ok, executionId } = await jobRunner.runCleanup({ demo, scriptRef, secrets }));
      } catch (err) {
        // Pre-job failure (e.g. scriptStore.fetch threw because scriptGcsUri was never set).
        // ok stays false; fall through to finishCleanup(false) so demo is never stuck in `deleting`.
        console.error('cleanup run failed before job completion:', err?.message ?? err);
      } finally {
        // 7. Always remove the temporary cleanup script (keep storage clean regardless of outcome).
        // Guard so a removeCleanup failure does not mask the primary outcome.
        try {
          await scriptStore.removeCleanup(demo.id);
        } catch (e) {
          console.error('removeCleanup failed:', e?.message ?? e);
        }
      }

      // 6. Transition lifecycle: deleting → deleted (ok) | delete_failed (!ok).
      // This is ALWAYS reached, so the demo is never left stuck in `deleting`.
      // If finishCleanup itself throws (e.g. concurrent job already finished → invalid transition),
      // we let it propagate — the finally above has already run removeCleanup.
      await registry.finishCleanup(demo.id, ok, now());

      // 8. On success only: remove the original setup script from GCS (keep storage clean; ADR-0004)
      if (ok) {
        await scriptStore.remove(demo.id);
      }

      // 9. Return summary. Per-resource structured results are deferred (need Cloud Logging).
      return { demoId: demo.id, executionId, allOk: ok };
    },
  };
}
