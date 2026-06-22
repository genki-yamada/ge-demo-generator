# Plan B: セットアップスクリプト生成の Node 移植（byte-diff 等価）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development または superpowers:executing-plans でタスク単位に実装。各ステップは `- [ ]`。
> **コミット規約:** 末尾に `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。push はフォーク `origin` のみ。`gcloud` は `--project ge-work-osaka` 明示・config 不変。

**Goal:** GAS の `generateSetupScript`（`Code.gs:1856–15488`, 13,633 行）を Node.js のモジュールへ**ほぼ verbatim 移植**し、同一 `params` から **GAS 版とバイト単位で同一の bash スクリプト**を生成できることを golden ファイルで機械検証する。

**Architecture:** `generateSetupScript` は副作用のない純粋な文字列組み立て（テンプレートリテラル＋連結。内部で GAS API を呼ばない——AGENTS.md §2 のエスケープ規則は JS のものなので Node にそのまま乗る）。よって本体はコピー移植し、混入する僅かな GAS 依存（`Utilities.getUuid`/`Utilities.formatDate` 等があれば）だけ Node 標準に置換する。**安全網はバイト diff 等価テスト**：GAS 版で代表 `params` に対し生成したスクリプトを golden として保存し、Node 版の出力が golden と完全一致することを assert する。これがビッグバン切替（ADR）の機械的ゲートになる。

**Tech Stack:** Node.js 20 (ESM) / Vitest / 既存 `generator/`。外部依存追加なし（純文字列処理）。

**Scope（含む/含まない）:**
- 含む: `generateSetupScript` 本体＋直接ヘルパー（`bashEscape` 等, `Code.gs:1892`）の移植、`params` 型の定義、golden 等価テスト基盤、GAS からの golden 抽出手順。
- 含まない: `params` を作る LLM planning（`researchCompanyByDomain`/`callVertexAI`/`generateDemo` 等＝Plan C）、スクリプトの実行（Plan C）、GCS 保存・Cleanup（Plan D）。本計画の成果物は「`params` を入れると正しい bash 文字列が出る純関数＋等価保証」。

## File Structure
```
generator/src/codegen/
├── generate-setup-script.js      # ported generateSetupScript(params) -> string（本体）
├── bash-escape.js                # bashEscape 他、Code.gs:1892 周辺のヘルパー
└── params.js                     # SetupScriptParams の JSDoc 型 + バリデーション（任意）
generator/test/codegen/
├── bash-escape.test.js
├── generate-setup-script.smoke.test.js   # 構造スモーク（heredoc 対応, 必須セクション存在）
└── equivalence/
    ├── equivalence.test.js               # golden とバイト一致を assert
    └── fixtures/
        ├── <case>.params.json            # 入力 params（GAS から採取）
        └── <case>.golden.sh              # GAS 版の出力（バイト基準）
docs/codegen-golden-capture.md            # GAS から golden を採取する手順
```

---

## Task 1: golden 採取手順の整備（GAS 版の基準出力を確定）

移植の「正解」を固定する。GAS 版 `generateSetupScript` を**変更せず**、代表 `params` での出力を採取して fixtures に保存する。

**Files:** Create `docs/codegen-golden-capture.md`, `generator/test/codegen/equivalence/fixtures/*`

- [ ] **Step 1: 採取スクリプトの手順を書く（`docs/codegen-golden-capture.md`）**

GAS エディタに一時関数を追加して採取する手順を記載（本体は変更しない）：
```js
// GAS エディタで一時的に実行（コミットしない）
function __captureGolden() {
  const cases = {
    minimal: { datasetId:'demo_min', systemInstruction:'最小デモ', referenceDate:'2026-06-01',
      publicDatasetId:null, suffix:'abcd1234', tables:[], firestore:null,
      userGoal:'最小ケース', dirName:'demo-min', agentShortName:'min', oneSentenceSummary:'最小',
      enableWorkspaceMcp:false, metadata:{} },
    // retail: 1テーブル+Firestore, mcp: importedMcpList あり 等を増やす
  };
  Object.keys(cases).forEach(name => {
    const out = generateSetupScript(cases[name]);
    Logger.log('=====PARAMS['+name+']=====' + JSON.stringify(cases[name]));
    Logger.log('=====GOLDEN['+name+']=====' + out);  // 全文をコピーして <name>.golden.sh に保存
  });
}
```
注意点を明記：採取は**改行・末尾空白を一切加工せず**保存する（バイト一致が目的）。`params` は `<name>.params.json` に、出力は `<name>.golden.sh` に保存。

- [ ] **Step 2: 最低3ケースの fixtures を保存**

`minimal`（テーブル0）, `retail`（BQテーブル数件＋Firestore あり）, `mcp`（`importedMcpList` ＋ `enableWorkspaceMcp:true`）の3 `params.json` と対応 `golden.sh` を `fixtures/` に置く。各 golden の先頭が `#!/bin/bash`、末尾まで完全な内容であること。

- [ ] **Step 3: Commit**
```bash
git add docs/codegen-golden-capture.md generator/test/codegen/equivalence/fixtures
git commit -m "test(codegen): capture GAS generateSetupScript golden fixtures" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> 注: GAS への一時関数追加は採取目的のみ。元リポジトリには触れない（フォーク運用）。GAS 側コードはコミットしない。

---

## Task 2: ヘルパー `bashEscape` 等の移植（TDD）

**Files:** Create `generator/src/codegen/bash-escape.js`, `generator/test/codegen/bash-escape.test.js`

`Code.gs:1892` 周辺の `bashEscape` と、`generateSetupScript` 冒頭（`Code.gs:1938–1943`）のエスケープ列（systemInstruction 用の `\\\\\\\\`/`'\\''`/`{{`/`}}`/`\\n` 連鎖）を関数化して移植する。

- [ ] **Step 1: 失敗するテストを書く（GAS の挙動を写経）**

`bash-escape.test.js`（GAS の実挙動を期待値に固定）:
```js
import { describe, it, expect } from 'vitest';
import { bashEscape, escapeForSystemInstruction } from '../../src/codegen/bash-escape.js';

describe('bashEscape (POSIX single-quote)', () => {
  it("wraps and escapes single quotes", () => {
    expect(bashEscape("it's")).toBe("'it'\\''s'");
  });
  it('plain string', () => {
    expect(bashEscape('hello')).toBe("'hello'");
  });
});

describe('escapeForSystemInstruction', () => {
  it('escapes backslash, quote, braces, newline as GAS does', () => {
    const out = escapeForSystemInstruction("a\\b'c{d}e\nf");
    // GAS: \ -> \\\\ , ' -> '\'' , { -> {{ , } -> }} , \n -> \n(literal)
    expect(out).toBe("a\\\\b'\\''c{{d}}e\\nf");
  });
});
```
> 期待値は Code.gs:1892 と 1938–1943 の実装と厳密一致させること。実コードを読み、`replace` の順序・回数を1文字違わず写経する。

- [ ] **Step 2: 実行して失敗を確認** `cd generator && npx vitest run test/codegen/bash-escape.test.js` → FAIL。

- [ ] **Step 3: 実装（Code.gs から写経移植）**

`bash-escape.js`:
```js
// Code.gs:1892 の bashEscape を移植
export function bashEscape(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

// Code.gs:1938-1943 の systemInstruction エスケープ列を移植
export function escapeForSystemInstruction(s) {
  return String(s)
    .replace(/\\/g, '\\\\\\\\')
    .replace(/'/g, "'\\''")
    .replace(/\{/g, '{{')
    .replace(/\}/g, '}}')
    .replace(/\n/g, '\\n');
}
```
> 実 Code.gs の該当行と1文字単位で突き合わせて確定すること（テストが赤なら写経が違う）。

- [ ] **Step 4: 通過確認** `npx vitest run test/codegen/bash-escape.test.js` → PASS。
- [ ] **Step 5: Commit**
```bash
cd generator && git add src/codegen/bash-escape.js test/codegen/bash-escape.test.js
git commit -m "feat(codegen): port bash escaping helpers from GAS" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `generateSetupScript` 本体の移植（verbatim ＋ GAS依存の置換）

`Code.gs:1856–15488` をコピーし、ESM 化、ヘルパー import 化、混入する GAS API を Node 標準へ置換する。**ロジック・文字列・改行は一切変えない**（バイト一致が目的）。

**Files:** Create `generator/src/codegen/generate-setup-script.js`

- [ ] **Step 1: 本体をコピーし ESM 化**

`Code.gs:1856` の `function generateSetupScript(params){ ... }`（〜15488 の `return fullScript`）を `generate-setup-script.js` に貼り、`export function generateSetupScript(params) { ... }` にする。`bashEscape`/`escapeForSystemInstruction` は `import { bashEscape, escapeForSystemInstruction } from './bash-escape.js'` に置換。

- [ ] **Step 2: GAS 依存の機械的置換（本体内に混入する分のみ）**

本体内に現れる GAS API があれば下表で置換（探索結果では本体はほぼ純文字列。該当が無ければこのステップは no-op として記録）：
| GAS | Node 置換 |
|---|---|
| `Utilities.getUuid()` | `crypto.randomUUID()`（`import { randomUUID } from 'node:crypto'`） |
| `Utilities.formatDate(d, tz, fmt)` | `Intl.DateTimeFormat('en-CA',{timeZone:tz,...}).format(d)` 相当（出力書式を golden と一致させる） |
| `Utilities.base64Encode(x)` | `Buffer.from(x).toString('base64')` |

> ここで生成「内容」を変えてはならない。置換は GAS ランタイム呼び出しを Node 同等へ移すだけ。`referenceDate`/`suffix` は呼び出し側（Plan C）から `params` で渡る設計なので、本体での日付/UUID 生成は基本無いはず。混入があれば golden と一致するよう厳密合わせる。

- [ ] **Step 3: 構文ロード確認** `cd generator && node -e "import('./src/codegen/generate-setup-script.js').then(m=>console.log(typeof m.generateSetupScript))"` → `function`。

- [ ] **Step 4: Commit**
```bash
cd generator && git add src/codegen/generate-setup-script.js
git commit -m "feat(codegen): port generateSetupScript body to Node (verbatim)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: バイト diff 等価テスト（移植の機械的ゲート）

**Files:** Create `generator/test/codegen/equivalence/equivalence.test.js`

- [ ] **Step 1: 等価テストを書く**
```js
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateSetupScript } from '../../../src/codegen/generate-setup-script.js';

const here = dirname(fileURLToPath(import.meta.url));
const fx = join(here, 'fixtures');
const cases = readdirSync(fx).filter(f => f.endsWith('.params.json')).map(f => f.replace('.params.json',''));

describe('generateSetupScript byte-equivalence vs GAS golden', () => {
  it('has at least 3 fixtures', () => { expect(cases.length).toBeGreaterThanOrEqual(3); });
  for (const name of cases) {
    it(`case ${name} matches golden byte-for-byte`, () => {
      const params = JSON.parse(readFileSync(join(fx, `${name}.params.json`), 'utf8'));
      const golden = readFileSync(join(fx, `${name}.golden.sh`), 'utf8');
      const out = generateSetupScript(params);
      expect(out).toBe(golden);   // 完全一致（差分は vitest が表示）
    });
  }
});
```

- [ ] **Step 2: 実行して差分を潰す**

`cd generator && npx vitest run test/codegen/equivalence/equivalence.test.js`
- 失敗時、vitest の差分は「Node 出力 vs golden」。差分箇所＝写経ミス or 改行/エスケープ差。**golden を変えず Node 側を golden に合わせる**まで修正を反復（CRLF/LF 差は `.gitattributes` で fixtures を `*.sh -lf` 管理し LF 固定。改行コードも一致対象）。
- Expected 最終: 全ケース PASS（バイト一致）。

- [ ] **Step 3: 構造スモークテストも追加（golden に依存しない最低保証）**

`generate-setup-script.smoke.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { generateSetupScript } from '../../src/codegen/generate-setup-script.js';
const base = { datasetId:'demo_x', systemInstruction:'x', referenceDate:'2026-06-01', publicDatasetId:null,
  suffix:'abcd1234', tables:[], firestore:null, userGoal:'g', dirName:'demo-x', agentShortName:'x',
  oneSentenceSummary:'x', enableWorkspaceMcp:false, metadata:{} };
describe('generateSetupScript smoke', () => {
  it('starts with shebang and defines cleanup mode and usage', () => {
    const s = generateSetupScript(base);
    expect(s.startsWith('#!/bin/bash')).toBe(true);
    expect(s).toContain('--cleanup');
    expect(s).toContain('CLEANUP_MODE');
  });
});
```

- [ ] **Step 4: 全テスト＋ Commit**
```bash
cd generator && npx vitest run
git add test/codegen .gitattributes
git commit -m "test(codegen): byte-equivalence + smoke tests for generateSetupScript" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review
- **Spec 網羅**: 本体移植（T3）＋ヘルパー（T2）＋等価ゲート（T1,T4）。`params` を入れると GAS と同一の bash が出る純関数＝達成。
- **Placeholder 検査**: golden 採取の一時 GAS 関数は明示の手順、置換表は具体的、テストは完全コード。13,633 行の本体は「verbatim コピー＋等価テスト」で担保（行を計画に転記しないのは妥当な現実解。正しさは byte-diff が機械保証）。
- **型整合**: `params` のフィールド（datasetId/systemInstruction/referenceDate/publicDatasetId/suffix/tables/firestore/userGoal/dirName/agentShortName/oneSentenceSummary/enableWorkspaceMcp/metadata/importedMcpList）は探索マップ（Code.gs:1856–1869）と一致。`generateSetupScript(params)->string` は Plan C/D から呼ばれる。
