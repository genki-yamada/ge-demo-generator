/**
 * planning/plan-helpers.js — Node port of GAS planning helper functions.
 *
 * Faithful ports of:
 *   getDataProfile_                  Code.gs:436-486
 *   resolvePlannedPublicDatasetId_   Code.gs:723-734
 *   generateBaseName                 Code.gs:1826-1855
 *
 * Naming: trailing `_` removed for export convention.
 * LLM call in generateBaseName is injected via deps.vertexClient.generateContent(prompt).
 * verifyAndResolveTable in resolvePlannedPublicDatasetId is injected via deps.verifyAndResolveTable
 * (no BigQuery API calls in this module).
 */

// ---------------------------------------------------------------------------
// getDataProfile (Code.gs:436-486)
// ---------------------------------------------------------------------------

/**
 * Returns the data profile config for the given profileId.
 * Falls back to 'standard' for unknown ids (Code.gs:47).
 *
 * @param {string} profileId - 'deep' | 'standard' | 'wide'
 * @returns {object} profile config
 */
export function getDataProfile(profileId) {
  // Code.gs:436-486: static profiles map
  const profiles = {
    deep: {
      id: 'deep',
      label: 'Deep Analysis',
      tableCount: '3-4',
      masterRows: '15-25',
      masterCols: '5-7',
      txnRows: '120+',
      txnCols: '8-12',
      defaultRowCount: 150,
      txnRowTarget: 120,
      masterMinRows: 8,
      txnMinRows: 50,
      strategy: 'Fewer tables with MAXIMUM row density. Prioritize deep temporal coverage and statistical significance in transaction tables. Ideal for time-series analysis, anomaly detection, and trend analysis demos.',
    },
    standard: {
      id: 'standard',
      label: 'Standard',
      tableCount: '5',
      masterRows: '20-30',
      masterCols: '6-8',
      txnRows: '80+',
      txnCols: '8-12',
      defaultRowCount: 100,
      txnRowTarget: 80,
      masterMinRows: 10,
      txnMinRows: 30,
      strategy: 'Balanced star-schema with good relational depth and adequate transaction density. Suitable for most demo scenarios including cross-table joins and operational analytics.',
    },
    wide: {
      id: 'wide',
      label: 'Wide Schema',
      tableCount: '7-8',
      masterRows: '15-20',
      masterCols: '5-7',
      txnRows: '40-50',
      txnCols: '6-10',
      defaultRowCount: 50,
      txnRowTarget: 40,
      masterMinRows: 6,
      txnMinRows: 20,
      strategy: 'Many tables for complex ER diagrams and multi-hop JOIN demos. Row density is intentionally lower to fit within token limits. Best for showcasing relational modeling and schema complexity.',
    },
  };
  // Code.gs:47: fallback to standard
  return profiles[profileId] || profiles['standard'];
}

// ---------------------------------------------------------------------------
// resolvePlannedPublicDatasetId (Code.gs:723-734)
// ---------------------------------------------------------------------------

/**
 * Resolves the public dataset ID to use, based on what the planner returned
 * and the caller's options.
 *
 * @param {*} parsedId - The ID the planner returned (may be any type)
 * @param {object} options
 * @param {boolean} options.usePublicDataset
 * @param {string|null} options.publicDatasetId - Fallback ID
 * @param {object} [deps={}]
 * @param {Function} [deps.verifyAndResolveTable] - Injected verifier (no BQ calls here)
 * @returns {string|null}
 */
export function resolvePlannedPublicDatasetId(parsedId, options, deps = {}) {
  // Code.gs:56: if not using public dataset, return null immediately
  if (!options.usePublicDataset) return null;

  // Code.gs:57: normalize parsedId to string
  const plannedId = (typeof parsedId === 'string') ? parsedId.trim() : '';

  // Code.gs:58-63: if plannedId is non-empty and different from the configured one, try to verify
  if (plannedId && plannedId !== options.publicDatasetId) {
    const verifyAndResolveTable = deps.verifyAndResolveTable;
    if (verifyAndResolveTable) {
      const verified = verifyAndResolveTable(plannedId);
      if (verified) return verified;
      console.warn('[PublicDataset] Planner returned unverifiable ID "' + plannedId + '". Falling back to "' + options.publicDatasetId + '"');
    }
  }

  // Code.gs:63: return configured publicDatasetId or null
  return options.publicDatasetId || null;
}

// ---------------------------------------------------------------------------
// generateBaseName (Code.gs:1826-1855)
// ---------------------------------------------------------------------------

/**
 * Generates a short, filesystem-safe base name for a demo using an LLM.
 * Falls back to "env-{suffix}" on error.
 *
 * @param {string} userGoal - Business problem description
 * @param {string} suffix - UUID suffix to append
 * @param {{ vertexClient: { generateContent: Function } }} deps
 * @returns {Promise<string>} e.g. "retail-inventory-abc12345"
 */
export async function generateBaseName(userGoal, suffix, deps) {
  // Code.gs:1830-1841: prompt asking for a short filesystem-safe identifier
  const prompt = `Generate a short, filesystem-safe identifier (2-3 words, lowercase, hyphens only) that describes this business problem:

"${userGoal}"

Rules:
- Use ONLY lowercase letters and hyphens (no numbers, no special characters)
- Maximum 20 characters
- Must be descriptive of the business domain
- Examples: "retail-inventory", "bakery-sales", "hotel-booking", "logistics-fleet"

Return ONLY the name, nothing else.`;

  try {
    // Code.gs:1843: call LLM via injected vertexClient
    const result = await deps.vertexClient.generateContent(prompt);

    // Code.gs:1844-1851: clean and sanitize the returned name
    let cleanName = result.trim().toLowerCase()
      .replace(/[^a-z-]/g, '-')     // Replace non-alphabet/non-hyphen with hyphen (Code.gs:1845)
      .replace(/-+/g, '-')           // Collapse multiple hyphens (Code.gs:1846)
      .replace(/^-|-$/g, '')         // Remove leading/trailing hyphens (Code.gs:1847)
      .substring(0, 15)              // Limit length to 15 (Code.gs:1848)
      .replace(/-+$/g, '');          // Remove trailing hyphens after truncation (Code.gs:1849)

    // Code.gs:1852: fallback if name is too short
    if (cleanName.length < 3) cleanName = 'demo-env';

    // Code.gs:1853: return with suffix
    return `${cleanName}-${suffix}`;
  } catch (e) {
    // Code.gs:1854-1855: fallback on any error
    return `env-${suffix}`;
  }
}
