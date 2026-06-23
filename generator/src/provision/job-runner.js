/**
 * provision/job-runner.js — injectable Cloud Run Job dispatcher for headless provisioning.
 *
 * Dispatches a Cloud Run Job execution to run the deinteractivized provisioning script,
 * then transitions the Demo state via Plan A's registry.transition (ADR-0004):
 *   building → active   (on success)
 *   building → build_failed  (on failure)
 *
 * Design: jobsClient is injected for full testability (no real network or package import
 * in tests). Production wiring (real @google-cloud/run JobsClient) is done by the caller.
 * Follows the same injection pattern as secrets.js and vertex.js.
 *
 * JobsClient API shape assumed:
 *   jobsClient.runJob({ name, overrides: { containerOverrides: [{ env: [{name, value}] }] } })
 *   → Promise<[operation]>
 *   operation.promise() → Promise<[execution]>
 *   execution.name — fully-qualified execution resource name (used as executionId)
 *
 * This matches the @google-cloud/run v2 client library's standard LRO (long-running
 * operation) pattern. The operation resolves on job completion (success or infra-level
 * failure). Application-level failure (failedCount > 0) is also checked after resolution.
 *
 * @param {object} opts
 * @param {object} opts.jobsClient   - @google-cloud/run JobsClient-compatible (injected)
 * @param {string} opts.projectId    - GCP project ID
 * @param {string} opts.region       - Cloud Run region (e.g. 'asia-northeast1')
 * @param {string} opts.jobName      - Cloud Run Job name (e.g. 'provisioner')
 * @returns {{ runProvision: Function, runCleanup: Function }}
 */
export function makeJobRunner({ jobsClient, projectId, region, jobName }) {
  const jobResourceName = `projects/${projectId}/locations/${region}/jobs/${jobName}`;

  return {
    /**
     * Dispatch a Cloud Run Job execution for the given demo's provisioning script.
     *
     * @param {object} opts
     * @param {object} opts.demo        - Demo object (must have .id)
     * @param {string} opts.scriptRef   - Script location/identifier (e.g. GCS URI)
     * @param {object} [opts.secrets]   - Key→value map of env vars to inject (credentials, etc.)
     * @param {object} opts.registry    - DemoRegistry (must implement transition(id, state, now))
     * @param {Function} opts.now       - () => ISO date string (injected for testability)
     * @returns {Promise<{ demoId: string, executionId: string|null, state: string, ok: boolean }>}
     */
    async runProvision({ demo, scriptRef, secrets = {}, registry, now }) {
      // Build env overrides: secrets first, then SCRIPT_REF and ASSUME_YES on top
      const secretEnvs = Object.entries(secrets).map(([name, value]) => ({ name, value }));
      const env = [
        ...secretEnvs,
        { name: 'SCRIPT_REF', value: scriptRef },
        { name: 'ASSUME_YES', value: '1' },
      ];

      let executionId = null;
      let ok = false;

      try {
        // 1. Create the Cloud Run Job execution (LRO)
        const [operation] = await jobsClient.runJob({
          name: jobResourceName,
          overrides: {
            containerOverrides: [{ env }],
          },
        });

        // 2. Wait for the operation to complete (blocks until success or error)
        const [execution] = await operation.promise();

        // 3. Record execution ID from the returned execution resource
        executionId = execution.name ?? null;

        // 4. Check application-level failure (failedCount > 0 means task failures)
        const failed = typeof execution.failedCount === 'number' && execution.failedCount > 0;
        ok = !failed;
      } catch (_err) {
        // Operation-level failure (infra error, timeout, etc.)
        ok = false;
      }

      // 5. Transition state: building → active (success) or building → build_failed (failure)
      const nextState = ok ? 'active' : 'build_failed';
      const updatedDemo = await registry.transition(demo.id, nextState, now());

      return {
        demoId: demo.id,
        executionId,
        state: updatedDemo.state,
        ok,
      };
    },

    /**
     * Dispatch a Cloud Run Job execution to run the --cleanup pass of a provisioning script.
     *
     * Script delivery: the headless script text is base64-encoded and passed as the
     * SCRIPT_CONTENT env var. The Job entrypoint is expected to decode it (e.g.
     * `echo "$SCRIPT_CONTENT" | base64 -d > /tmp/script.sh && bash /tmp/script.sh --cleanup`).
     * This avoids a second GCS round-trip and keeps the job self-contained. Env-var size
     * (Cloud Run limit: 32 KiB per var) is sufficient for typical generated scripts; a
     * production hardening path (temp GCS ref) can be wired in a follow-up if needed.
     *
     * State transition: NOT performed here. The caller (cleanup-runner.js) calls
     * registry.finishCleanup after this resolves, decoupling job dispatch from lifecycle.
     *
     * Per-resource structured results are deferred (require Cloud Logging integration)
     * and will be added in a follow-up task. This method returns allOk only.
     *
     * @param {object} opts
     * @param {object} opts.demo       - Demo object (must have .id)
     * @param {string} opts.script     - Headless (deinteractivized) script text
     * @param {object} [opts.secrets]  - Key→value map of env vars to inject
     * @param {Function} opts.now      - () => ISO date string (injected for testability)
     * @returns {Promise<{ demoId: string, executionId: string|null, ok: boolean }>}
     */
    async runCleanup({ demo, script, secrets = {}, now }) {
      // Build env overrides: secrets first, then script delivery + cleanup flags
      const secretEnvs = Object.entries(secrets).map(([name, value]) => ({ name, value }));
      const scriptBase64 = Buffer.from(script, 'utf8').toString('base64');
      const env = [
        ...secretEnvs,
        { name: 'SCRIPT_CONTENT', value: scriptBase64 },
        { name: 'ASSUME_YES', value: '1' },
        { name: 'CLEANUP_MODE', value: '1' },
      ];

      let executionId = null;
      let ok = false;

      try {
        // 1. Create the Cloud Run Job execution with --cleanup arg (LRO)
        const [operation] = await jobsClient.runJob({
          name: jobResourceName,
          overrides: {
            containerOverrides: [{ args: ['--cleanup'], env }],
          },
        });

        // 2. Wait for the operation to complete
        const [execution] = await operation.promise();

        // 3. Record execution ID from the returned execution resource
        executionId = execution.name ?? null;

        // 4. Check application-level failure (failedCount > 0 means task failures)
        const failed = typeof execution.failedCount === 'number' && execution.failedCount > 0;
        ok = !failed;
      } catch (_err) {
        // Operation-level failure (infra error, timeout, etc.)
        ok = false;
      }

      // NOTE: No registry.transition here — cleanup-runner calls registry.finishCleanup.
      return {
        demoId: demo.id,
        executionId,
        ok,
      };
    },
  };
}
