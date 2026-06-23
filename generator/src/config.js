/**
 * config.js — env aggregation pure function.
 * Defaults are faithful to Code.gs CONFIG (lines 65-73):
 *   LOCATION default = 'global'
 *   MODEL default    = 'gemini-3.5-flash'
 *   MAX_RETRIES      = 3
 *   RETRY_DELAY_MS   = 1000
 * searchModel ('gemini-3.1-flash-lite') is hardcoded in callVertexAIWithSearch (Code.gs:15727).
 */
export function loadConfig(env = process.env) {
  return {
    projectId: env.GOOGLE_CLOUD_PROJECT,
    region: env.GENERATOR_REGION || 'asia-northeast1',        // Cloud Run region
    vertexLocation: env.VERTEX_LOCATION || 'global',          // Code.gs CONFIG.LOCATION default
    model: env.AGENT_MODEL || 'gemini-3.5-flash',             // Code.gs CONFIG.MODEL default
    searchModel: env.AGENT_SEARCH_MODEL || 'gemini-3.1-flash-lite', // callVertexAIWithSearch hardcode
    maxRetries: Number(env.AGENT_MAX_RETRIES || 3),           // Code.gs CONFIG.MAX_RETRIES
    retryDelayMs: Number(env.AGENT_RETRY_DELAY_MS || 1000),   // Code.gs CONFIG.RETRY_DELAY_MS
    databaseId: env.FIRESTORE_DATABASE_ID || 'generator',
    githubToken: env.GITHUB_TOKEN || null,
    scriptsBucket: env.GENERATOR_SCRIPTS_BUCKET || '',
  };
}
