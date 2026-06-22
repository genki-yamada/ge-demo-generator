# codegen golden capture — reproduction guide

This document explains how to reproduce the `generateSetupScript` golden fixtures
stored in `generator/test/codegen/equivalence/fixtures/`.

## Background

`generateSetupScript` (originally `Code.gs` lines 1856–15489) is a pure-JS
string-builder that assembles a ~600 KB bash setup script from a structured
`params` object.  It calls **zero GAS APIs**, so it can be executed directly in
Node — output is byte-identical to what GAS would produce.  The golden fixtures
are the "GAS truth" reference used by Plan B's byte-equivalence tests (Task 3+).

### Why Node capture instead of the GAS editor

The function is pure JS; it does not call `SpreadsheetApp`, `DriveApp`, or any
other GAS service.  Running it in Node is therefore faithful and deterministic —
no GAS runtime, no manual copy-paste, no round-trip through the Apps Script
editor.

## Prerequisites

- Node 20+ (tested with Node 24)
- The verbatim function source (`Code.gs` lines 1856–15489 as a single file)

## Step 1 — Extract the function from Code.gs

```bash
sed -n '1856,15489p' Code.gs > /tmp/generateSetupScript.verbatim.js
```

Verify the file starts with `function generateSetupScript(params) {` and ends
with `}`.

## Step 2 — Write the capture harness

Create a throwaway ESM script (do **not** commit it to the repo — use `/tmp` or
a scratchpad directory).  The harness must:

1. Load the verbatim source via `readFileSync`.
2. Define the two GAS globals the function references:
   - `CONFIG = { APP_VERSION: '2.0.0' }` (or the current version string)
   - A stub `callVertexAI` that throws — the function wraps the call in
     `try/catch` and falls back to `userGoal`, so the stub is never reached
     during normal execution.
3. **Mock `Date` to return a fixed ISO timestamp** so the two
   `new Date().toISOString()` calls in the function body (lines 1886 and 2259 of
   the verbatim file) produce deterministic output:

   ```js
   const FIXED_DATE_ISO = '2025-01-01T00:00:00.000Z';
   class FixedDate extends Date {
     constructor(...args) {
       if (args.length === 0) super(FIXED_DATE_ISO);
       else super(...args);
     }
     static now() { return new Date(FIXED_DATE_ISO).getTime(); }
   }
   ```

4. Inject the globals by wrapping the verbatim source in an IIFE via `eval`:

   ```js
   const factory = eval(`(function(CONFIG, Date, callVertexAI) { ${src}\n return generateSetupScript; })`);
   const generateSetupScript = factory(CONFIG, FixedDate, callVertexAI);
   ```

5. For each case, deep-clone `params` before calling (the function mutates
   `params.importedMcpList` in-place during deduplication).
6. Write `<case>.params.json` (UTF-8, LF, pretty-printed) and
   `<case>.golden.sh` (UTF-8, LF, raw output — do not add or strip any
   whitespace).

## Step 3 — Run the harness

```bash
node capture.mjs
```

Expected output:

```
✅ minimal: params.json + golden.sh written (…)
✅ retail: params.json + golden.sh written (…)
✅ mcp: params.json + golden.sh written (…)
✅ .gitattributes written
```

Each golden starts with `#!/bin/bash` and ends with `exit 0`.

## Step 4 — Verify determinism

Run the harness a second time and compare SHA-256 hashes:

```bash
node capture.mjs
sha256sum generator/test/codegen/equivalence/fixtures/*.golden.sh
```

The hashes must be identical to the first run.  If they differ, the harness has
a non-deterministic element (e.g. unfixed `Date`).

## Fixture cases

| Case | BQ tables | Firestore | importedMcpList | enableWorkspaceMcp |
|------|-----------|-----------|-----------------|-------------------|
| `minimal` | 0 | null | — | false |
| `retail` | 2 (orders, products) | yes (dashboardTitle set) | — | false |
| `mcp` | 1 (tasks) | null | 1 sidecar (github) | true |

Fixed params across all cases:
- `referenceDate`: `'2025-01-01'`
- `suffix`: case-specific short suffix
- `Date` mock: `'2025-01-01T00:00:00.000Z'`

## Golden storage rules

- **No EOL normalization**: `generator/test/codegen/equivalence/fixtures/.gitattributes`
  contains `*.golden.sh -text` to prevent git from touching line endings.
- **No content mutation**: golden files are saved byte-for-byte as returned by
  the function (after normalizing any `\r\n` → `\n` that Node on Windows might
  produce).

## What is NOT in scope here

The function body is not modified (no ESM conversion, no helper extraction).
That is Task 3 (Plan B port).  These golden files are the acceptance criteria
for that port — the ported implementation must produce byte-identical output for
the same inputs.
