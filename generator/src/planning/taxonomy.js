/**
 * planning/taxonomy.js — Node port of GAS taxonomy classification.
 *
 * Faithful ports of:
 *   TAXONOMY constant            Code.gs:95-112
 *   classifyDemoTaxonomy_        Code.gs:15849-15892
 *   callTaxonomyModel_           Code.gs:15906-15977
 *
 * Each function receives a `deps` object with an injected `vertexClient`
 * (produced by makeVertexClient from planning/vertex.js) for full testability.
 * callTaxonomyModel_ calls vertexClient.generateContent with model override
 * 'gemini-3.1-flash-lite' and no grounding (search:false).
 */

// ---------------------------------------------------------------------------
// TAXONOMY controlled vocabulary (Code.gs:95-112)
// Note: mirrored in index.html — values must match exactly for Task 7 UI port.
// ---------------------------------------------------------------------------
export const TAXONOMY = {
  industry: [
    'Retail', 'Finance', 'Healthcare', 'Manufacturing', 'Public Sector',
    'Media & Entertainment', 'Technology', 'Logistics & Supply Chain',
    'Energy & Utilities', 'Telecom', 'Education', 'Travel & Hospitality',
    'Automotive', 'Legal & Professional Services', 'Other',
  ],
  persona: [
    'Sales', 'Marketing', 'Operations', 'Finance', 'Customer Service',
    'Product', 'HR', 'IT / Engineering', 'Executive', 'Supply Chain',
    'Legal & Compliance', 'R&D / Research', 'Other',
  ],
  useCase: [
    'Analytics & Insights', 'Process Automation', 'Customer Engagement',
    'Forecasting & Planning', 'Document Processing', 'Knowledge Retrieval',
    'Risk & Anomaly Detection', 'Optimization', 'Compliance & Audit', 'Other',
  ],
};

// ---------------------------------------------------------------------------
// callTaxonomyModel_ (Code.gs:15906-15977)
// ---------------------------------------------------------------------------

/**
 * One structured Gemini call that maps a demo to a set of allowed values.
 *
 * @param {string} userGoal
 * @param {string} aiSummary
 * @param {string} businessInstruction
 * @param {Object} allowed - Map of field name -> array of allowed enum values.
 *                           Only the keys present are requested and returned.
 * @param {{ vertexClient: object }} deps
 * @returns {Promise<Object>} Parsed JSON keyed by the requested fields (+ *Other when
 *                   'Other' is among the allowed values for that field).
 */
export async function callTaxonomyModel_(userGoal, aiSummary, businessInstruction, allowed, { vertexClient }) {
  const fields = Object.keys(allowed); // subset of ['industry','persona','useCase'] (Code.gs:15912)
  const allowsOther = fields.some(function (k) { return allowed[k].indexOf('Other') !== -1; }); // Code.gs:15913

  // English definitions + mapping hints to steer the model toward a real value. (Code.gs:15916-15920)
  const DEFINITIONS = {
    industry: 'The customer industry/sector the demo targets. Hints: bank/insurance/credit/accounting platform -> Finance; hospital/clinic/pharma -> Healthcare; factory/production line -> Manufacturing; government/municipal/public services -> Public Sector; shipping/warehouse/3PL -> Logistics & Supply Chain; software/SaaS/cloud -> Technology; car/vehicle/dealer/OEM -> Automotive; law firm/legal office/consulting/tax accountant/CPA -> Legal & Professional Services.',
    persona: 'The primary job function the agent is built for (its end user). Hints: store manager/floor ops/plant ops -> Operations; credit/accounting/treasury -> Finance; support/contact center/helpdesk -> Customer Service; CxO/leadership reporting -> Executive; demand/inventory/procurement -> Supply Chain; lawyer/paralegal/compliance officer/regulatory -> Legal & Compliance; scientist/researcher/lab/R&D engineer -> R&D / Research.',
    useCase: 'The core capability the agent demonstrates. Hints: dashboards/KPIs/reporting -> Analytics & Insights; automating a multi-step workflow -> Process Automation; chatbots/personalization/outreach -> Customer Engagement; demand or sales forecasting/planning -> Forecasting & Planning; OCR/parsing forms or invoices -> Document Processing; RAG/search over documents -> Knowledge Retrieval; fraud/defect/outlier detection -> Risk & Anomaly Detection; routing/scheduling/allocation -> Optimization; regulatory compliance checking/audit trail/policy enforcement -> Compliance & Audit.',
  };
  const LABELS = { industry: 'INDUSTRY', persona: 'PERSONA', useCase: 'USE CASE' }; // Code.gs:15921

  // Code.gs:15923-15925
  const criteria = fields.map(function (k) {
    return `- ${LABELS[k]}: ${DEFINITIONS[k]}\n  Allowed values (choose EXACTLY one, verbatim): ${allowed[k].join(' | ')}`;
  }).join('\n');

  // Code.gs:15927-15929
  const otherRule = allowsOther
    ? 'Use "Other" ONLY when none of the allowed values reasonably fit — this must be extremely rare. When in doubt, pick the single closest value.'
    : 'You MUST pick the single closest allowed value. "Other" is NOT permitted.';

  // Code.gs:15931-15947 (template literal prompt)
  const prompt =
`You are a precise classifier for a catalog of AI agent demos.
Classify the demo described below into the requested dimensions.

CRITICAL OUTPUT RULES:
1. The input may be written in ANY language (e.g. Japanese). Your output values MUST ALWAYS be in ENGLISH.
2. For each dimension, return one of the allowed values EXACTLY as written.
3. ${otherRule}
${allowsOther ? '4. When (and only when) you return "Other" for a dimension, also provide a short English free-form label for it in the matching *Other field (e.g. industryOther). Otherwise leave the *Other field empty.' : ''}

DIMENSIONS:
${criteria}

DEMO:
- Goal: ${userGoal || 'N/A'}
- Summary: ${aiSummary || 'N/A'}
${businessInstruction ? '- Business context: ' + String(businessInstruction).substring(0, 1500) : ''}`;

  // Build a responseSchema limited to the requested fields. (Code.gs:15950-15954)
  const props = {};
  fields.forEach(function (k) {
    props[k] = { type: 'STRING', enum: allowed[k] };
    if (allowed[k].indexOf('Other') !== -1) props[k + 'Other'] = { type: 'STRING' };
  });

  // Code.gs:15956-15963
  const generationConfig = {
    temperature: 0.1,
    responseMimeType: 'application/json',
    responseSchema: { type: 'OBJECT', properties: props, required: fields },
  };

  // Code.gs:15965-15976: call via vertexClient with model override 'gemini-3.1-flash-lite',
  // no grounding (search:false). vertexClient.generateContent returns the text string;
  // we JSON.parse it (equivalent to Code.gs:15974-15975).
  const text = await vertexClient.generateContent(prompt, {
    model: 'gemini-3.1-flash-lite',
    generationConfig,
  });
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// classifyDemoTaxonomy_ (Code.gs:15849-15892)
// ---------------------------------------------------------------------------

/**
 * Classifies a demo into the TAXONOMY controlled vocabulary using a two-pass
 * strategy: first pass uses full enums (Other allowed); if any field lands on
 * 'Other', a force-allowed second pass re-runs only those fields with Other removed.
 *
 * @param {string} userGoal
 * @param {string} aiSummary
 * @param {string} [businessInstruction] - Extra context to improve accuracy.
 * @param {{ vertexClient: object }} deps
 * @returns {Promise<{industry:string, persona:string, useCase:string,
 *                    industryOther:string, personaOther:string, useCaseOther:string}>}
 */
export async function classifyDemoTaxonomy_(userGoal, aiSummary, businessInstruction, { vertexClient }) {
  // Code.gs:15850-15853
  const fallback = {
    industry: 'Other', persona: 'Other', useCase: 'Other',
    industryOther: '', personaOther: '', useCaseOther: '',
  };

  try {
    // Pass 1: full enums (Other allowed). (Code.gs:15856-15861)
    const first = await callTaxonomyModel_(userGoal, aiSummary, businessInstruction, {
      industry: TAXONOMY.industry,
      persona: TAXONOMY.persona,
      useCase: TAXONOMY.useCase,
    }, { vertexClient });

    // Pass 2 (forced choice): re-run only the fields that landed on 'Other',
    // this time with 'Other' removed from the allowed values. (Code.gs:15863-15877)
    const forceAllowed = {};
    ['industry', 'persona', 'useCase'].forEach(function (k) {
      if (first[k] === 'Other') {
        forceAllowed[k] = TAXONOMY[k].filter(function (v) { return v !== 'Other'; });
      }
    });

    if (Object.keys(forceAllowed).length > 0) {
      const forced = await callTaxonomyModel_(userGoal, aiSummary, businessInstruction, forceAllowed, { vertexClient });
      Object.keys(forceAllowed).forEach(function (k) {
        if (forced[k] && forced[k] !== 'Other') first[k] = forced[k];
      });
    }

    // Code.gs:15879-15887
    return {
      industry: first.industry || 'Other',
      persona: first.persona || 'Other',
      useCase: first.useCase || 'Other',
      // Keep the English free-form label only when the value is still 'Other'.
      industryOther: first.industry === 'Other' ? (first.industryOther || '') : '',
      personaOther: first.persona === 'Other' ? (first.personaOther || '') : '',
      useCaseOther: first.useCase === 'Other' ? (first.useCaseOther || '') : '',
    };
  } catch (e) {
    // Code.gs:15888-15891
    console.warn('[TAXONOMY] Classification failed, defaulting to Other:', e.message);
    return fallback;
  }
}
