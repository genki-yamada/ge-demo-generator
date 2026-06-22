import { randomUUID } from 'node:crypto';

/**
 * planning/generate-demo.js — Node port of generateDemo orchestration.
 *
 * Faithful port of Code.gs:487–639 (generateDemo).
 * Core planning pipeline (planAndGenerateData, getDataProfile_, validateGeneratedData,
 * generateBaseName) is NOT ported here — all injected as deps.
 *
 * GAS→Node replacement mapping applied:
 *   1. Date.now()                           → clock()           (source lines 2, 119)
 *   2. Utilities.getUuid().replace(...)     → makeSuffix()      (source line 46)
 *   3. generateSetupScript({...})           → generateSetupScript(params, {callVertexAI,now,appVersion}) (source lines 72–87)
 *   4. classifyDemoTaxonomy_(...)           → classifyTaxonomy(userGoal, summary, biz)  (source line 95)
 *   5. new Date().toISOString()             → now()             (source line 107)
 *   6. Session.getActiveUser().getEmail()   → userEmail         (source line 108)
 *   7. logUsageToSheet(historyEntry)        → registry.register({...}) (source line 126)
 *   8. planAndGenerateData/getDataProfile_/validateGeneratedData/generateBaseName → deps  (source lines 3, 36, 42, 47)
 */

/**
 * Orchestrates full demo generation.
 *
 * @param {string} userGoal
 * @param {Object} [options={}]
 * @param {{
 *   planAndGenerateData: Function,
 *   getDataProfile: Function,
 *   validateGeneratedData: Function,
 *   generateBaseName: Function,
 *   classifyTaxonomy: Function,
 *   generateSetupScript: Function,
 *   registry: { register: Function },
 *   callVertexAI: Function,
 *   now: Function,
 *   clock?: Function,
 *   makeSuffix?: Function,
 *   userEmail: string,
 *   appVersion?: string,
 * }} deps
 * @returns {Promise<Object>} result
 */
export async function generateDemo(userGoal, options = {}, deps) {
  // Replacement 1: Date.now() → clock()  (source line 2)
  const clock = deps.clock ?? (() => Date.now());
  // Replacement 2: Utilities.getUuid()...  → makeSuffix()  (source line 46)
  const makeSuffix = deps.makeSuffix ?? (() => randomUUID().replace(/-/g, '').slice(0, 8));

  const {
    planAndGenerateData,
    getDataProfile,
    validateGeneratedData,
    generateBaseName,
    classifyTaxonomy,
    generateSetupScript,
    registry,
    callVertexAI,
    now,
    userEmail,
    appVersion = 'v10.100-public',
  } = deps;

  const startTime = clock(); // Replacement 1 (source line 2)

  // Source lines 3–15: options merge (getDataProfile_ → injected getDataProfile)
  const profile = getDataProfile(options.dataProfile || 'standard'); // Replacement 8 (source line 3)
  const defaultOptions = {
    rowCount: profile.defaultRowCount,
    dataProfile: 'standard',
    publicDatasetId: null,
    usePublicDataset: false,
    enableWorkspaceMcp: false,
  };
  options = { ...defaultOptions, ...options };

  if (!options.usePublicDataset) {
    options.publicDatasetId = null;
  }

  // Source lines 17–31: result initialisation
  const result = {
    success: false,
    steps: [],
    error: null,
    datasetId: null,
    tableInfo: [],
    dataPreview: [],
    systemInstruction: null,
    setupScript: null,
    rawTables: [],
    suffix: null,
    domainName: null,
    referenceDate: null,
    appliedFactors: null,
  };

  try {
    // Step 1: Planning and Data Generation (source lines 35–37)
    result.steps.push({ step: 1, status: 'running', message: 'Planning & generating data...' });
    const planResult = await planAndGenerateData(userGoal, options); // Replacement 8 (source line 36)
    result.steps[0] = { step: 1, status: 'completed', message: 'Planning complete' };

    // Step 2: Validation (source lines 40–43)
    result.steps.push({ step: 2, status: 'running', message: 'Validating generated data...' });
    const maxRows = Math.min(options.rowCount || 100, 150);
    await validateGeneratedData(planResult, maxRows); // Replacement 8 (source line 42)
    result.steps[1] = { step: 2, status: 'completed', message: 'Validation complete' };

    // Step 3: Suffix generation (source lines 46–56)
    const suffix = makeSuffix(); // Replacement 2 (source line 46)
    const baseName = await generateBaseName(userGoal, suffix); // Replacement 8 (source line 47)
    const dirName = 'demo-' + baseName; // source line 48
    const datasetId = ('demo_' + baseName).replace(/-/g, '_'); // source line 49

    // Source lines 51–70: result assembly
    result.datasetId = datasetId;
    result.userGoal = userGoal;
    result.dataPreview = planResult.dataPreview;
    result.rawTables = planResult.tables;
    result.suffix = suffix;
    result.domainName = baseName.substring(0, baseName.lastIndexOf('-' + suffix)); // source line 56
    result.dirName = dirName;
    result.businessInstruction = planResult.businessInstruction;
    result.technicalInstruction = planResult.technicalInstruction;
    result.systemInstruction = planResult.systemInstruction;
    result.referenceDate = planResult.referenceDate;
    result.publicDatasetId = planResult.publicDatasetId;
    result.demoGuide = planResult.demoGuide;
    result.externalFiles = planResult.externalFiles || [];
    result.appliedFactors = planResult.appliedFactors || {};
    result.agentShortName = planResult.agentShortName || '';
    result.oneSentenceSummary = planResult.oneSentenceSummary || '';
    result.firestore = planResult.firestore || null;
    result.importedMcpList = options.importedMcpList || null;
    result.metadata = planResult.metadata || null;

    // Replacement 3: generateSetupScript(params, sysDeps)  (source lines 72–87)
    result.setupScript = generateSetupScript({
      datasetId: datasetId,
      systemInstruction: planResult.systemInstruction,
      referenceDate: planResult.referenceDate,
      publicDatasetId: planResult.publicDatasetId,
      suffix: suffix,
      dirName: dirName,
      tables: planResult.tables,
      firestore: planResult.firestore,
      userGoal: userGoal,
      agentShortName: planResult.agentShortName,
      oneSentenceSummary: planResult.oneSentenceSummary,
      importedMcpList: options.importedMcpList,
      enableWorkspaceMcp: options.enableWorkspaceMcp,
      metadata: planResult.metadata,
    }, { callVertexAI, now, appVersion }); // Replacement 3

    result.steps.push({ step: 4, status: 'completed', message: 'Generation complete' }); // source line 88

    result.success = true; // source line 90

    // Replacement 4: classifyDemoTaxonomy_ → classifyTaxonomy  (source lines 95–103)
    const taxonomy = await classifyTaxonomy(userGoal, planResult.oneSentenceSummary, planResult.businessInstruction);
    result.industry = taxonomy.industry;
    result.persona = taxonomy.persona;
    result.useCase = taxonomy.useCase;
    // Free-form English labels (only set when the value is 'Other')
    result.industryOther = taxonomy.industryOther;
    result.personaOther = taxonomy.personaOther;
    result.useCaseOther = taxonomy.useCaseOther;

    // Unified Save Object (source lines 106–123)
    // Replacements 5 (now()) and 6 (userEmail) applied here.
    const historyEntry = {
      timestamp: now(), // Replacement 5 (source line 107)
      userEmail: userEmail, // Replacement 6 (source line 108)
      userGoal: userGoal,
      aiSummary: planResult.oneSentenceSummary || result.domainName,
      datasetId: datasetId,
      mcpServers: (() => {
        const names = options.importedMcpList
          ? options.importedMcpList.map(m => m.name || (m.github_url ? m.github_url.split('/').pop().replace(/\.git$/, '') : 'Unknown MCP'))
          : [];
        if (options.enableWorkspaceMcp) names.push('Google Workspace MCP');
        return names.length > 0 ? names.join(', ') : 'None';
      })(),
      generationTimeSec: ((clock() - startTime) / 1000).toFixed(1), // Replacement 1 (source line 119)
      industry: taxonomy.industry,
      persona: taxonomy.persona,
      useCase: taxonomy.useCase,
    };

    // Replacement 7: logUsageToSheet(historyEntry) → registry.register({...})  (source lines 125–130)
    // register failure is tolerated (same as original logSheet failure).
    try {
      const demo = await registry.register({
        domain: result.domainName,         // baseName minus suffix (source line 56)
        suffix,                             // from makeSuffix() (replacement 2)
        ownerCe: userEmail,                // replacement 6
        goal: userGoal,
        classification: taxonomy.industry, // Demo model has single classification field; industry chosen (ADR-0004)
        now: now(),                        // replacement 5
      });
      result.saveStatus = { logSheet: demo }; // analogous to source line 126 shape
      result.demoId = demo.id;             // demo.id === "demo-${domain}-${suffix}" === dirName
    } catch (persistErr) {
      console.error('[PERSISTENCE-CRITICAL] Failed to trigger save logic:', persistErr.message);
      result.saveStatus = { logSheet: { success: false, error: persistErr.message } }; // source lines 128–129
    }

  } catch (error) {
    // Source lines 132–139
    result.error = error.message;
    const lastStep = result.steps[result.steps.length - 1];
    if (lastStep) {
      lastStep.status = 'error';
      lastStep.message = error.message;
    }
  }

  return result; // source line 141
}
