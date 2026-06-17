# Plan C: ヘッドレス構築（planning 移植・事前収集・Job 実行）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans。各ステップは `- [ ]`。
> **コミット規約:** 末尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。push はフォーク `origin` のみ。`gcloud` は `--project ge-work-osaka` 明示・config 不変。

**Goal:** UI で課題・認証情報を事前収集し、LLM planning を Node 上で実行して `params` を作り、Plan B の `generateSetupScript` で bash を生成、**対話プロンプトを全廃**したスクリプトを **Cloud Build / Cloud Run Job でヘッドレス実行**して、Demo を1件「構築開始→active」まで自動構築する。

**Architecture:** 既存 `generator/`（Plan A 基盤）＋ Plan B の codegen を土台に：(1) GAS の planning 関数群（`researchCompanyByDomain`/`callVertexAI*`/`regenerateGoalForWorkflows`/`optimizeGoalWithMagicWand`/`generateDemo`/taxonomy/`analyzeMcpRepository`）を Node へ移植し、`UrlFetchApp`+`ScriptApp.getOAuthToken` を `google-auth-library`+`fetch`（または `@google-cloud/vertexai`）に置換（ADR-0003）。(2) 構築開始時に `DemoRegistry.register()`（state=building, ADR-0004）。(3) 認証情報は UI で収集し **Secret Manager** に格納（ADR-0002）。(4) bash の `read -p` を全廃し、選択値・認証は環境変数/Secret 経由で渡す非対話版に変換。(5) **Cloud Run Job**（または Cloud Build）が保存済みスクリプトを実行。完了で state を `active`/`build_failed` に遷移。

**Tech Stack:** Node 20 (ESM)/Express/Vitest/Supertest、`google-auth-library`、`@google-cloud/vertexai`、`@google-cloud/secret-manager`、`@google-cloud/run`（Jobs 実行）または Cloud Build API、`@google-cloud/firestore`(既存)。

**Scope（含む/含まない）:**
- 含む: planning API 移植、`POST /api/demos`（構築開始＝register）、UI 事前収集→Secret Manager、bash 非対話化変換、Cloud Run Job 定義＋ディスパッチ、構築ステータス遷移、最小 UI（課題入力→生成トリガ→進捗表示）。
- 含まない: バイト等価（Plan B）、GCS へのスクリプト保存と Cleanup（Plan D）。本計画は「Demo を1件 build できる」。

## File Structure
```
generator/src/
├── planning/                      # GAS planning 関数の移植
│   ├── vertex.js                  # callVertexAI / callVertexAIWithSearch（auth+fetch or SDK）
│   ├── research.js                # researchCompanyByDomain, regenerateGoalForWorkflows, optimizeGoalWithMagicWand
│   ├── taxonomy.js                # classifyDemoTaxonomy_ / callTaxonomyModel_
│   ├── mcp.js                     # analyzeMcpRepository（GitHub + Gemini）
│   └── generate-demo.js           # generateDemo オーケストレーション → params 構築
├── provision/
│   ├── secrets.js                 # Secret Manager 読み書き（@google-cloud/secret-manager）
│   ├── deinteractivize.js         # 生成スクリプトの read -p 除去・env 注入変換
│   └── job-runner.js              # Cloud Run Job 作成/実行ディスパッチ + 状態取得
├── routes/
│   ├── demos.js                   # (既存) + POST /api/demos（build開始）, GET /api/demos/:id/status
│   └── planning.js                # /api/research, /api/optimize-goal, /api/mcp/analyze 等
└── config.js                      # env 集約（PROJECT_ID, REGION, GENERATOR_MODELs 等）
generator/test/...（各モジュールに対応）
generator/web/                     # 既存 index.html を移植した静的フロント（google.script.run→fetch）
```

---

## Task 1: 設定モジュールと Vertex 認証クライアント

`PropertiesService`/`CONFIG`（Code.gs:64,311）を env ベースに。`UrlFetchApp`+`ScriptApp.getOAuthToken`（Code.gs:15580–16473 の各所）を ADC ベースの呼び出しへ。

**Files:** `generator/src/config.js`, `generator/src/planning/vertex.js`, tests

- [ ] **Step 1: config.js（env 集約・テスト可能に純関数化）**
```js
export function loadConfig(env = process.env) {
  return {
    projectId: env.GOOGLE_CLOUD_PROJECT,
    region: env.GENERATOR_REGION || 'asia-northeast1',
    vertexRegion: env.VERTEX_REGION || 'us-central1',
    rootModel: env.AGENT_MODEL_LITE || 'gemini-2.5-flash',
    deepModel: env.AGENT_MODEL || 'gemini-2.5-pro',
    databaseId: env.FIRESTORE_DATABASE_ID || 'generator',
  };
}
```
テスト: 既定値と上書きを検証。

- [ ] **Step 2: vertex.js（auth+fetch、token は注入可能でテスト容易に）**

`callVertexAI`(Code.gs:15715) / `callVertexAIWithSearch`(15735) を移植。`ScriptApp.getOAuthToken()`→`google-auth-library` の `GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']}).getAccessToken()`。`UrlFetchApp.fetch`→`fetch`。リトライ（Code.gs:15818 の `Utilities.sleep`→`await delay`）。署名:
```js
export function makeVertexClient({ projectId, region, getToken, fetchImpl = fetch }) {
  async function generateContent(model, requestBody) { /* POST :generateContent, Bearer token, retry */ }
  return { generateContent };
}
```
テスト: `getToken`/`fetchImpl` をスタブし、URL・body・Bearer・リトライ（429/5xx）を検証（ネットワーク不要）。

- [ ] **Step 3: 実行・通過・Commit**（TDD: 赤→実装→緑）
```bash
cd generator && npx vitest run test/config.test.js test/planning/vertex.test.js
git add src/config.js src/planning/vertex.js test/config.test.js test/planning/vertex.test.js
git commit -m "feat(planning): config module + Vertex client (ADC auth, injectable)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: planning 関数の移植（research / goal / taxonomy / mcp）

GAS の各 planning 関数を Node へ。LLM 呼び出しは Task 1 の vertex クライアント経由（注入）でテスト可能に。

**Files:** `generator/src/planning/research.js`, `taxonomy.js`, `mcp.js` + tests

- [ ] **Step 1: research.js**: `researchCompanyByDomain`(Code.gs:15501,15580 grounding), `regenerateGoalForWorkflows`(15644), `optimizeGoalWithMagicWand`(16413, retry 16491)。各々 `vertexClient` を引数に取り、プロンプト組立＋JSON 抽出ロジックを写経移植。テストは vertexClient スタブで I/O 整形を検証。
- [ ] **Step 2: taxonomy.js**: `classifyDemoTaxonomy_`(15849)/`callTaxonomyModel_`(15906、Flash Lite, 16225 GitHub は無関係)。controlled-vocab マッピングを移植。
- [ ] **Step 3: mcp.js**: `analyzeMcpRepository`(16117) — GitHub API（Code.gs:16225/16240/16257、`UrlFetchApp`→`fetch`＋任意で `octokit`）＋ Gemini（16400 `callGeminiApi`）。env var 抽出ロジックを移植。
- [ ] **Step 4: 各 TDD（赤→緑）＋ Commit**（モジュールごとに分割コミット可）。

> 各関数の期待 I/O は実 Code.gs の該当行を読み、プロンプト・パース・デフォルトを写経すること（挙動同等が目的）。

---

## Task 3: generateDemo オーケストレーション → params 構築

`generateDemo`(Code.gs:487) を移植。AI planning を呼んで `tables`/`firestore`/`systemInstruction` 等を作り、**`generateSetupScript(params)`（Plan B）** で bash を得る。`logUsageToSheet`(183) は **`DemoRegistry.register()`** に置換（ADR-0004: 構築開始時に building で登録）。

**Files:** `generator/src/planning/generate-demo.js` + test

- [ ] **Step 1: 失敗テスト**: planning 各関数と `generateSetupScript` をスタブ注入し、`generateDemo({userGoal, options}, deps)` が (a) registry.register を building で呼ぶ、(b) params を組んで generateSetupScript を呼ぶ、(c) 生成スクリプト文字列＋demoId を返す、を検証。
- [ ] **Step 2: 実装**（依存はすべて引数注入：`{research, taxonomy, mcp, generateSetupScript, registry, now, makeSuffix}`。`makeSuffix=()=>randomUUID().slice(0,8)`、`referenceDate` も注入で決定的に）。
- [ ] **Step 3: 緑＋Commit**。

---

## Task 4: Secret Manager 事前収集（UI→Secret、Job へ注入）

bash 内の `read -p`（Slack OAuth: Code.gs:3354–3560、Workspace MCP client id/secret: 3633–3735、各 MCP key: 4216）で集めていた認証情報を **UI で事前収集 → Secret Manager** に置く（ADR-0002）。

**Files:** `generator/src/provision/secrets.js` + test

- [ ] **Step 1: secrets.js**（`@google-cloud/secret-manager`、client 注入可）:
```js
export function makeSecretStore({ projectId, client }) {
  return {
    async putSecret(name, value) { /* create if absent + addVersion */ },
    async secretRef(name) { return `projects/${projectId}/secrets/${name}/versions/latest`; },
  };
}
```
- [ ] **Step 2: テスト**（client スタブで create/addVersion 呼び出しと冪等性を検証）。
- [ ] **Step 3: 命名規約**: `demo-<suffix>-<KEY>`（cleanup が suffix 部分一致で消すため、Plan D/既存 cleanup の suffix 規約と一致させる：探索マップ Code.gs:4012–4022）。
- [ ] **Commit**。

---

## Task 5: bash 非対話化変換

生成スクリプトから対話を除去し、env/Secret で代替する。対話箇所（探索マップ）: disk 確認(3852)、cleanup 確認(3898=Plan D)、プロジェクト確認/モデル選択(4109–4184)、GE 事前確認(4185–4207)、GE app 複数時選択(15245–15415 内)、各認証 `read -p`。

**Files:** `generator/src/provision/deinteractivize.js` + test

- [ ] **Step 1: 方針**: 2系統を用意——(a) **生成時に非対話で出す**よう Plan B の codegen にフラグを足す案、(b) **生成後に変換**する後処理。バイト等価（Plan B）を壊さないため **(b) 後処理変換**を採用：`read -p ... VAR` 行を `VAR="${VAR:-$ENV_VAR}"` 相当へ、確認ループは環境変数 `ASSUME_YES=1` で自動 Yes に。
- [ ] **Step 2: 失敗テスト**: 代表的な `read -p` を含む小 bash 断片を入力に、変換後に `read -p` が消え、対応する env 参照に置換されることを検証（パターンごと）。
- [ ] **Step 3: 実装**（正規表現でパターン変換。未知の `read -p` が残ったら**検出して例外**——黙って通さない＝サイレント未対応を防ぐ）。
- [ ] **Step 4: 緑＋Commit**。

> 重要: 変換は「対話除去」のみで生成物の実処理を変えない。残存 `read -p` を fail させることで、非対話化漏れを CI で検出する。

---

## Task 6: Cloud Run Job ディスパッチと状態遷移

非対話スクリプトを **Cloud Run Job**（Cloud SDK イメージ＋`gcloud`/`bq`/`uv` 入り）で実行し、結果で Demo の state を遷移。

**Files:** `generator/src/provision/job-runner.js` + test、`infra/terraform`（Job 用 image/SA 追記）

- [ ] **Step 1: job-runner.js**（`@google-cloud/run` JobsClient 注入可）: スクリプトを Secret/GCS から渡し（本計画では Secret か即時実行用に inline env）、Job を `createExecution`、実行 ID を Demo に記録。`runProvision({demo, scriptRef, secrets})`。
- [ ] **Step 2: 状態遷移**: 実行成功→`registry.transition(id,'active',now)`、失敗→`'build_failed'`（ADR-0004 の遷移、Plan A の状態機械）。Job 完了監視は Cloud Run Job の実行ステータス polling か Pub/Sub 完了通知（最小は polling）。
- [ ] **Step 3: テスト**（JobsClient スタブで createExecution 呼び出し・成功/失敗時の transition を検証）。
- [ ] **Step 4: Terraform**: Job 実行用の runner SA（roles: run.admin/bigquery.admin/datastore.user/secretmanager.secretAccessor/serviceusage.serviceUsageAdmin 等、構築に必要な権限）と、`gcloud/uv` 入りの実行イメージ（Artifact Registry）を追加。`terraform validate`。
- [ ] **Commit**（コード）／**Commit**（infra）。

> セキュリティ: 構築 Job は強い権限を持つため、Generator 本体 SA とは別の runner SA に最小権限で分離する。`--project ge-work-osaka` 明示。

---

## Task 7: HTTP API（build 開始・状態）と最小 UI

**Files:** `generator/src/routes/demos.js`(拡張), `routes/planning.js`, `generator/web/`（静的）+ tests

- [ ] **Step 1: `POST /api/demos`**: body=`{userGoal, options}`→`generateDemo`→register(building)→（Secret 格納）→`runProvision` をキック→`{demoId, state:'building'}` を返す（Supertest、依存スタブ）。
- [ ] **Step 2: `GET /api/demos/:id/status`**: state＋直近実行情報を返す。
- [ ] **Step 3: planning ルート**: `/api/research`,`/api/optimize-goal`,`/api/mcp/analyze` を planning 関数に接続（旧 `google.script.run` 呼び出し index.html:2693/2874/6466 等の置換先）。
- [ ] **Step 4: 最小 UI**: 既存 `index.html` を `generator/web/` に移植し、`google.script.run...withSuccessHandler` を `fetch('/api/...').then()` に置換（探索マップの 9 RPC を対応表に従い差し替え）。IAP 前提なので `userEmail` は `/api/config` か IAP ヘッダ由来。
- [ ] **Step 5: 全テスト＋ Commit**。

---

## Self-Review
- **Spec 網羅**: planning 移植(T1–T3)、事前収集→Secret(T4)、非対話化(T5)、Job 実行＋状態遷移(T6)、API/UI(T7)＝「Demo を1件 build できる」。
- **API 置換面**: 探索マップの GAS API 一覧（PropertiesService/UrlFetchApp×11/ScriptApp.getOAuthToken×7/SpreadsheetApp→registry/HtmlService→静的/Session→IAP/Utilities→Node 標準）を各タスクで消化。
- **型整合**: `generateDemo`→`generateSetupScript(params)`（Plan B の `params` 形）→`generateSetupScript(params):string`。state 遷移は Plan A の `DEMO_STATES`/`transition`。Secret 命名 suffix は cleanup 規約（Plan D）と一致。
- **Placeholder 検査**: 各タスクに具体ファイル・署名・テスト方針・置換表。LLM 関数本体は「実 Code.gs を写経移植」と明示（挙動同等が判定基準）。残存 `read -p` を fail させる方針でサイレント漏れを排除。
- **IAP/GCP 知見反映**: 本番アクセスは外部ユーザーならカスタム OAuth クライアント必須（`docs/gcp-iap-cloud-run-runbook.md`）。ヘルスは `/health`。
