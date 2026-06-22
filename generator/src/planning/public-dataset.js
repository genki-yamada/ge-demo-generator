/**
 * planning/public-dataset.js — Node port of GAS public-dataset functions.
 *
 * Faithful ports of:
 *   discoverPublicDataset      Code.gs:640-684
 *   verifyAndResolveTable      Code.gs:685-722
 *
 * Each function receives a `deps` object with injected clients for full testability:
 *   - vertexClient: { generateContent(prompt, opts) } — for Google Search grounded discovery
 *   - bqClient:     { tableGet(projectId, datasetId, tableId), tablesList(projectId, datasetId, opts) }
 *
 * Production wiring (real @google-cloud/bigquery) is done by the caller; this module
 * only consumes the injected interface.
 */

// ---------------------------------------------------------------------------
// discoverPublicDataset (Code.gs:640-684)
// ---------------------------------------------------------------------------

/**
 * Discovers a public BigQuery dataset relevant to the user's goal via
 * Google Search grounded Vertex AI, then verifies it with BigQuery.
 *
 * Code.gs:640 function discoverPublicDataset(userGoal)
 *
 * @param {string} userGoal - The business goal/scenario text
 * @param {{ vertexClient: object, bqClient: object }} deps
 * @returns {Promise<string>} Fully qualified BQ table ID (project.dataset.table)
 */
export async function discoverPublicDataset(userGoal, { vertexClient, bqClient }) {
  // Code.gs:641-661: discovery prompt (verbatim)
  const discoveryPrompt = `Find a real BigQuery public dataset that would provide EXTERNAL CONTEXT or ENRICHMENT for the following business problem:

"${userGoal}"

Requirements:
1. The dataset MUST exist under the project 'bigquery-public-data'.
2. Search Google to find the exact dataset and table names.
3. PRIORITIZE "External Context" data: weather, demographics, census, economic indicators, geographic features, or market statistics.
4. AVOID "Core Business" data: Do NOT select datasets that look like internal company records (e.g., avoid order histories, customer lists, or internal transactions) unless explicitly required for external benchmarking.
5. Return ONLY the fully qualified ID in the format: bigquery-public-data.dataset_name.table_name
6. If multiple tables exist, choose the most commonly used or primary one.
7. Do NOT invent or hallucinate dataset names.

Examples of preferred "External Context" datasets:
- bigquery-public-data.noaa_gsod.gsod2023 (Weather)
- bigquery-public-data.census_bureau_acs.zip_codes_2018_5yr (Demographics)
- bigquery-public-data.geo_open_streets.lines (Geographic)
- bigquery-public-data.google_trends.top_terms (Market Trends)

Return ONLY the dataset ID, nothing else.`;

  // Code.gs:663: FALLBACK constant (verbatim)
  const FALLBACK = 'bigquery-public-data.thelook_ecommerce.orders';

  try {
    // Code.gs:664: callVertexAIWithSearch → vertexClient.generateContent with search:true
    const result = await vertexClient.generateContent(discoveryPrompt, { search: true });

    // Code.gs:665: clean the LLM output
    const cleanId = result.trim().replace(/[`'"]/g, '').split('\n')[0];

    // Code.gs:667-669: validate format
    if (!cleanId.startsWith('bigquery-public-data.') || cleanId.split('.').length < 3) {
      return FALLBACK;
    }

    // Code.gs:671-672: verify via BQ and fall back if not found
    const verifiedId = await verifyAndResolveTable(cleanId, { bqClient });
    return verifiedId || FALLBACK;
  } catch (e) {
    // Code.gs:673-675: catch all errors → FALLBACK
    return FALLBACK;
  }
}

// ---------------------------------------------------------------------------
// verifyAndResolveTable (Code.gs:685-722)
// ---------------------------------------------------------------------------

/**
 * Verifies a table exists in BigQuery. If the exact table doesn't exist,
 * attempts to find a valid table in the same dataset.
 *
 * Code.gs:685 function verifyAndResolveTable(candidateId)
 *
 * @param {string} candidateId - Fully qualified ID (project.dataset.table)
 * @param {{ bqClient: object }} deps
 * @returns {Promise<string|null>} Verified table ID or null if not found.
 */
export async function verifyAndResolveTable(candidateId, { bqClient }) {
  // Code.gs:689-691: split and guard
  const parts = candidateId.split('.');
  if (parts.length < 3) return null;

  // Code.gs:692-694: extract components
  const projectId = parts[0];
  const datasetId = parts[1];
  const tableId = parts.slice(2).join('.');

  try {
    // Code.gs:695-698: try exact table lookup → BigQuery.Tables.get
    await bqClient.tableGet(projectId, datasetId, tableId);
    return candidateId;
  } catch (e) {
    // Code.gs:699: catch → fall through to list
  }

  try {
    // Code.gs:700-701: list tables → BigQuery.Tables.list
    const tables = await bqClient.tablesList(projectId, datasetId, { maxResults: 20 });

    // Code.gs:702-713: find match by preferredPatterns or use first table
    if (tables.tables && tables.tables.length > 0) {
      // Code.gs:703: preferredPatterns (verbatim order)
      const preferredPatterns = ['trips', 'orders', 'events', 'data', 'stats', 'records'];
      let match = null;
      for (const pattern of preferredPatterns) {
        // Code.gs:706: case-insensitive includes check
        match = tables.tables.find(t => t.tableReference.tableId.toLowerCase().includes(pattern));
        if (match) break;
      }
      // Code.gs:709-710: fallback to first table if no pattern matched
      if (!match) match = tables.tables[0];

      // Code.gs:712: construct final ID
      return `${projectId}.${datasetId}.${match.tableReference.tableId}`;
    }
  } catch (listError) {
    // Code.gs:714: catch list errors silently
  }

  // Code.gs:716: return null if nothing found
  return null;
}
