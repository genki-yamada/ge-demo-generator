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

## 破棄
```bash
terraform destroy -var "project_id=YOUR_PROJECT_ID"
```
