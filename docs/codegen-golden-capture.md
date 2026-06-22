# codegen golden capture — reproduction guide

This document explains how to reproduce the `generateSetupScript` golden fixtures
stored in `generator/test/codegen/equivalence/fixtures/`.

## Background

`generateSetupScript` (originally `Code.gs` lines 1856–15489) assembles a ~600 KB
bash setup script from a structured `params` object.  It calls **zero GAS
platform APIs** (`SpreadsheetApp`, `DriveApp`, `UrlFetchApp`, etc.), so it can be
executed directly in Node — output is byte-identical to what GAS would produce.
The golden fixtures are the "GAS truth" reference used by Plan B's
byte-equivalence tests (Task 3+).

It is **not 100% pure**, however.  It has three non-`params` dependencies that
must be controlled to make capture deterministic — and that the Task 3 port must
reproduce identically (see **Port contract** below):

1. `CONFIG.APP_VERSION` — a module-level GAS global (`Code.gs:72`), value
   **`'v10.100-public'`**.  Embedded into the script header twice.
2. `new Date().toISOString()` — called twice (verbatim lines 1886, 2259) to stamp
   a generation time into the output.  Non-deterministic unless the clock is
   pinned.
3. `callVertexAI(systemDescPrompt)` — one LLM call (verbatim line ~185, i.e.
   `Code.gs:2040`) reached **only on the Firestore path** (e.g. the `retail`
   case).  Wrapped in `try/catch`; on failure it falls back to `userGoal`.

### Why Node capture instead of the GAS editor

The function does not call any GAS platform service, so running it in Node is
faithful and deterministic — no GAS runtime, no manual copy-paste, no round-trip
through the Apps Script editor.

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
2. Define the two non-`params` globals the function references:
   - `CONFIG = { APP_VERSION: 'v10.100-public' }` — the real value from
     `Code.gs:72`. Must match exactly or the header lines differ.
   - A stub `callVertexAI` that throws — on the Firestore path the function calls
     it inside `try/catch` and falls back to `userGoal`. Throwing pins the
     deterministic fallback path (no network, no LLM).
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

## Port contract (Task 3)

These golden files are the acceptance criteria for the Task 3 port — it must
produce byte-identical output for the same inputs. To match, the port must
reproduce the three non-`params` dependencies above **deterministically and
injectably** (so the equivalence test can pin them):

- **`CONFIG.APP_VERSION`** → define as `'v10.100-public'` (constant or config).
- **Generation timestamp** → replace the two `new Date().toISOString()` calls
  with an injectable clock; the equivalence test injects
  `'2025-01-01T00:00:00.000Z'` to match these fixtures. (Production wires the
  real clock.)
- **`callVertexAI`** → accept as an injected dependency; the equivalence test
  injects a stub that throws so the deterministic `userGoal` fallback is taken.
  (Production — Plan C — injects the real Vertex client.)

The `bashEscape` helper (verbatim `Code.gs:1892`,
`(str) => str ? str.replace(/'/g, "'\\''") : ''` — **no** surrounding quotes)
and the `escapeForSystemInstruction` chain (`Code.gs:1938–1943`) are extracted
into a separate module in Task 2; their behavior must match the inline originals
exactly, which the byte-equivalence test verifies.

## What is NOT in scope here

The function body is not modified in this task (no ESM conversion, no helper
extraction). That is Task 3 (Plan B port).
