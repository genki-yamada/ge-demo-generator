import { BigQuery } from '@google-cloud/bigquery';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { JobsClient } from '@google-cloud/run';
import { Storage } from '@google-cloud/storage';
import { GoogleAuth } from 'google-auth-library';

import { buildApp } from './app.js';
import { DemoRegistry } from './registry/registry.js';
import { FirestoreStore } from './registry/firestore-store.js';
import { iapAuth } from './auth/iap.js';
import { loadConfig } from './config.js';
import { makeVertexClient } from './planning/vertex.js';
import { makeBqClient } from './provision/bq-client.js';
import { buildServices } from './services.js';

// ─── Configuration ──────────────────────────────────────────────────────────────

const port = process.env.PORT || 8080;
const iapAudience = process.env.IAP_AUDIENCE;
const devUserEmail = process.env.DEV_USER_EMAIL || null;

// loadConfig covers projectId/region/vertexLocation/model/searchModel/retries/
// databaseId/githubToken. jobName + appVersion are W-B additions (not in loadConfig),
// so we merge them in here for buildServices.
const config = {
  ...loadConfig(process.env),
  jobName: process.env.GENERATOR_JOB_NAME || 'provisioner',
  appVersion: process.env.APP_VERSION || 'v10.100-public',
};

// ─── Registry / auth (unchanged) ─────────────────────────────────────────────────

const store = new FirestoreStore({ projectId: config.projectId, databaseId: config.databaseId });
const registry = new DemoRegistry(store);
const authMiddleware = iapAuth({ audience: iapAudience, devUserEmail });

// ─── Real GCP clients (W-B composition root inputs) ──────────────────────────────

// Vertex AI auth: GoogleAuth.getAccessToken() resolves to string | null | undefined.
// vertexClient expects getToken: async () => string, so adapt by throwing when absent.
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
const getToken = async () => {
  const token = await auth.getAccessToken();
  if (!token) {
    throw new Error('Failed to obtain a Google access token (getAccessToken returned empty)');
  }
  return token;
};

const vertexClient = makeVertexClient({
  projectId: config.projectId,
  location: config.vertexLocation,
  model: config.model,
  searchModel: config.searchModel,
  getToken,
  maxRetries: config.maxRetries,
  retryDelayMs: config.retryDelayMs,
});

const bqClient = makeBqClient({ bigquery: new BigQuery({ projectId: config.projectId }) });
const secretManagerClient = new SecretManagerServiceClient();
const jobsClient = new JobsClient();
const storage = new Storage();

// generateImage (Vertex image model) is DEFERRED — not wired here. planAndGenerateData
// no-ops the image-gen branch when its generateImage dep is undefined (see services.js).

const { services } = buildServices({
  vertexClient,
  bqClient,
  jobsClient,
  secretManagerClient,
  storageClient: storage,
  config,
});

// ─── App ───────────────────────────────────────────────────────────────────────

const app = buildApp({ registry, authMiddleware, services });

app.listen(port, () => {
  console.log(`generator backend listening on ${port} (db=${config.databaseId})`);
});
