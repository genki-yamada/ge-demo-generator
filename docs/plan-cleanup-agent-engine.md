# Plan: Headless Agent Engine teardown (cleanup parity)

## Problem

The generated setup script's `--cleanup` pass deletes the Vertex **Agent Engine
(Sandbox)** by reading `AGENT_ENGINE_NAME` from `~/<dirName>/.env`
(`generate-setup-script.js` ~L2172-2191). In the **headless** flow the build
run (which writes that `.env`) and the cleanup run are **separate Cloud Run Job
containers**, so the file is gone at cleanup time and the script prints
"⚠️ Agent Engine name not found in .env, skipping." — leaving the Agent Engine
orphaned (confirmed in the real-GCP E2E: 11 orphaned engines required manual
deletion).

This is a real product gap, not just a manual-test artifact: `cleanup-runner.js`
re-fetches the saved script and runs `--cleanup` with **no** `AGENT_ENGINE_NAME`
delivery of any kind.

## Key invariant (simplifies everything)

`dirName === demo.id`. The generated script's `dirName` is `demo-<baseName>`
where `baseName == <domainName>-<suffix>`, and `makeDemoId(domain, suffix)`
(`demo.js`) returns the identical `demo-<domain>-<suffix>`. Observed E2E demo id
`demo-office-inventor-57bb36db` matched its `~/demo-office-inventor-57bb36db/.env`
path exactly. So the cleanup container can place the `.env` at `~/<demo.id>/.env`
with no reconstruction and no new persisted field.

## Approach

Persist the one line the cleanup needs across runs via the existing GCS scripts
bucket, driven by the **provisioner entrypoint** (not the generated script — it
stays byte-for-byte faithful, golden tests untouched):

- **Build run** (entrypoint, no `--cleanup`): after `run.sh` exits 0, extract the
  `AGENT_ENGINE_NAME=` line from `$HOME/$DEMO_DIR/.env` and upload **only that
  line** to `$ENV_REF` (data minimization — not the whole `.env`, which may hold
  credentials). Best-effort: a failure here must not fail the build.
- **Cleanup run** (entrypoint, `--cleanup` present): before `run.sh`, download
  `$ENV_REF` to `$HOME/$DEMO_DIR/.env` (best-effort). The unchanged cleanup
  section then greps it and deletes the Agent Engine with `force=true`.

`DEMO_DIR` (= demo id) and `ENV_REF` (= `gs://<bucket>/envs/<demoId>.env`) are
injected as Job env overrides by `job-runner.js`.

## Global constraints (binding — copy to every reviewer)

- `DEMO_DIR` MUST equal `demo.id`; the generated cleanup reads `~/<demo.id>/.env`.
- Persist **only** the `AGENT_ENGINE_NAME=` line, never the full `.env`.
- Do **NOT** edit `generate-setup-script.js`; the codegen equivalence/golden
  tests (`test/codegen/equivalence/*`) MUST stay green.
- `job-runner` env injection MUST be backward-compatible: when `envRef` is not
  supplied, no new env vars are added and existing tests are unaffected.
- Every `gsutil`/persist/restore step in the entrypoint is **best-effort**: a
  missing or unwritable persisted env MUST NOT fail the build or cleanup — it
  falls back to the script's existing "skipping" behavior.

## Tasks

### Task 1 — scriptStore env helpers
`script-store.js`: add `envRef(demoId)` → `gs://${bucket}/envs/${demoId}.env`
(pure path helper; the entrypoint does the actual gsutil upload/download) and
`removeEnv(demoId)` (delete with `ignoreNotFound: true`, mirroring
`removeCleanup`). Unit tests in the script-store spec (URI shape + delete call +
ignoreNotFound).

### Task 2 — job-runner env injection
`job-runner.js`: `runProvision` and `runCleanup` accept an optional `envRef`.
When present, append `{ name: 'DEMO_DIR', value: demo.id }` and
`{ name: 'ENV_REF', value: envRef }` to the container env (after secrets, before
/ alongside SCRIPT_REF). When absent, env is unchanged. Tests assert both vars
present when envRef given and absent when not (both methods).

### Task 3 — entrypoint persist/restore
`provisioner/entrypoint.sh`: make it mode-aware (detect `--cleanup` in args).
Build: run, capture rc, on rc==0 persist the `AGENT_ENGINE_NAME=` line to
`$ENV_REF`; `exit rc`. Cleanup: restore `$ENV_REF` → `$HOME/$DEMO_DIR/.env`
before `exec`-ing run.sh. All persist/restore best-effort. Add a bash-driven
test (`test/provision/entrypoint.test.*`) that spawns the entrypoint with stub
`gsutil`/`bash` on PATH and a temp `$HOME`, asserting: build persists the AE line;
cleanup restores it; build still exits run.sh's code; missing env is tolerated.
Skip gracefully where POSIX sh is unavailable.

### Task 4 — wire route + cleanup-runner
- `demos.js` POST `/api/demos`: compute `envRef = scriptStore.envRef(demoId)`
  (when scriptStore present) and pass to `jobRunner.runProvision`.
- `cleanup-runner.js`: compute `envRef = scriptStore.envRef(demo.id)`, pass to
  `jobRunner.runCleanup`; on success remove it (`scriptStore.removeEnv`,
  best-effort, alongside the existing setup-script removal). Update/extend tests
  for both.

### Task 5 — docs
ADR documenting the entrypoint-driven `.env` persistence (why not modify the
faithful-ported script; data minimization; best-effort semantics). Append a note
to `docs/gcp-iap-cloud-run-runbook.md` that headless Agent Engine teardown now
works and the manual-delete step is no longer required.

## Out of scope
Per-resource structured cleanup results (still needs Cloud Logging); cleanup
attribution; the GE manual-registration step.
