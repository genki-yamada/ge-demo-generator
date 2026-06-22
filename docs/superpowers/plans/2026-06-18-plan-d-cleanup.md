# Plan D: Cleanup 機能（GCS 保存・--cleanup 再実行・UI 削除）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans。各ステップは `- [ ]`。
> **コミット規約:** 末尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。push はフォーク `origin` のみ。`gcloud` は `--project ge-work-osaka` 明示・config 不変。

**Goal:** 共有デモプロジェクトの Demo 累積問題に対し、**生成スクリプトを GCS に保存**し、CE が **UI から選択した Demo を、保存済みスクリプトの `--cleanup` をヘッドレス再実行して削除**できるようにする。ライフサイクルは `building/active/build_failed/deleting/deleted(tombstone)/delete_failed`（ADR-0004, 状態機械は Plan A）。

**Architecture:** ADR-0004 準拠。構築時に **`generateSetupScript` の出力をそのまま GCS バケットに保存**（drift 回避：作成と削除で同一スクリプト）。Cleanup は GCS からスクリプトを取得し、Plan C の非対話化＋Cloud Run Job で `--cleanup` を実行（探索マップ Code.gs:3868–4107、対話確認は 3898 の1箇所のみ＝`ASSUME_YES` で自動化）。削除はリソース別に**構造化結果**を出力し、失敗は `delete_failed` で再試行可能。Demo 単位で直列化し、`building` 中は Cleanup をブロック。`deleted` は tombstone として無期限保持、GCS スクリプトは cleanup 成功時に削除。

**Tech Stack:** Node 20 (ESM)/Express/Vitest/Supertest、`@google-cloud/storage`、`@google-cloud/run`(Jobs)、既存 registry/firestore、Plan C の job-runner/deinteractivize 再利用。

**Scope（含む/含まない）:**
- 含む: GCS 保存（構築開始時）、`scriptGcsUri` 設定、Cleanup ジョブ（`--cleanup` 再実行）、ライフサイクル遷移、リソース別構造化結果、`POST /api/demos/:id/cleanup`、UI のリスト＋名前タイプ確認削除、直列化/building ブロック、tombstone と GCS 後始末。
- 含まない: 構築本体（Plan C）、codegen（Plan B）。前提として Plan A（registry/状態機械）と Plan C（job-runner/deinteractivize/build フロー）が完了していること。

## File Structure
```
generator/src/
├── provision/
│   ├── script-store.js        # GCS へ生成スクリプト保存/取得/削除（@google-cloud/storage）
│   └── cleanup-runner.js      # 保存スクリプト取得→非対話 --cleanup を Job 実行→構造化結果
├── registry/
│   └── registry.js            # (既存) cleanup 用の遷移補助（startCleanup 等）を追加
└── routes/
    └── demos.js               # + POST /api/demos/:id/cleanup, GET /api/demos/:id（cleanup 結果含む）
generator/web/                 # Demo 一覧 + 選択 + 名前タイプ確認 + 削除トリガ
generator/test/...             # 各対応
infra/terraform/               # cleanup 用 GCS バケット + runner SA 権限追記
```

---

## Task 1: GCS スクリプトストア

構築開始時に生成スクリプトを GCS へ保存し、`Demo.scriptGcsUri`（Plan A の `demo.js:scriptGcsUri`）に URI を記録。

**Files:** `generator/src/provision/script-store.js` + test、`infra/terraform`（バケット）

- [ ] **Step 1: script-store.js**（Storage client 注入可）:
```js
export function makeScriptStore({ bucket, storage }) {
  const objectName = (demoId) => `scripts/${demoId}.sh`;
  return {
    async save(demoId, scriptText) {
      await storage.bucket(bucket).file(objectName(demoId)).save(scriptText, { contentType: 'text/x-shellscript' });
      return `gs://${bucket}/${objectName(demoId)}`;
    },
    async fetch(demoId) {
      const [buf] = await storage.bucket(bucket).file(objectName(demoId)).download();
      return buf.toString('utf8');
    },
    async remove(demoId) {
      await storage.bucket(bucket).file(objectName(demoId)).delete({ ignoreNotFound: true });
    },
  };
}
```
- [ ] **Step 2: テスト**（storage スタブで save→gs URI、fetch 往復、remove 冪等を検証）。
- [ ] **Step 3: build フローへ結線**（Plan C の `generate-demo`/`runProvision` に `scriptStore.save` を足し、`registry.setScriptUri(demoId, uri, now)` を呼ぶ。register（building）直後・構築失敗でも残す＝オーファン防止 ADR-0004）。テスト更新。
- [ ] **Step 4: Terraform**: `google_storage_bucket "generator_scripts"`（versioning 有効、uniform access、リージョン同居）＋ runner SA に `roles/storage.objectAdmin`。`terraform validate`。
- [ ] **Commit**（コード）／**Commit**（infra）。

> サイズ根拠（ADR-0004）: スクリプトは CSV/Python を heredoc 同梱で数百KB〜数MB＝Firestore 1MiB 上限超過のため GCS。

---

## Task 2: registry に Cleanup ライフサイクル補助

Plan A の状態機械（`active|build_failed → deleting → deleted|delete_failed`、`delete_failed → deleting`）を使い、Cleanup 用の高レベル操作と直列化ガードを足す。

**Files:** `generator/src/registry/registry.js`(拡張) + test

- [ ] **Step 1: 失敗テスト**:
  - `startCleanup(id, now)`：state が `active|build_failed|delete_failed` のときのみ `deleting` へ遷移、`building` のときは `/cannot cleanup while building/` で reject（直列化＝building ブロック）。
  - `finishCleanup(id, ok, now)`：ok→`deleted`（tombstone）、!ok→`delete_failed`。
  - `deleted` は終端（再 Cleanup 不可）。
- [ ] **Step 2: 実装**（既存 `transition`/`withState` を利用。`building` ガードは明示チェック）。
- [ ] **Step 3: 緑＋Commit**。

---

## Task 3: Cleanup ランナー（保存スクリプトを --cleanup 再実行）

**Files:** `generator/src/provision/cleanup-runner.js` + test

- [ ] **Step 1: 方針**: `scriptStore.fetch(demoId)` → Plan C の `deinteractivize`（確認プロンプト 3898 を `ASSUME_YES=1` で自動 Yes 化）→ `--cleanup` 引数付きで Plan C の `job-runner` により Cloud Run Job 実行。Agent Engine 名等の実行時依存（探索マップ: cleanup は `~/${dirName}/.env` から `AGENT_ENGINE_NAME` を読む, Code.gs:4025–4045）は、構築時に Secret/Firestore へ保存した値を Job 環境へ注入（Plan C の secrets 連携）。
- [ ] **Step 2: 構造化結果**: Job はリソース別に結果を出す（探索マップの削除対象: BQ/Maps key/Run/Viewer/Firestore/GE registration/GE auth/Secrets/Agent Engine/PubSub/Scheduler/task collections）。Job 側スクリプトの各削除を `echo "::result::{resource:...,status:ok|failed}"` 等の機械可読行で出力し、ランナーが集約 → `{ perResource: [...], allOk: bool }`。
- [ ] **Step 3: 失敗テスト**（job-runner/scriptStore/secrets をスタブ）: fetch→deinteractivize→job 実行→結果集約→`finishCleanup(id, allOk)` 呼び出し、を検証。`allOk` 時のみ `scriptStore.remove`（GCS 後始末, ADR-0004）。
- [ ] **Step 4: 実装＋緑＋Commit**。

> 冪等性: `--cleanup` は存在しないリソース削除を許容（探索マップは各削除を `|| true`/`--quiet` 基調）。`delete_failed` から再実行で残骸を回収できる。

---

## Task 4: Cleanup API

**Files:** `generator/src/routes/demos.js`(拡張) + test

- [ ] **Step 1: `POST /api/demos/:id/cleanup`**:
  - body=`{ confirmName }`（UI の名前タイプ確認）。`confirmName !== demo.id` なら 400。
  - `startCleanup`（building 中は 409）→ `cleanup-runner` をキック → `{ state:'deleting' }`。
  - 直列化: 同一 Demo が既に `deleting` なら 409。
- [ ] **Step 2: `GET /api/demos/:id`**: cleanup の構造化結果（最新）も返す。
- [ ] **Step 3: Supertest（依存スタブ）**: 名前不一致→400、building→409、正常→202/200＋deleting、を検証。
- [ ] **Commit**。

---

## Task 5: UI（一覧→選択→名前タイプ確認→削除）

**Files:** `generator/web/`（Demo 一覧画面）+ 結線

- [ ] **Step 1**: `GET /api/demos`（Plan A）で一覧表示（id/owner/goal/state/createdAt）。`deleting`/`deleted` はバッジ表示。
- [ ] **Step 2**: 削除ボタン→**リソース一覧提示＋「Demo 名をタイプして確認」**ダイアログ（誤削除防止）→ `POST /api/demos/:id/cleanup`。
- [ ] **Step 3**: 進捗: `GET /api/demos/:id` をポーリングし `deleting`→`deleted`/`delete_failed` を反映。`delete_failed` は再実行ボタン。
- [ ] **Step 4**: 帰属記録（誰が cleanup したか）を `req.user.email`（IAP）で Demo に記録（ADR の「認証済み任意 CE が削除可・帰属記録」）。
- [ ] **Commit**。

---

## Task 6: E2E（検証プロジェクトで実削除）— ユーザー GCP 環境

**Files:** `infra/terraform/README.md`（cleanup 手順追記）

- [ ] **Step 1**: ローカル全テスト緑（`cd generator && npx vitest run`）。
- [ ] **Step 2**（要 GCP, `--project ge-work-osaka`）: 1 Demo を構築（Plan C）→ GCS にスクリプトがある事を確認 → UI から名前タイプ確認で Cleanup → Cloud Run Job が `--cleanup` を実行 → BQ/Run/Firestore 等が消え、Demo が `deleted`、GCS スクリプトも削除されることを確認。
- [ ] **Step 3**: `delete_failed` 経路の確認（途中失敗を模擬→再実行で回収）。
- [ ] **Commit**（README 追記）。

> ネットワーク/IAP 注意: 検証は `docs/gcp-iap-cloud-run-runbook.md` 準拠（外部ユーザーはカスタム OAuth クライアント、疎通は `/health`・`/api/...`）。

---

## Self-Review
- **Spec 網羅（ADR-0004＋grilling 決定）**: GCS 保存(T1)/ライフサイクル・building ブロック(T2)/`--cleanup` 再実行・構造化結果・GCS 後始末(T3)/名前タイプ確認・直列化 API(T4)/UI・帰属記録(T5)/実削除 E2E(T6)。
- **型整合**: 状態は Plan A の `DEMO_STATES`/`transition`（deleting/deleted/delete_failed）。`scriptGcsUri` は `demo.js` の既存フィールド。`script-store`/`job-runner`/`deinteractivize`/`secrets` は Plan C と共有。Secret/suffix 命名は構築時（Plan C）と cleanup（探索マップ Code.gs:4012–4022 の suffix 部分一致）で一致。
- **Placeholder 検査**: 具体ファイル・署名・テスト方針・削除対象一覧（探索マップ準拠）。冪等性・tombstone・後始末を明示。
- **依存前提**: Plan A 完了（済・GCP 検証済）、Plan B（codegen）、Plan C（build/job/secrets/deinteractivize）完了が前提。
