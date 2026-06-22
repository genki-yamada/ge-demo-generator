import { buildApp } from './app.js';
import { DemoRegistry } from './registry/registry.js';
import { FirestoreStore } from './registry/firestore-store.js';
import { iapAuth } from './auth/iap.js';

// ─── Infrastructure ────────────────────────────────────────────────────────────

const port = process.env.PORT || 8080;
const projectId = process.env.GOOGLE_CLOUD_PROJECT;
const databaseId = process.env.FIRESTORE_DATABASE_ID || 'generator';
const iapAudience = process.env.IAP_AUDIENCE;
const devUserEmail = process.env.DEV_USER_EMAIL || null;

const store = new FirestoreStore({ projectId, databaseId });
const registry = new DemoRegistry(store);
const authMiddleware = iapAuth({ audience: iapAudience, devUserEmail });

// ─── Plan C services (injection points) ───────────────────────────────────────
//
// Each entry is a TODO placeholder for the real client / function binding.
// Wire up in follow-up tasks when real Vertex / Secret Manager / Cloud Run
// clients are available in production.
//
// Shape must match buildApp({ services }) expectations in app.js.

// TODO(plan-c-wiring): import makeVertexClient from './planning/vertex.js'
//   and bind: research = (d) => researchCompanyByDomain(d, { vertexClient })
//             optimizeGoal = (g) => optimizeGoalWithMagicWand(g, { vertexClient })
//             analyzeMcp = (u) => analyzeMcpRepository(u, { vertexClient })
const research = null;     // TODO: bind researchCompanyByDomain
const optimizeGoal = null; // TODO: bind optimizeGoalWithMagicWand
const analyzeMcp = null;   // TODO: bind analyzeMcpRepository

// TODO(plan-c-wiring): import makeSecretStore from './provision/secrets.js'
//   and provide a per-request factory (demoSuffix varies per request).
//   For now, POST /api/demos will receive secretStore from request context.
const secretStore = null;  // TODO: per-request factory via makeSecretStore

// TODO(plan-c-wiring): import makeJobRunner from './provision/job-runner.js'
//   jobRunner = makeJobRunner({ jobsClient, projectId, region, jobName })
const jobRunner = null;    // TODO: bind makeJobRunner

// TODO(plan-c-wiring): import generateDemo from './planning/generate-demo.js'
//   and bind all its sub-deps (planAndGenerateData, classifyTaxonomy, etc.)
const generateDemoFn = null; // TODO: bind generateDemo with all deps

const deinteractivizeFn = null; // TODO: import deinteractivize from './provision/deinteractivize.js'

const services = {
  generateDemo: generateDemoFn,
  deinteractivize: deinteractivizeFn,
  jobRunner,
  secretStore,
  research,
  optimizeGoal,
  analyzeMcp,
  now: () => new Date().toISOString(),
};

// ─── App ───────────────────────────────────────────────────────────────────────

const app = buildApp({ registry, authMiddleware, services });

app.listen(port, () => {
  console.log(`generator backend listening on ${port} (db=${databaseId})`);
});
