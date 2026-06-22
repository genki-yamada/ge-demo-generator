output "service_name" {
  value       = google_cloud_run_v2_service.generator.name
  description = "Cloud Run サービス名"
}

output "service_uri" {
  value       = google_cloud_run_v2_service.generator.uri
  description = "Cloud Run サービスの URL"
}

output "runtime_service_account" {
  value       = google_service_account.generator_runtime.email
  description = "Generator 実行 SA"
}

output "firestore_database" {
  value       = google_firestore_database.generator.name
  description = "Generator 用 Firestore 名前付き DB"
}

output "artifact_registry_repo" {
  value       = google_artifact_registry_repository.generator.name
  description = "Generator イメージ用 Artifact Registry リポジトリ"
}

output "runner_service_account" {
  value       = google_service_account.generator_runner.email
  description = "プロビジョナー Job 実行 SA（generator_runtime とは別）"
}

output "provisioner_job_name" {
  value       = google_cloud_run_v2_job.provisioner.name
  description = "ヘッドレスプロビジョナー Cloud Run Job 名"
}
