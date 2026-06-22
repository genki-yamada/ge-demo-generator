# GCP / Cloud Run + IAP 運用知見・トラブルシュート（検証で得た知見）

Plan A（Generator 基盤）を実プロジェクト **`ge-work-osaka`** にデプロイし、ブラウザ→IAP→アプリ→実 Firestore までエンドツーエンド疎通を確認した際に得た知見をまとめる。後任が同じ罠で時間を溶かさないための記録。

## 結論（最重要）：統合 IAP は既定で「同一組織内ユーザー限定」

`gcloud beta run services update SERVICE --iap`（統合/直接 Cloud Run IAP）は、既定で **Google 管理の OAuth クライアント**を使う。これは **OAuth クライアント層で「サービスの所属組織内のユーザーのみ」にアクセスを制限**する。

- **症状**：ログインは通るが「**You don't have access**」になる。`iap.httpsResourceAccessor` を付与しても直らない。
- **なぜ不可解か**：制限が IAM ではなく OAuth クライアント層のため、
  - IAM Policy Troubleshooter は **`access: GRANTED`**（権限はある）。
  - IAM 拒否ポリシー（deny policy）は project/folder/org いずれにも**無い**。
  - **Data Access 監査ログを有効化しても per-request の拒否理由が一切出ない**。
  → 「IAM は許可なのに IAP が拒否し、理由がどのログ/ツールにも出ない」という状態になる。
- **発生条件**：アクセスするアカウントが、Cloud Run サービスの**所属組織と別ドメイン**のとき。
  - 本件：プロジェクト `ge-work-osaka` の組織は **`gcp-osaka.sts-inc.co.jp`**、利用者は **`ge-yamada@sts-inc.co.jp`**（別ドメイン＝外部）。

### 解決：External 同意画面 ＋ カスタム OAuth クライアント

1. OAuth 同意画面（ブランド）を **External** にする。
   - `orgInternalOnly` は gcloud で変更不可。コンソール「API とサービス → OAuth 同意画面 / Google Auth Platform → Audience」で External に。
   - **External 化だけでは直らない**（Google 管理クライアントが依然 in-org 限定を強制するため）。次が必須。
2. **カスタム OAuth クライアント**を作成（コンソール → 認証情報 → OAuth クライアント ID → ウェブアプリケーション）。
   - 承認済みリダイレクト URI に `https://iap.googleapis.com/v1/oauth/clientIds/CLIENT_ID:handleRedirect` を追加。
3. IAP に適用：
   ```yaml
   # iap_settings.yaml
   access_settings:
     oauth_settings:
       client_id: <CLIENT_ID>
       client_secret: <CLIENT_SECRET>
   ```
   ```bash
   gcloud iap settings set iap_settings.yaml --project=ge-work-osaka
   ```
4. アクセスするユーザーに `roles/iap.httpsResourceAccessor` を付与（リソース or プロジェクト単位）。

> 代替：`gcp-osaka.sts-inc.co.jp` ドメインのアカウントでアクセスするなら、Google 管理クライアントのまま通る（カスタムクライアント不要）。

公式根拠：
- Configure IAP for Cloud Run — https://docs.cloud.google.com/run/docs/securing/identity-aware-proxy-cloud-run
- Enable IAP for external applications（カスタム OAuth） — https://docs.cloud.google.com/iap/docs/custom-oauth-configuration

## 罠2：`/healthz` は GFE 予約パス（常に 404）

GCP の GFE は**厳密パス `/healthz`** をヘルスチェック用に予約しており、外部アクセス時はコンテナにも IAP にも渡さず **Google の 404 ページ**を返す（`/healthz/`・`/health`・`/api/...` 等は正常）。

- **教訓**：Cloud Run の疎通テストは `/healthz` を使わない。通常パス（`/api/...`）で確認する。
- 本リポジトリの対応：アプリのヘルス用ルートを `/healthz` → **`/health`** に変更済み（`generator/src/app.js`）。

## 罠3：誤診しやすい「赤い鯡（red herring）」

「IAM 許可なのに IAP 拒否」の調査で、以下は**今回いずれも原因ではなかった**。同じ順で疑って時間を溶かさないこと：

- **社内ネットワーク/プロキシの遮断**：違う。TLS 接続先は Google IP（34.143.x）で直接到達できていた。
- **VPC Service Controls**：違う。`run.googleapis.com/HttpIngress` の違反ログは 0 件。
- **ingress=internal / default URL 無効化**：違う。`ingress=allowAll`、`urls` 登録あり。
- **Context-Aware Access（アクセスレベル）**：違う。IP 制限レベルは存在したが当該リソースに束ねられておらず（GcpUserAccessBinding 0 件）、削除しても変化なし。
- **ロール伝播待ち**：違う。Policy Troubleshooter で GRANTED 確定済み。

→ 上記を一通り否定したら **「OAuth クライアントの組織制限」** を疑うのが正解（＝結論）。

## 検証 runbook（実際に通した手順の要約）

1. `terraform apply -var project_id=ge-work-osaka`（API/Firestore 名前付きDB `generator`/AR/SA/Cloud Run）。
2. `gcloud builds submit generator --tag asia-northeast1-docker.pkg.dev/ge-work-osaka/generator/backend:v1 --project ge-work-osaka` → `terraform apply -var generator_image=...`。
3. 実 Firestore `generator` にデモ投入（ローカルから ADC で `FirestoreStore.put`）。
4. `gcloud beta run services update generator --region asia-northeast1 --project ge-work-osaka --iap`。
5. OAuth 同意画面 External 化 ＋ **カスタム OAuth クライアント**を IAP に適用（上記「解決」）。
6. `roles/iap.httpsResourceAccessor` をユーザーに付与。
7. ブラウザ（シークレット）で **`/api/demos`** にアクセス → Google ログイン → `{"demos":[...]}` を確認（実DB読み取り成功）。

## ハードニング TODO（Plan C で対応）

- **`IAP_AUDIENCE`**：現在サービスに未設定。アプリの IAP JWT 検証は audience 未指定だと「署名・発行者は検証するが audience 照合をスキップ」する挙動のため通っている。本番では適切な audience を設定して厳密化する。
- 誤った検証パス（公開化 allUsers、DEV_USER_EMAIL バイパス）に依存しないこと。
- すべての `gcloud` はプロジェクトを毎回明示（`--project ge-work-osaka`）。ローカル config は変更しない（`.claude/hooks/gcloud-guard.sh` で機械的に強制）。

## 関連

- 実プロジェクト固有事情は Claude メモリ（`ge-work-osaka-org-domain` / `gcp-cloud-run-healthz-reserved`）にも記録。
- 基盤の設計は `docs/adr/0001`、実装計画は `docs/superpowers/plans/2026-06-17-generator-foundation-cloud-run.md`。
