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
  # IAP JWT audience for the generator service. Cloud Run integrated IAP uses the
  # format /projects/<NUMBER>/locations/<REGION>/services/<SERVICE_NAME>. Derived from
  # the project number so it is never stale; var.iap_audience overrides when non-empty.
  # (An empty value reaching the container makes iapAuth reject every /api call with 401.)
  iap_audience = var.iap_audience != "" ? var.iap_audience : "/projects/${data.google_project.current.number}/locations/${var.region}/services/generator"

  services = [
    "run.googleapis.com",
    "firestore.googleapis.com",
    "iap.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "iam.googleapis.com",
    "storage.googleapis.com",
    "aiplatform.googleapis.com",
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
        value = local.iap_audience
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

# ── Runner SA: deploy-time permissions for the generated setup scripts ────────
# The generated GAS-ported setup scripts were authored to run as a project
# OWNER: they deploy the demo agent via `gcloud run deploy --source` (which
# triggers a Cloud Build + a run-sources GCS bucket + an Artifact Registry
# push) and self-grant IAM to the demo's runtime SA. Running them headless
# under the runner SA therefore requires the union of those owner powers.
# All five roles below were confirmed REQUIRED during the real-GCP E2E:
# without them the script exits 1 at the deploy step. These are intentionally
# broad — they reflect the owner-assuming design of the upstream scripts, not
# a least-privilege target. Narrowing them would require editing the generated
# script's deploy/IAM logic (out of scope for the provisioning harness).
resource "google_project_iam_member" "runner_cloudbuild_editor" {
  project = var.project_id
  role    = "roles/cloudbuild.builds.editor"
  member  = "serviceAccount:${google_service_account.generator_runner.email}"
}

resource "google_project_iam_member" "runner_storage_admin" {
  project = var.project_id
  role    = "roles/storage.admin"
  member  = "serviceAccount:${google_service_account.generator_runner.email}"
}

resource "google_project_iam_member" "runner_artifactregistry_admin" {
  project = var.project_id
  role    = "roles/artifactregistry.admin"
  member  = "serviceAccount:${google_service_account.generator_runner.email}"
}

# The script self-grants demo-runtime IAM roles, which requires the runner SA
# to be a project IAM admin.
resource "google_project_iam_member" "runner_project_iam_admin" {
  project = var.project_id
  role    = "roles/resourcemanager.projectIamAdmin"
  member  = "serviceAccount:${google_service_account.generator_runner.email}"
}

# `gcloud run deploy --source` deploys the demo service to run AS the default
# compute SA, so the runner SA must be able to actAs it.
data "google_project" "current" {
  project_id = var.project_id
}

resource "google_service_account_iam_member" "runner_act_as_compute" {
  service_account_id = "projects/${var.project_id}/serviceAccounts/${data.google_project.current.number}-compute@developer.gserviceaccount.com"
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.generator_runner.email}"
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

# The provisioner Job (runner SA) downloads the headless script from GCS in its
# entrypoint (gsutil cp $SCRIPT_REF). It needs read access to the scripts bucket.
# (Discovered during E2E: without this the Job exits 1 on storage.objects.list.)
resource "google_storage_bucket_iam_member" "runner_scripts_object_viewer" {
  bucket = google_storage_bucket.generator_scripts.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.generator_runner.email}"
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
      # The generated setup scripts load BigQuery tables in parallel and run
      # Python tooling; 512Mi OOMs. 4Gi/2cpu observed sufficient in E2E.
      max_retries = 0
      timeout     = "1800s"
      containers {
        image = var.provisioner_image
        resources {
          limits = {
            cpu    = "2"
            memory = "4Gi"
          }
        }
      }
    }
  }

  depends_on = [
    google_project_service.enabled,
    google_service_account.generator_runner,
  ]
}
