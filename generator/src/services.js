/**
 * services.js — composition root (Wiring W-B).
 *
 * Binds the planning + provisioning layer into the `services` object that
 * buildApp({ services }) consumes. All external clients (Vertex / BigQuery /
 * Cloud Run Jobs / Secret Manager) are INJECTED so this module is fully unit-
 * testable with fakes — server.js constructs the real clients and hands them in.
 *
 * Key design points:
 *   - `callVertexAI` is the GAS-shaped (prompt) => Promise<text> wrapper around
 *     vertexClient.generateContent — generateSetupScript expects this shape.
 *   - Every planning fn is bound with exactly the deps its real signature needs
 *     (verified against each module's export).
 *   - `generateDemo` is a PARTIAL: it is pre-bound with all ~8 planning sub-deps
 *     and the route completes it at call time with { userEmail, registry, now }.
 *   - `makeSecretStore(demoSuffix)` is a PER-REQUEST factory (secret names embed
 *     the suffix); the old single `secretStore` instance is retired.
 *   - generateImage (Vertex image model) is DEFERRED → left undefined, so
 *     planAndGenerateData no-ops the image-gen branch.
 */

import {
  discoverPublicDataset as discoverPublicDatasetImpl,
  verifyAndResolveTable as verifyAndResolveTableImpl,
} from './planning/public-dataset.js';
import { classifyDemoTaxonomy_ } from './planning/taxonomy.js';
import {
  getDataProfile,
  generateBaseName as generateBaseNameImpl,
} from './planning/plan-helpers.js';
import { planAndGenerateData as planAndGenerateDataImpl } from './planning/plan-and-generate.js';
import { validateGeneratedData } from './planning/validate-data.js';
import { generateSetupScript } from './codegen/generate-setup-script.js';
import {
  researchCompanyByDomain,
  optimizeGoalWithMagicWand,
  regenerateGoalForWorkflows,
} from './planning/research.js';
import { updateSystemInstruction } from './codegen/update-system-instruction.js';
import { analyzeMcpRepository } from './planning/mcp.js';
import { generateDemo as generateDemoImpl } from './planning/generate-demo.js';
import { makeSecretStore as makeSecretStoreImpl } from './provision/secrets.js';
import { makeJobRunner } from './provision/job-runner.js';
import { deinteractivize } from './provision/deinteractivize.js';
import { makeScriptStore } from './provision/script-store.js';
import { makeCleanupRunner } from './provision/cleanup-runner.js';
import { makeGeRegistrar } from './provision/ge-registrar.js';

/**
 * @param {object} clients
 * @param {{ generateContent: Function }} clients.vertexClient
 * @param {{ tableGet: Function, tablesList: Function }} clients.bqClient
 * @param {object} clients.jobsClient            - @google-cloud/run JobsClient-compatible
 * @param {object} clients.secretManagerClient   - SecretManagerServiceClient-compatible
 * @param {object} clients.config                - loadConfig(env) + { jobName, appVersion? }
 * @param {object} [clients.registry]            - Optional DemoRegistry instance (enables cleanupRunner)
 * @returns {{ services: object }}
 */
export function buildServices({ vertexClient, bqClient, jobsClient, secretManagerClient, storageClient, config, registry, getToken, fetchImpl }) {
  // GAS-shaped wrapper: (prompt) => Promise<text>. generateSetupScript calls this.
  const callVertexAI = async (prompt) => vertexClient.generateContent(prompt);

  // public-dataset.js: verifyAndResolveTable(id, { bqClient })
  const verifyAndResolveTable = (id) => verifyAndResolveTableImpl(id, { bqClient });
  // public-dataset.js: discoverPublicDataset(userGoal, { vertexClient, bqClient })
  const discoverPublicDataset = (userGoal) =>
    discoverPublicDatasetImpl(userGoal, { vertexClient, bqClient });

  // taxonomy.js: classifyDemoTaxonomy_(userGoal, aiSummary, businessInstruction, { vertexClient })
  const classifyTaxonomy = (g, s, b) => classifyDemoTaxonomy_(g, s, b, { vertexClient });

  // plan-helpers.js: generateBaseName(userGoal, suffix, { vertexClient })
  const generateBaseName = (g, sfx) => generateBaseNameImpl(g, sfx, { vertexClient });

  // plan-and-generate.js: planAndGenerateData(userGoal, options, deps)
  //   generateImage DEFERRED (undefined → no-op branch); today undefined → formatTokyoDate default.
  const planAndGenerateData = (userGoal, options) =>
    planAndGenerateDataImpl(userGoal, options, {
      vertexClient,
      discoverPublicDataset,
      verifyAndResolveTable,
      generateImage: undefined, // DEFERRED — image-gen not ported (orchestrator no-ops)
      today: undefined, // default to formatTokyoDate(new Date())
    });

  // research.js
  const research = (d) => researchCompanyByDomain(d, { vertexClient });
  const optimizeGoal = (g) => optimizeGoalWithMagicWand(g, { vertexClient });
  // mcp.js: analyzeMcpRepository(repoUrl, { vertexClient, fetchImpl?, githubToken? })
  const analyzeMcp = (u) => analyzeMcpRepository(u, { vertexClient, githubToken: config.githubToken });

  // secrets.js: per-request factory — names embed demoSuffix (cleanup-grep invariant).
  const makeSecretStore = (demoSuffix) =>
    makeSecretStoreImpl({ projectId: config.projectId, client: secretManagerClient, demoSuffix });

  // job-runner.js
  const jobRunner = makeJobRunner({
    jobsClient,
    projectId: config.projectId,
    region: config.region,
    jobName: config.jobName,
  });

  const scriptStore = storageClient
    ? makeScriptStore({ bucket: config.scriptsBucket, storage: storageClient })
    : undefined;

  const now = () => new Date().toISOString();

  // generate-demo.js: PARTIAL. Pre-bind all planning sub-deps; the route supplies
  // { userEmail, registry, now } per request and we merge them via routeDeps.
  const generateDemo = (userGoal, options, routeDeps) =>
    generateDemoImpl(userGoal, options, {
      planAndGenerateData,
      getDataProfile,
      validateGeneratedData,
      generateBaseName,
      classifyTaxonomy,
      generateSetupScript,
      callVertexAI,
      appVersion: config.appVersion ?? 'v10.100-public',
      ...routeDeps, // userEmail, registry, now
    });

  // research.js: regenerateGoalForWorkflows(companyInfo, selectedWorkflows, { vertexClient })
  const regenerateGoal = (companyInfo, workflows) =>
    regenerateGoalForWorkflows(companyInfo, workflows, { vertexClient });

  // codegen/update-system-instruction.js: pure synchronous string transform
  const updateInstruction = (s, b, t) => updateSystemInstruction(s, b, t);

  // App metadata for /api/config
  const appConfig = {
    appVersion: config.appVersion ?? 'v10.100-public',
    model: config.model,
  };

  const cleanupRunner = (registry && scriptStore)
    ? makeCleanupRunner({ scriptStore, deinteractivize, jobRunner, registry, now })
    : undefined;

  // ge-registrar.js — registers a demo's deployed agent to a Gemini Enterprise app
  // (Feature B-1) and opens the agent's Cloud Run ingress (Feature A). Requires a
  // cloud-platform token (getToken) and a configured GE target (config.geAppId).
  // Left undefined when unconfigured → register-ge endpoint 503s, ingress hook no-ops.
  const geRegistrar = (getToken && config.geAppId)
    ? makeGeRegistrar({ getToken, fetchImpl: fetchImpl ?? ((url, opts) => fetch(url, opts)), config })
    : undefined;

  const services = {
    generateDemo,
    deinteractivize,
    jobRunner,
    makeSecretStore,
    scriptStore,
    research,
    optimizeGoal,
    analyzeMcp,
    now,
    regenerateGoal,
    updateInstruction,
    appConfig,
    cleanupRunner,
    geRegistrar,
    config,
  };

  return { services };
}
