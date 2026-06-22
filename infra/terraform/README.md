# Generator インフラ（Terraform）

ADR-0001 / 0003 に基づく Generator 基盤のブートストラップ。

## 前提
- gcloud CLI 認証済み（`gcloud auth login` / `gcloud auth application-default login`）
- 対象は CE/チーム共有の「デモプロジェクト」（CONTEXT.md 参照）
- Terraform >= 1.5

## 1. 初期化と apply（placeholder イメージ）
```bash
cd infra/terraform
terraform init
terraform apply -var "project_id=YOUR_PROJECT_ID"
```
初回は `generator_image` がデフォルトの hello placeholder で Cloud Run が立つ。

## 2. 実イメージのビルドと差し替え
Artifact Registry へビルドしてから image var を差し替える（Task 8 参照）:
```bash
REGION=asia-northeast1
PROJECT=YOUR_PROJECT_ID
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/generator/backend:v1"
gcloud builds submit ../../generator --tag "$IMAGE" --project "$PROJECT"
terraform apply -var "project_id=${PROJECT}" -var "generator_image=${IMAGE}"
```

## 3. IAP 有効化と閲覧者付与（gcloud runbook）
```bash
REGION=asia-northeast1
PROJECT=YOUR_PROJECT_ID
gcloud beta run services update generator \
  --region "$REGION" --project "$PROJECT" --iap
gcloud beta iap web add-iam-policy-binding \
  --resource-type=cloud-run --service=generator --region="$REGION" \
  --project "$PROJECT" \
  --member="user:CE_EMAIL@example.com" \
  --role="roles/iap.httpsResourceAccessor"
```

> **重要（IAP_AUDIENCE）**: バックエンド（`server.js`）は IAP の JWT を検証する際に環境変数 `IAP_AUDIENCE` を使う。これが未設定だと、IAP を有効化しても `/api` への全リクエストが検証失敗で 401 になる。IAP 有効化後、対象の audience を取得して Cloud Run サービスに設定すること（その後 `terraform apply` で env を反映するか、`gcloud run services update generator --update-env-vars IAP_AUDIENCE=...` で直接設定）。
> - Cloud Run 直接 IAP の audience 形式は環境依存（例: `/projects/PROJECT_NUMBER/global/backendServices/SERVICE_ID`）。`gcloud iap` / コンソールの IAP 設定画面で確認する。
> - audience を Terraform 管理にする場合は `main.tf` の Cloud Run `containers.env` に `IAP_AUDIENCE` を追加する（Plan C で本格運用時に対応予定）。

## 破棄
```bash
terraform destroy -var "project_id=YOUR_PROJECT_ID"
```
