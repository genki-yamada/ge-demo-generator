# アプリ層でのGE登録とingressオープンを行う

## 背景

生成されたデモエージェントは `--ingress internal` でデプロイされる（ADR-0002 の「bash スクリプト温存・忠実ポート」方針により、
`generate-setup-script.js` および golden テストは一切変更しない）。
この設定は demo プロジェクト内部からの呼び出しには問題ないが、**別プロジェクト・別 org の Gemini Enterprise（以下 GE）
からは Cloud Run のエッジ（GFE）が 404 を返す**ため、GE の Discovery Engine がエージェントの `/a2a/app` エンドポイントを
呼び出せない。

GE への登録は Discovery Engine API（`POST .../engines/{id}/servingConfigs/{id}:answer` ではなく
dataStore/engine の agent-card 登録エンドポイント）を呼ぶことで行うが、そのエンドポイントが指す URL
（エージェントの Cloud Run 公開 URL + `/a2a/app`）が **network reachable** かつ **invokable** であることが前提となる。
現状の `internal` ingress では両条件を満たせない。

## 検討した選択肢

### 案A: 生成スクリプトを修正して ingress=all でデプロイする

`generate-setup-script.js` の `gcloud run deploy` 行を `--ingress all` に書き換える。

**却下理由。**
ADR-0002 および ADR-0005 で確立した「生成スクリプトはバイト等価性（golden テスト）を維持する」方針を破る。
スクリプトの変更はテストの崩壊・移植同一性の喪失につながる。

### 案B（採用）: アプリ/バックエンド層でビルド後に ingress 変更と GE 登録を行う

**生成スクリプト本体は一切変更せず**、Generator バックエンド（`src/provision/ge-registrar.js`）がビルド成功後に
ランタイム SA のトークンを使って次の3ステップを実行する。

1. Cloud Run Admin API で対象エージェントサービスの `ingress = all` を設定する。
2. Cloud Run サービスの `setIamPolicy` で、GE プロジェクトの Discovery Engine SA
   （`service-<GE_PROJECT_NUMBER>@gcp-sa-discoveryengine.iam.gserviceaccount.com`）に
   `roles/run.invoker` を付与する（認証は維持、`allUsers` には付与しない）。
3. Discovery Engine API でエージェントカードを GE アプリ（`GE_APP_ID`）に POST 登録する。

#### 案 B の実装方式選択: B-1（フルサーバーサイド自動化）

バックエンド SA 自身がクロスオーグの Discovery Engine 登録も直接実行する。
UI の `/demos.html` ボタンから `POST /api/demos/:id/register-ge` を呼ぶとバックエンドがすべてを処理し、
ユーザーは追加の CLI 操作を不要とする。

## 決定

**案 B（B-1）を採用する。**

GE 登録と ingress オープンをアプリ層（`src/provision/ge-registrar.js`）で実装し、
生成スクリプト・golden テストには一切手を加えない。

## 実装の詳細

- **ingress 変更**: Cloud Run Admin API v2 `PATCH services/{service}` で `ingress = INGRESS_TRAFFIC_ALL` を設定。
- **IAM 付与**: Cloud Run v1 `services/{service}:setIamPolicy` で GE DE SA に `roles/run.invoker` を付与。
  `run.developer` ロールは `setIamPolicy` を含まないため、ランタイム SA には `roles/run.admin` が必要（後述）。
- **GE 登録**: Discovery Engine API v1alpha でエージェントカードを `POST` 登録。
  `displayName` / `description` に非 ASCII を含む場合 v1alpha が文字化けするため、登録時は ASCII ラベルに変換する。
- **設定**: 環境変数 `GE_PROJECT_NUMBER`（GE プロジェクト番号）、`GE_APP_ID`（GE アプリ ID）、
  `GE_LOCATION`（デフォルト `global`）、`AGENT_REGION`（デフォルト `us-central1`）から取得する。

## 結果と影響

### 良い面

- **生成スクリプト本体に手を加えない**: ADR-0002 の golden テスト・移植同一性が維持される（ADR-0005 と同じ方針）。
- **ユーザー操作ゼロ**: ビルド完了後に `/demos.html` のボタン1つで登録が完結する。
- **認証維持**: ingress=all でネットワーク到達可能にしつつ、実際の呼び出しは IAM（run.invoker = GE DE SA のみ）と
  エージェント自身のトークン検証ミドルウェアで保護される。

### 前提条件・必須手順

1. **ランタイム SA に `roles/run.admin` が必要（このリポジトリの Terraform で管理）**  
   `run.developer` は `services.setIamPolicy` を含まない。ingress 変更（`services.update`）と
   IAM 付与（`services.setIamPolicy`）を両立するには `roles/run.admin` が必要。
   `infra/terraform/main.tf` の `runtime_run_admin` リソースで付与する。
   既存の `runtime_run_developer` バインディングは `run.admin` がスーパーセットであるため冗長になるが、
   後方互換のため残す（または将来のクリーンアップタスクで削除する）。

2. **GE プロジェクトへのクロスオーグ手動 IAM 付与（このリポジトリの Terraform 対象外）**  
   ランタイム SA（`generator-runtime@<project>.iam.gserviceaccount.com`）に、
   GE プロジェクト（`sts-gemini-enterprise-dev`）の Discovery Engine ロール
   （例: `roles/discoveryengine.admin`）を付与する必要がある。  
   このプロジェクトは**別 org・別プロジェクトであるため、本リポジトリの Terraform では管理しない**。
   GE プロジェクトの管理者が一度だけ実施する手動手順として文書化する。

### セキュリティ上の注意

- `ingress=all` に設定することで、生成されたすべてのデモエージェントがネットワーク到達可能になる。
  ただし呼び出しは IAM ゲート（GE DE SA のみ `run.invoker`）とエージェント自身のトークン検証で守られており、
  完全公開（`allUsers`）ではない。
- GE DE SA → デモエージェントのクロスオーグ信頼パスが生まれる。デモを撤去する際は
  `run.invoker` バインディングも合わせて削除・レビューすること。

## 関連

- ADR-0002: bash スクリプト温存・Job 実行の基本方針（生成スクリプト不変の根拠）
- ADR-0005: Agent Engine 名 GCS 永続化（同じ「スクリプト不変・entrypoint 層で吸収」アプローチ）
