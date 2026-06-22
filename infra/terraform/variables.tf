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
