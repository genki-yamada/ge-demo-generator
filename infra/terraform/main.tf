terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.40, < 7"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  services = [
    "run.googleapis.com",
    "firestore.googleapis.com",
    "iap.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "iam.googleapis.com",
    "storage.googleapis.com",
  ]
}

resource "google_project_service" "enabled" {
  for_each           = toset(local.services)
  service            = each.value
  disable_on_destroy = false
}

resource "google_firestore_database" "generator" {
  name        = var.generator_database_id
  location_id = var.firestore_location
  type        = "FIRESTORE_NATIVE"
  depends_on  = [google_project_service.enabled]
}

resource "google_artifact_registry_repository" "generator" {
  repository_id = "generator"
  location      = var.region
  format        = "DOCKER"
  depends_on    = [google_project_service.enabled]
}

resource "google_service_account" "generator_runtime" {
  account_id   = "generator-runtime"
  display_name = "GE Demo Generator Cloud Run runtime"
  depends_on   = [google_project_service.enabled]
}

resource "google_project_iam_member" "generator_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.generator_runtime.email}"
}

resource "google_cloud_run_v2_service" "generator" {
  name                = "generator"
  location            = var.region
  deletion_protection = false

  template {
    service_account = google_service_account.generator_runtime.email
    containers {
      image = var.generator_image
      ports {
        container_port = 8080
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "FIRESTORE_DATABASE_ID"
        value = var.generator_database_id
      }
      env {
        name  = "GENERATOR_SCRIPTS_BUCKET"
        value = "${var.project_id}-generator-scripts"
      }
      env {
        name  = "GENERATOR_JOB_NAME"
        value = "provisioner"
      }
      env {
        name  = "GENERATOR_REGION"
        value = var.region
      }
      env {
        name  = "VERTEX_LOCATION"
        value = "global"
      }
      env {
        name  = "AGENT_MODEL"
        value = "gemini-3.5-flash"
      }
      env {
        name  = "AGENT_SEARCH_MODEL"
        value = "gemini-3.1-flash-lite"
      }
      env {
        name  = "IAP_AUDIENCE"
        value = var.iap_audience
      }
    }
  }

  depends_on = [
    google_project_service.enabled,
    google_project_iam_member.generator_firestore,
  ]
}

# ── Provisioner runner service account (separate from generator_runtime) ──────
# Carries the elevated build-time permissions the provisioner Job needs.
# Must NOT be mixed with the runtime SA to preserve least-privilege separation.

resource "google_service_account" "generator_runner" {
  account_id   = "generator-runner"
  display_name = "GE Demo Generator provisioner Job runner"
  depends_on   = [google_project_service.enabled]
}

resource "google_project_iam_member" "runner_run_admin" {
  project = var.project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:${google_service_account.generator_runner.email}"
}

resource "google_project_iam_member" "runner_bq_admin" {
  project = var.project_id
  role    = "roles/bigquery.admin"
  member  = "serviceAccount:${google_service_account.generator_runner.email}"
}

resource "google_project_iam_member" "runner_datastore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.generator_runner.email}"
}

resource "google_project_iam_member" "runner_secretmanager_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.generator_runner.email}"
}

resource "google_project_iam_member" "runner_serviceusage_admin" {
  project = var.project_id
  role    = "roles/serviceusage.serviceUsageAdmin"
  member  = "serviceAccount:${google_service_account.generator_runner.email}"
}

resource "google_project_iam_member" "runner_aiplatform_user" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.generator_runner.email}"
}

# ── GCS bucket for generated setup scripts ────────────────────────────────────
resource "google_storage_bucket" "generator_scripts" {
  name                        = "${var.project_id}-generator-scripts"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = false

  versioning {
    enabled = true
  }

  depends_on = [google_project_service.enabled]
}

resource "google_storage_bucket_iam_member" "runtime_scripts_object_admin" {
  bucket = google_storage_bucket.generator_scripts.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.generator_runtime.email}"
}

# ── Runtime SA: additional project-level IAM roles ────────────────────────────
# The generator app (runtime SA) needs these to orchestrate provisioning jobs.

resource "google_project_iam_member" "runtime_aiplatform_user" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.generator_runtime.email}"
}

resource "google_project_iam_member" "runtime_bq_data_viewer" {
  project = var.project_id
  role    = "roles/bigquery.dataViewer"
  member  = "serviceAccount:${google_service_account.generator_runtime.email}"
}

resource "google_project_iam_member" "runtime_bq_job_user" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.generator_runtime.email}"
}

resource "google_project_iam_member" "runtime_secretmanager_admin" {
  project = var.project_id
  role    = "roles/secretmanager.admin"
  member  = "serviceAccount:${google_service_account.generator_runtime.email}"
}

resource "google_project_iam_member" "runtime_run_developer" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${google_service_account.generator_runtime.email}"
}

# Runtime SA must be able to impersonate the runner SA when dispatching the Job
# (actAs / serviceAccountUser on the runner SA resource).
resource "google_service_account_iam_member" "runtime_act_as_runner" {
  service_account_id = google_service_account.generator_runner.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.generator_runtime.email}"
}

# ── Cloud Run Job: headless provisioner ───────────────────────────────────────
# Runs the deinteractivized setup script. Dispatched by job-runner.js (Plan C
# Task 6). env overrides (secrets, SCRIPT_REF, ASSUME_YES) injected at runtime.

resource "google_cloud_run_v2_job" "provisioner" {
  name                = "provisioner"
  location            = var.region
  deletion_protection = false

  template {
    template {
      service_account = google_service_account.generator_runner.email
      containers {
        image = var.provisioner_image
      }
    }
  }

  depends_on = [
    google_project_service.enabled,
    google_service_account.generator_runner,
  ]
}
