# Plan: Auto ingress + 「Gemini Enterprise に登録」ボタン

## 目的（ユーザー要望）
1. **A**: GE Demo Generator から構築したデモのエージェント Cloud Run を、デプロイ時に自動で `ingress=all` にする（別組織 GE から到達可能に）。
2. **B-1**: `/demos.html` のボタンで、エージェントを Gemini Enterprise アプリへ**完全自動登録**（サーバ側で ingress 設定 + DE SA への invoker 付与 + discoveryengine への登録 POST まで実行）。

## 背景・確定事実
- エージェント Cloud Run のサービス名 = `demo.id`（`SERVICE_NAME="${dirName}"`）、リージョン = us-central1。
- 生成スクリプトは `--ingress internal`。**別組織 GE は外部扱いで 404（GFE）→ 到達不可**。`ingress=all` + IAM(DE SA invoker) で解決済み（手動実証）。
- GE 登録 = discoveryengine の `.../engines/<APP>/assistants/default_assistant/agents` に agent card(url=`<service-url>/a2a/app`) を POST（手動実証済み）。
- DE SA = `service-<GE_PROJECT_NUMBER>@gcp-sa-discoveryengine.iam.gserviceaccount.com`。
- 既定の登録先 GE: project=`sts-gemini-enterprise-dev`(番号 504753788734) / app=`osaka-work-yamada_1782323841039` / location=`global`。

## 設計方針（重要）
- **生成スクリプト（generate-setup-script.js）と golden fixtures は一切変更しない**（faithful port 維持）。ingress 開放も登録もすべて **Node バックエンド/アプリ層**で行う。
- GCP 操作は **注入された `getToken`（runtime SA の cloud-platform トークン）+ `fetchImpl`** による REST 呼び出しで実装（新ライブラリ不要・テストで完全モック可能）。
  - Cloud Run Admin API: サービス PATCH（ingress 注釈）+ `setIamPolicy`（DE SA invoker）。
  - Discovery Engine API: agents へ POST。

## グローバル制約（全レビュアーへ）
- `generate-setup-script.js` / `test/codegen/equivalence/**` を変更しない。
- すべての GCP 呼び出しは注入 `getToken`/`fetchImpl` 経由。テストは実ネットワーク禁止（モックのみ）。
- エージェントサービス = `demo.id`、リージョン = `config.agentRegion`（既定 us-central1）。
- DE SA email = `service-${config.geProjectNumber}@gcp-sa-discoveryengine.iam.gserviceaccount.com`。
- agent card は手動実証と同一構造（protocolVersion "1.0", url=`<serviceUrl>/a2a/app`, a2ui extension v0.8, JSONRPC, skills[general]）。**displayName/description は ASCII**（GE v1alpha が非 ASCII を壊すため）。
- GE 設定が未構成なら関連エンドポイントは 503（既存パターン踏襲）。
- 登録の冪等性: 既登録時の 409/重複は graceful に扱う（"already registered" を返す。エラーにしない）。

## タスク
### GE-1 — geRegistrar サービス
`src/provision/ge-registrar.js`: `makeGeRegistrar({ getToken, fetchImpl, config })` を実装。
- `setIngressAll(serviceName, region)` — Cloud Run Admin REST でサービスの ingress を `all` に（best-effort, 既に all なら no-op 可）。
- `grantInvokerToDeSa(serviceName, region)` — Cloud Run `setIamPolicy` で DE SA に `roles/run.invoker` を追加（既存バインディング保持）。
- `registerAgent({ demoId, serviceUrl })` — discoveryengine へ agent card を POST。displayName は ASCII。409/重複は graceful。
- `registerToGe({ demoId, region })` — 上記3つを順に実行し `{ agentId, agentResourceName, alreadyRegistered }` を返す。
- 全メソッド getToken+fetchImpl 経由。ユニットテスト（モックで: 正常 / setIamPolicy が既存維持 / 登録 409 graceful / トークン取得失敗）。

### GE-2 — Feature A: ビルド成功後に ingress=all
`job-runner.js` runProvision（または routes/demos.js のビルド後処理）に、**成功時のみ** `geRegistrar.setIngressAll(demo.id, agentRegion)` を best-effort で呼ぶフックを追加（失敗してもビルド結果を変えない・ログのみ）。geRegistrar はオプション注入（未設定なら skip）。テスト: 成功時に呼ばれる / 失敗時は呼ばない / setIngress 例外を握りつぶす。

### GE-3 — ルート POST /api/demos/:id/register-ge
`routes/demos.js`: active なデモのみ対象。`geRegistrar` 未設定/`config.geAppId` 未設定なら 503。404（無し）。`geRegistrar.registerToGe` を呼び 202/200 で `{ demoId, agentId, alreadyRegistered }` 返却。テスト: 503 / 404 / 409状態(active以外) / 成功。

### GE-4 — facade + UI ボタン
- `web/rpc-facade.js`: `window.registerDemoToGe(demoId)` → POST /api/demos/:id/register-ge。
- `web/demos-app.js` + `demos.html`: active なデモ行に「Gemini Enterprise に登録」ボタン。クリック→呼び出し→結果トースト（登録済み/成功/失敗）。`renderRowData` 等の純粋関数は不変。
- テスト: facade（POST/エラー）、demos-app（ボタン活性条件・呼び出し）。

### GE-5 — config 配線
- `services.js`: `geRegistrar = (getToken && config.geAppId) ? makeGeRegistrar({...}) : null` を wire し services に追加。job-runner/cleanup へ geRegistrar 注入（A 用）。
- `server.js`: env から `GE_PROJECT_NUMBER` `GE_APP_ID` `GE_LOCATION`(既定 global) `AGENT_REGION`(既定 us-central1) を読み config に格納。getToken は既存を流用。
- config 既定値はデプロイ env で設定（コードに別組織値をハードコードしない）。

### GE-6 — docs + infra 前提
- ADR: 「ingress/登録をアプリ層で行う（スクリプト無改変）」「B-1=クロス組織で backend SA に discoveryengine 権限」を記録。
- 前提（運用手順として記載、terraform 反映可能な範囲で）:
  - ge-work-osaka: runtime SA に **run.admin**（ingress 更新 + setIamPolicy のため。現状 run.developer）。
  - sts-gemini-enterprise-dev: runtime SA(`generator-runtime@ge-work-osaka.iam`) に **discoveryengine のロール**（例 roles/discoveryengine.admin）を付与（**別組織＝ユーザー/GE 管理者が実施**、terraform 対象外）。
- terraform: runtime SA の run.admin 追記 + GE 関連 env を generator サービスに追加。

## Out of scope
- 生成スクリプト自体の改変、A2A エンドポイント実装の変更、OAuth(ユーザー同意)系 MCP のための authorization リソース自動作成（別途）。
