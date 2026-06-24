variable "project_id" {
  type        = string
  description = "デモプロジェクトの GCP プロジェクト ID"
}

variable "region" {
  type        = string
  description = "Generator をデプロイするリージョン"
  default     = "asia-northeast1"
}

variable "firestore_location" {
  type        = string
  description = "Firestore 名前付き DB のロケーション"
  default     = "asia-northeast1"
}

variable "generator_database_id" {
  type        = string
  description = "Generator 専用 Firestore 名前付きデータベース ID"
  default     = "generator"
}

variable "generator_image" {
  type        = string
  description = "Generator バックエンドのコンテナイメージ。初回は placeholder、以降は Task 8 のビルド成果物を指す"
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "provisioner_image" {
  type        = string
  description = "ヘッドレスプロビジョナー Job のコンテナイメージ（gcloud/bq/uv 入り実行環境）。初回は placeholder"
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "iap_audience" {
  type        = string
  description = "IAP の JWT audience の明示オーバーライド。空の場合は main.tf の local で Cloud Run 形式 /projects/<NUMBER>/locations/<REGION>/services/generator を自動導出する。注意: この値が誤り/不一致だと iapAuth が JWT 検証に失敗し /api が全て 401 になる（空＝検証スキップではない）。"
  default     = ""
}
