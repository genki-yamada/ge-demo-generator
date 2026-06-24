# 本番運用に向けた残作業一覧（Production Readiness）

最終更新: 2026-06-24 / 対象: `ge-work-osaka` にデプロイ済みの GE Demo Generator
（generator サービス `backend:v4` / provisioner Job `provisioner:v3`、rev generator-00009-frv）

## 現状サマリ

**動作実証済み（本番品質）**
- プロビジョニング・エンジン本体: planning → 約600KB スクリプト生成 → GCS 保存 →
  provisioner Cloud Run Job による実行（BigQuery / Firestore / Vertex Agent Engine +
  Sandbox / メインエージェントの Cloud Run デプロイ / Pub/Sub）→ cleanup teardown。
  実 GCP で build→active→cleanup→deleted のフルサイクルを exit 0 で実証。
- Agent Engine の headless 自動削除（entrypoint による `.env` persist/restore）を
  実インフラ上のプローブで検証済み。
- generator サービスは `Ready=True` / 100% トラフィック / 最新コード。env 配線正常。
- **IAP 認証フローを実機で疎通確認**（2026-06-24）: `ge-yamada@sts-inc.co.jp` で IAP ログイン →
  UI 表示 → `/api/config` が 200 + 正しい `userEmail`。§1 の #1・#2 は解決済み（下記）。

**残るブロッカーは GE インスタンス（#2 の「GE 登録」, P0）** — それ以外は P1/P2。
以下、解決済みも含め記録。

凡例: 🔴 P0（利用を妨げるブロッカー） / 🟡 P1（本番前に必須） / 🟢 P2（推奨・運用品質）
出典: [検証済]=本ドキュメント作成時に実機確認 / [既知]=メモリ/runbook 記録 / [繰越]=実装時 deferred / [推奨]=一般的本番要件

---

## 1. アクセス・認証（IAP）

- ✅ **IAP_AUDIENCE 未設定 → 解決済み（2026-06-24）** [検証済]
  - 旧状態: `IAP_AUDIENCE=''` のため `iapAuth`（`src/auth/iap.js`）が `aud` 不一致で **全 API 401**。
  - 対応済み: Cloud Run 統合 IAP の audience 形式
    `/projects/<NUMBER>/locations/<REGION>/services/<SERVICE>` を設定。terraform は
    `data.google_project.current.number` から自動導出（PR #11）。実行中サービスには
    `IAP_AUDIENCE=/projects/757234190351/locations/asia-northeast1/services/generator` を投入。
  - 検証: `/api/config` が 200 + `userEmail` 解決。
  - 注意: `--update-env-vars` を **Git Bash** で実行すると先頭 `/projects/...` が MSYS パス変換で
    破損する。**PowerShell 経由**で設定すること（メモリ `deploy-procedure-ge-work-osaka` 参照）。

- ✅ **「IAP 組織ドメイン拒否」は誤診 → 解決済み（2026-06-24）** [検証済]
  - 旧説: `ge-work-osaka` が別組織 `gcp-osaka.sts-inc.co.jp` 配下のため内部限定 IAP が
    `ge-yamada@sts-inc.co.jp`（別ドメイン）を拒否する、と考えていた。**これは誤りだった。**
  - 真因: (1) サービスで **IAP が有効化されていなかった**（`run.googleapis.com/iap-enabled` 無し →
    未認証は Cloud Run 直の素な 403「Your client does not have permission to get URL /」で、
    IAP の同意/拒否画面ですらない）、(2) **`iap.httpsResourceAccessor` 未付与**。
  - 対応済み: `gcloud beta run services update generator --iap` で有効化 +
    `gcloud projects add-iam-policy-binding ge-work-osaka --member=user:<email>
    --role=roles/iap.httpsResourceAccessor`。`domain-restricted-sharing` は `allValues: ALLOW`、
    カスタム OAuth クライアントは不要だった。
  - 検証: 別組織の `ge-yamada@sts-inc.co.jp` で IAP ログイン → UI 表示 → API 疎通。
  - 切り分けの教訓: 素な 403「Your client does not have permission」= IAP 未経由（未有効）／
    スタイル付き「You don't have access」= IAP 経由だが未認可。参照: メモリ `ge-work-osaka-org-domain`。

- 🟡 **DEV_USER_EMAIL バイパスの恒久無効化** [検証済]
  - 現状: 本番 service に `DEV_USER_EMAIL` は未設定（=バイパス無効）で良好。
  - 対応: 本番環境で絶対に設定されないことを CI/デプロイ手順で保証（誤設定は IAP を素通り）。

- 🟢 **アプリ層の認可（RBAC）** [推奨]
  - 現状: IAP 通過後は誰でも全 API 利用可（build はコストを伴う）。
  - 対応: ロール/許可リストによる build 実行権限の制御を検討。

## 2. Gemini Enterprise 連携

- 🔴 **GE インスタンス未作成・登録が手動** [検証済/既知]
  - 現状: プロジェクトに GE アプリが無く、最終の「エージェントを GE に登録」ステップは
    手動（"Manual Registration Required" で graceful 終了）。
  - 対応: 本番プロジェクトで GE インスタンスを用意し、登録手順を文書化または自動化。

## 3. Infrastructure as Code / プロジェクト

- ✅ **backend イメージに `web/`（UI）が含まれていなかった → 解決済み（PR #12）** [検証済]
  - 旧状態: Dockerfile が `COPY src ./src` のみで静的 UI（`generator/web/`）を同梱せず、IAP 通過後の
    `GET /` が Express `Cannot GET /` を返した（UI 移植より前の Dockerfile が未更新だった）。
  - 対応済み: `COPY web ./web` を追加（PR #12）→ `backend:v4` 再ビルド・デプロイで UI 表示を確認。

- 🟡 **terraform state とのドリフト** [検証済]
  - 現状: E2E 中に runner/runtime SA の IAM や (default) Firestore DB を手動で付与・作成し、
    最新デプロイも `gcloud run ... update --image` の直接更新で実施。`terraform apply` で
    state を実態に一致させていない（runner SA の deploy 権限は PR #8 でコードには反映済み）。
  - 対応: `terraform plan` でドリフトを確認し、必要に応じ `import` 後 `apply` で一元管理に戻す。

- 🟡 **本番プロジェクトの分離** [検証済]
  - 現状: `ge-work-osaka` は検証用。
  - 対応: 本番用 GCP プロジェクトを用意し terraform で再現（変数化済みのため適用可能）。

- 🟡 **(default) Firestore DB の前提** [既知]
  - 現状: 生成スクリプトは `(default)` DB を使用。E2E では手動作成した。
  - 対応: 本番プロジェクトのプロビジョニングに `(default)` DB 作成を含める（terraform/手順）。

- 🟢 **tfvars が未コミット** [検証済]
  - 対応: 環境別 `*.tfvars`（project_id, region, iap_audience, image タグ等）を管理方法を定める。

## 4. セキュリティ

- 🟡 **runner SA の広範な権限** [検証済/繰越]
  - 現状: 生成スクリプトが「オーナー前提」で自己 IAM 付与・source デプロイを行うため、runner SA に
    `storage.admin` / `resourcemanager.projectIamAdmin` / `artifactregistry.admin` /
    `cloudbuild.builds.editor` / 既定 compute SA への `serviceAccountUser` を付与（ADR/PR #8 で文書化）。
  - 対応: 本番ではこの権限集合のリスク受容を明文化、または生成スクリプトのデプロイ/IAM ロジックを
    最小権限化（スコープ外の改修）。専用プロジェクト分離で影響範囲を限定。

- 🟡 **シークレット取り扱いの未完** [繰越]
  - 現状: `cleanup-runner` は `secrets={}`、`secretStore` 連携は deferred。MCP/Slack 等の
    認証情報フローが本番未確立。
  - 対応: secretStore を本番配線し、demo スコープのシークレット投入/削除を検証。

- 🟢 **退避 env オブジェクトの最小化は実装済** [検証済]
  - `envs/<demoId>.env` には `AGENT_ENGINE_NAME` 行のみ退避（プローブで確認）。問題なし。

## 5. 信頼性・データ

- 🟡 **cleanup の同時実行 / TOCTOU** [繰越]
  - 現状: 並行 cleanup の競合は Firestore トランザクション等の原子性で未対策（`--cleanup` 冪等性 +
    終端状態ガードで実害は限定的）。
  - 対応: store の原子的状態遷移（Firestore txn）を導入。

- 🟡 **provisioner Job タイムアウト 1800s** [検証済]
  - 現状: 大規模 build が 30 分を超える可能性。
  - 対応: 実測に基づき調整、または進捗の永続化と再開設計。

- 🟢 **Firestore generator DB のバックアップ/保持** [推奨]
  - 対応: バックアップ方針・保持期間を定義。

## 6. 可観測性・運用

- 🟡 **per-resource な cleanup 結果が未取得** [繰越]
  - 現状: cleanup は job 成否（allOk）のみ。どのリソースが消えたかの構造化結果は Cloud Logging
    連携が必要で deferred。
  - 対応: Job ログ解析 or 構造化マーカーで per-resource 結果を取得・永続化。

- 🟡 **監視・アラート・ダッシュボード** [推奨]
  - 対応: build/cleanup の失敗率、Job 実行時間、コスト、エラーログのアラートを整備。

- 🟢 **ヘルスチェック/レディネス** [推奨]
  - 対応: `/health` 等のプローブとリビジョン健全性監視。

## 7. CI/CD

- 🟡 **CI 不在** [検証済]
  - 現状: `.github/workflows/` 無し。テスト（695 passed）はローカル実行のみ。イメージは
    `gcloud builds submit` を手動実行。
  - 対応: PR で vitest + `terraform validate` + codegen golden を回す CI、main マージで
    build→deploy するパイプライン（ただし共有プロジェクトへの自動デプロイ権限管理に注意）。

## 8. コスト・濫用対策

- 🟡 **build エンドポイントのレート制限/濫用対策** [推奨]
  - 現状: 1 回の build が実 GCP リソース（Vertex/Cloud Run/BQ）を作成し課金。無制限呼び出しが可能。
  - 対応: 認可（§1）+ レート制限 + クォータ + 同時実行上限。

- 🟢 **コスト可視化** [推奨]
  - 対応: demo 単位のラベル付けと予算アラート。

---

## 最短の本番化クリティカルパス

1. ✅ §1 IAP_AUDIENCE 設定（PR #11） → `/api` 疎通確認済み
2. ✅ §1 IAP アクセス（IAP 有効化 + accessor 付与） → 別組織ユーザーで疎通確認済み（「組織の壁」は誤診）
3. ✅ §3 backend イメージに UI 同梱（PR #12） → UI 表示確認済み
4. 🔴 §2 GE インスタンス用意 + 登録手順確定 ← **残る唯一の P0**
5. 🟡 §3 本番プロジェクトを terraform で構築（(default) Firestore 含む）/ state 一元化
6. 🟡 §4 シークレット配線 + §7 CI + §8 認可・レート制限

UI からの認証・API 疎通は本番で成立済み。**残るブロッカーは GE インスタンス（#4）のみ**で、これが
揃えば「ユーザーが UI からデモを生成し GE で動かす」一連が完成する。5〜6 は継続運用の品質・安全のため
本番投入前後で整備する。

> 注: 上記の検証は検証用プロジェクト `ge-work-osaka` 上での実機確認。本番では §3 の本番プロジェクト
> 分離後に同手順（IAP 有効化 + accessor 付与 + IAP_AUDIENCE）を再適用する。
