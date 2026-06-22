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
    }
  }

  depends_on = [
    google_project_service.enabled,
    google_project_iam_member.generator_firestore,
  ]
}
