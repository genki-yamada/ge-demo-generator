/**
 * generate-demo.test.js — TDD tests for planning/generate-demo.js
 *
 * Ports generateDemo orchestration from Code.gs:487–639.
 * ALL deps are stubbed — no network calls.
 *
 * The 8 GAS→Node replacements tested here:
 *   1. Date.now()  → clock()
 *   2. Utilities.getUuid()  → makeSuffix()
 *   3. generateSetupScript({...}) → generateSetupScript(params, {callVertexAI,now,appVersion})
 *   4. classifyDemoTaxonomy_(...)  → classifyTaxonomy(userGoal, aiSummary, biz)
 *   5. new Date().toISOString()   → now()
 *   6. Session.getActiveUser().getEmail() → userEmail
 *   7. logUsageToSheet(historyEntry) → registry.register({domain,suffix,ownerCe,goal,classification,now})
 *   8. planAndGenerateData/getDataProfile_/validateGeneratedData/generateBaseName → injected deps
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateDemo } from '../../src/planning/generate-demo.js';

// ---------------------------------------------------------------------------
// Shared stubs
// ---------------------------------------------------------------------------

const FIXED_SUFFIX = 'abcd1234';
const FIXED_NOW = '2026-06-22T00:00:00.000Z';
const FIXED_CLOCK = 1000; // ms at start; end will be same if clock is called twice with same value

const FIXED_PLAN_RESULT = {
  dataPreview: [{ row: 1 }],
  tables: [{ name: 'orders', rows: [] }],
  businessInstruction: 'Manage retail orders',
  technicalInstruction: 'Use BigQuery',
  systemInstruction: 'You are a helpful agent',
  referenceDate: '2026-01-01',
  publicDatasetId: null,
  demoGuide: 'Guide text',
  externalFiles: [],
  appliedFactors: { currency: 'JPY' },
  agentShortName: 'OrderAgent',
  oneSentenceSummary: 'An agent for retail order management',
  firestore: { collection: 'orders' },
  metadata: { currencySymbol: '¥' },
};

const FIXED_TAXONOMY = {
  industry: 'Retail',
  persona: 'Operations',
  useCase: 'Process Automation',
  industryOther: '',
  personaOther: '',
  useCaseOther: '',
};

function makeDeps(overrides = {}) {
  // planResult used to derive baseName/domain: baseName = "retail-orders-abcd1234", domain = "retail-orders"
  const planAndGenerateData = vi.fn().mockResolvedValue(FIXED_PLAN_RESULT);
  const getDataProfile = vi.fn().mockReturnValue({ defaultRowCount: 100 });
  const validateGeneratedData = vi.fn().mockResolvedValue(undefined);
  // generateBaseName returns "<domain>-<suffix>"
  const generateBaseName = vi.fn().mockReturnValue('retail-orders-abcd1234');
  const classifyTaxonomy = vi.fn().mockResolvedValue(FIXED_TAXONOMY);
  const generateSetupScript = vi.fn().mockReturnValue('#!/bin/bash\necho hello');
  const register = vi.fn().mockImplementation(async (x) => ({
    id: `demo-${x.domain}-${x.suffix}`,
    ...x,
    state: 'building',
  }));
  const registry = { register };
  const callVertexAI = vi.fn();
  const now = vi.fn().mockReturnValue(FIXED_NOW);
  const clock = vi.fn().mockReturnValue(FIXED_CLOCK);
  const makeSuffix = vi.fn().mockReturnValue(FIXED_SUFFIX);
  const userEmail = 'ge-yamada@sts-inc.co.jp';
  const appVersion = 'v10.100-public';

  return {
    planAndGenerateData,
    getDataProfile,
    validateGeneratedData,
    generateBaseName,
    classifyTaxonomy,
    generateSetupScript,
    registry,
    callVertexAI,
    now,
    clock,
    makeSuffix,
    userEmail,
    appVersion,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// (a) registry.register called with building-state mapping (source lines 125–130)
// ---------------------------------------------------------------------------

describe('registry.register mapping (replacement 7, source lines 125–130)', () => {
  it('calls register with correct domain (baseName minus "-suffix")', async () => {
    const deps = makeDeps();
    await generateDemo('retail agent', {}, deps);
    expect(deps.registry.register).toHaveBeenCalledOnce();
    const arg = deps.registry.register.mock.calls[0][0];
    // baseName = "retail-orders-abcd1234", suffix = "abcd1234"
    // domain = baseName.substring(0, baseName.lastIndexOf('-abcd1234')) = "retail-orders"
    expect(arg.domain).toBe('retail-orders');
  });

  it('calls register with the suffix from makeSuffix (replacement 2)', async () => {
    const deps = makeDeps();
    await generateDemo('retail agent', {}, deps);
    const arg = deps.registry.register.mock.calls[0][0];
    expect(arg.suffix).toBe(FIXED_SUFFIX);
  });

  it('calls register with ownerCe = userEmail (replacement 6)', async () => {
    const deps = makeDeps();
    await generateDemo('retail agent', {}, deps);
    const arg = deps.registry.register.mock.calls[0][0];
    expect(arg.ownerCe).toBe('ge-yamada@sts-inc.co.jp');
  });

  it('calls register with goal = userGoal', async () => {
    const deps = makeDeps();
    await generateDemo('retail agent', {}, deps);
    const arg = deps.registry.register.mock.calls[0][0];
    expect(arg.goal).toBe('retail agent');
  });

  it('calls register with classification = taxonomy.industry (not persona/useCase)', async () => {
    const deps = makeDeps();
    await generateDemo('retail agent', {}, deps);
    const arg = deps.registry.register.mock.calls[0][0];
    expect(arg.classification).toBe('Retail');
  });

  it('calls register with now = now() result (replacement 5)', async () => {
    const deps = makeDeps();
    await generateDemo('retail agent', {}, deps);
    const arg = deps.registry.register.mock.calls[0][0];
    expect(arg.now).toBe(FIXED_NOW);
  });
});

// ---------------------------------------------------------------------------
// (b) generateSetupScript called with params + sysDeps (replacement 3)
// ---------------------------------------------------------------------------

describe('generateSetupScript called with params + second-arg sysDeps (replacement 3, source lines 72–87)', () => {
  it('calls generateSetupScript with second arg {callVertexAI, now, appVersion}', async () => {
    const deps = makeDeps();
    await generateDemo('retail agent', {}, deps);
    expect(deps.generateSetupScript).toHaveBeenCalledOnce();
    const [, sysDeps] = deps.generateSetupScript.mock.calls[0];
    expect(sysDeps).toMatchObject({
      callVertexAI: deps.callVertexAI,
      now: deps.now,
      appVersion: deps.appVersion,
    });
  });

  it('params first arg contains planResult-derived values (source lines 72–87)', async () => {
    const deps = makeDeps();
    await generateDemo('retail agent', {}, deps);
    const [params] = deps.generateSetupScript.mock.calls[0];
    expect(params.systemInstruction).toBe(FIXED_PLAN_RESULT.systemInstruction);
    expect(params.tables).toBe(FIXED_PLAN_RESULT.tables);
    expect(params.firestore).toBe(FIXED_PLAN_RESULT.firestore);
    expect(params.suffix).toBe(FIXED_SUFFIX);
  });

  it('params includes datasetId derived as "demo_"+baseName with dashes->underscores (source line 49)', async () => {
    const deps = makeDeps();
    await generateDemo('retail agent', {}, deps);
    const [params] = deps.generateSetupScript.mock.calls[0];
    // baseName = "retail-orders-abcd1234"
    // datasetId = ("demo_" + "retail-orders-abcd1234").replace(/-/g, '_') = "demo_retail_orders_abcd1234"
    expect(params.datasetId).toBe('demo_retail_orders_abcd1234');
  });

  it('params includes dirName = "demo-"+baseName (source line 48)', async () => {
    const deps = makeDeps();
    await generateDemo('retail agent', {}, deps);
    const [params] = deps.generateSetupScript.mock.calls[0];
    expect(params.dirName).toBe('demo-retail-orders-abcd1234');
  });

  it('params includes userGoal', async () => {
    const deps = makeDeps();
    await generateDemo('retail agent', {}, deps);
    const [params] = deps.generateSetupScript.mock.calls[0];
    expect(params.userGoal).toBe('retail agent');
  });
});

// ---------------------------------------------------------------------------
// (c) Return shape has demoId, setupScript, taxonomy, suffix, dirName, etc.
// ---------------------------------------------------------------------------

describe('return shape (source lines 17–31, 51–70, 141)', () => {
  it('result.success is true on happy path', async () => {
    const deps = makeDeps();
    const result = await generateDemo('retail agent', {}, deps);
    expect(result.success).toBe(true);
  });

  it('result.setupScript is the stub string from generateSetupScript', async () => {
    const deps = makeDeps();
    const result = await generateDemo('retail agent', {}, deps);
    expect(result.setupScript).toBe('#!/bin/bash\necho hello');
  });

  it('result.demoId = demo.id from registry.register (source brief line 52)', async () => {
    const deps = makeDeps();
    const result = await generateDemo('retail agent', {}, deps);
    // domain = "retail-orders", suffix = "abcd1234" → demo-retail-orders-abcd1234
    expect(result.demoId).toBe('demo-retail-orders-abcd1234');
  });

  it('result.industry, .persona, .useCase from taxonomy (source lines 96–103)', async () => {
    const deps = makeDeps();
    const result = await generateDemo('retail agent', {}, deps);
    expect(result.industry).toBe('Retail');
    expect(result.persona).toBe('Operations');
    expect(result.useCase).toBe('Process Automation');
  });

  it('result.industryOther, .personaOther, .useCaseOther from taxonomy (source lines 101–103)', async () => {
    const deps = makeDeps();
    const result = await generateDemo('retail agent', {}, deps);
    expect(result.industryOther).toBe('');
    expect(result.personaOther).toBe('');
    expect(result.useCaseOther).toBe('');
  });

  it('result.suffix equals makeSuffix() value (replacement 2)', async () => {
    const deps = makeDeps();
    const result = await generateDemo('retail agent', {}, deps);
    expect(result.suffix).toBe(FIXED_SUFFIX);
  });

  it('result.dirName = "demo-"+baseName (source line 57)', async () => {
    const deps = makeDeps();
    const result = await generateDemo('retail agent', {}, deps);
    expect(result.dirName).toBe('demo-retail-orders-abcd1234');
  });

  it('result.domainName = baseName without "-suffix" (source line 56)', async () => {
    const deps = makeDeps();
    const result = await generateDemo('retail agent', {}, deps);
    expect(result.domainName).toBe('retail-orders');
  });

  it('result.datasetId derives from baseName (source line 49)', async () => {
    const deps = makeDeps();
    const result = await generateDemo('retail agent', {}, deps);
    expect(result.datasetId).toBe('demo_retail_orders_abcd1234');
  });

  it('result.steps has 3 entries on success (source lines 35–37, 40–43, 88)', async () => {
    const deps = makeDeps();
    const result = await generateDemo('retail agent', {}, deps);
    expect(result.steps).toHaveLength(3);
    expect(result.steps[0]).toMatchObject({ step: 1, status: 'completed' });
    expect(result.steps[1]).toMatchObject({ step: 2, status: 'completed' });
    expect(result.steps[2]).toMatchObject({ step: 4, status: 'completed' });
  });

  it('result.saveStatus has logSheet property on register success (source line 126)', async () => {
    const deps = makeDeps();
    const result = await generateDemo('retail agent', {}, deps);
    expect(result.saveStatus).toBeDefined();
    expect(result.saveStatus).toHaveProperty('logSheet');
  });

  it('result includes planResult-derived fields (source lines 53–70)', async () => {
    const deps = makeDeps();
    const result = await generateDemo('retail agent', {}, deps);
    expect(result.dataPreview).toEqual(FIXED_PLAN_RESULT.dataPreview);
    expect(result.rawTables).toEqual(FIXED_PLAN_RESULT.tables);
    expect(result.businessInstruction).toBe(FIXED_PLAN_RESULT.businessInstruction);
    expect(result.systemInstruction).toBe(FIXED_PLAN_RESULT.systemInstruction);
    expect(result.referenceDate).toBe(FIXED_PLAN_RESULT.referenceDate);
    expect(result.firestore).toBe(FIXED_PLAN_RESULT.firestore);
    expect(result.agentShortName).toBe(FIXED_PLAN_RESULT.agentShortName);
    expect(result.oneSentenceSummary).toBe(FIXED_PLAN_RESULT.oneSentenceSummary);
    expect(result.metadata).toBe(FIXED_PLAN_RESULT.metadata);
  });
});

// ---------------------------------------------------------------------------
// (d) planAndGenerateData and validateGeneratedData invoked (replacement 8)
// ---------------------------------------------------------------------------

describe('planning pipeline deps invoked (replacement 8, source lines 36, 42)', () => {
  it('planAndGenerateData called with (userGoal, mergedOptions) (source line 36)', async () => {
    const deps = makeDeps();
    await generateDemo('retail agent', { rowCount: 50 }, deps);
    expect(deps.planAndGenerateData).toHaveBeenCalledOnce();
    const [goal, opts] = deps.planAndGenerateData.mock.calls[0];
    expect(goal).toBe('retail agent');
    expect(opts.rowCount).toBe(50);
  });

  it('validateGeneratedData called with (planResult, maxRows) (source line 42)', async () => {
    const deps = makeDeps();
    await generateDemo('retail agent', { rowCount: 50 }, deps);
    expect(deps.validateGeneratedData).toHaveBeenCalledOnce();
    const [planResult, maxRows] = deps.validateGeneratedData.mock.calls[0];
    expect(planResult).toBe(FIXED_PLAN_RESULT);
    // maxRows = Math.min(rowCount || 100, 150) = Math.min(50, 150) = 50
    expect(maxRows).toBe(50);
  });

  it('maxRows is capped at 150 (source line 41)', async () => {
    const deps = makeDeps();
    await generateDemo('retail agent', { rowCount: 200 }, deps);
    const [, maxRows] = deps.validateGeneratedData.mock.calls[0];
    expect(maxRows).toBe(150);
  });

  it('generateBaseName called with (userGoal, suffix) (source line 47)', async () => {
    const deps = makeDeps();
    await generateDemo('retail agent', {}, deps);
    expect(deps.generateBaseName).toHaveBeenCalledOnce();
    const [goal, suffix] = deps.generateBaseName.mock.calls[0];
    expect(goal).toBe('retail agent');
    expect(suffix).toBe(FIXED_SUFFIX);
  });

  it('getDataProfile called at options merge phase (source line 3)', async () => {
    const deps = makeDeps();
    await generateDemo('retail agent', {}, deps);
    expect(deps.getDataProfile).toHaveBeenCalledOnce();
    // default dataProfile = 'standard'
    expect(deps.getDataProfile).toHaveBeenCalledWith('standard');
  });

  it('classifyTaxonomy called with (userGoal, oneSentenceSummary, businessInstruction) (replacement 4, source line 95)', async () => {
    const deps = makeDeps();
    await generateDemo('retail agent', {}, deps);
    expect(deps.classifyTaxonomy).toHaveBeenCalledOnce();
    const [goal, summary, biz] = deps.classifyTaxonomy.mock.calls[0];
    expect(goal).toBe('retail agent');
    expect(summary).toBe(FIXED_PLAN_RESULT.oneSentenceSummary);
    expect(biz).toBe(FIXED_PLAN_RESULT.businessInstruction);
  });
});

// ---------------------------------------------------------------------------
// (e) Error path: planAndGenerateData throws
// ---------------------------------------------------------------------------

describe('error path when planAndGenerateData throws (source lines 132–139)', () => {
  it('result.success is false', async () => {
    const deps = makeDeps({
      planAndGenerateData: vi.fn().mockRejectedValue(new Error('AI error')),
    });
    const result = await generateDemo('retail agent', {}, deps);
    expect(result.success).toBe(false);
  });

  it('result.error contains the thrown message (source line 133)', async () => {
    const deps = makeDeps({
      planAndGenerateData: vi.fn().mockRejectedValue(new Error('AI error')),
    });
    const result = await generateDemo('retail agent', {}, deps);
    expect(result.error).toBe('AI error');
  });

  it('last step status set to "error" with error message (source lines 134–138)', async () => {
    const deps = makeDeps({
      planAndGenerateData: vi.fn().mockRejectedValue(new Error('AI error')),
    });
    const result = await generateDemo('retail agent', {}, deps);
    const lastStep = result.steps[result.steps.length - 1];
    expect(lastStep.status).toBe('error');
    expect(lastStep.message).toBe('AI error');
  });

  it('does not throw to caller — error is swallowed into result', async () => {
    const deps = makeDeps({
      planAndGenerateData: vi.fn().mockRejectedValue(new Error('AI error')),
    });
    await expect(generateDemo('retail agent', {}, deps)).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// (f) register failure is tolerated — does NOT stop execution (source lines 125–130)
// ---------------------------------------------------------------------------

describe('register failure tolerated (replacement 7, source lines 125–130)', () => {
  it('result.success stays true even when register throws', async () => {
    const deps = makeDeps({
      registry: {
        register: vi.fn().mockRejectedValue(new Error('Firestore unavailable')),
      },
    });
    const result = await generateDemo('retail agent', {}, deps);
    expect(result.success).toBe(true);
  });

  it('result.saveStatus records register failure with success:false and error message', async () => {
    const deps = makeDeps({
      registry: {
        register: vi.fn().mockRejectedValue(new Error('Firestore unavailable')),
      },
    });
    const result = await generateDemo('retail agent', {}, deps);
    expect(result.saveStatus).toMatchObject({
      logSheet: { success: false, error: 'Firestore unavailable' },
    });
  });

  it('does not throw to caller when register fails', async () => {
    const deps = makeDeps({
      registry: {
        register: vi.fn().mockRejectedValue(new Error('Firestore unavailable')),
      },
    });
    await expect(generateDemo('retail agent', {}, deps)).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Options merging (source lines 3–15)
// ---------------------------------------------------------------------------

describe('options merging (source lines 3–15)', () => {
  it('default dataProfile is "standard" (source line 4)', async () => {
    const deps = makeDeps();
    await generateDemo('retail agent', {}, deps);
    expect(deps.getDataProfile).toHaveBeenCalledWith('standard');
  });

  it('custom dataProfile option is passed to getDataProfile (source line 3)', async () => {
    const deps = makeDeps();
    await generateDemo('retail agent', { dataProfile: 'large' }, deps);
    expect(deps.getDataProfile).toHaveBeenCalledWith('large');
  });

  it('publicDatasetId forced to null when usePublicDataset is false (source lines 13–15)', async () => {
    const deps = makeDeps();
    await generateDemo('retail agent', { publicDatasetId: 'my-dataset', usePublicDataset: false }, deps);
    const [, opts] = deps.planAndGenerateData.mock.calls[0];
    expect(opts.publicDatasetId).toBeNull();
  });

  it('publicDatasetId kept when usePublicDataset is true (source lines 13–15)', async () => {
    const deps = makeDeps();
    await generateDemo('retail agent', { publicDatasetId: 'my-dataset', usePublicDataset: true }, deps);
    const [, opts] = deps.planAndGenerateData.mock.calls[0];
    expect(opts.publicDatasetId).toBe('my-dataset');
  });

  it('importedMcpList forwarded to result (source line 69)', async () => {
    const deps = makeDeps();
    const mcpList = [{ name: 'my-mcp' }];
    const result = await generateDemo('retail agent', { importedMcpList: mcpList }, deps);
    expect(result.importedMcpList).toBe(mcpList);
  });
});

// ---------------------------------------------------------------------------
// clock() used for generationTimeSec (replacement 1, source lines 2, 119)
// ---------------------------------------------------------------------------

describe('clock() replacement (replacement 1, source lines 2 and 119)', () => {
  it('generationTimeSec in historyEntry uses clock(), not Date.now()', async () => {
    // clock returns different values on first vs second call to simulate elapsed time
    let callCount = 0;
    const clock = vi.fn().mockImplementation(() => {
      callCount++;
      return callCount === 1 ? 0 : 5000; // 5 seconds elapsed
    });
    const deps = makeDeps({ clock });
    const result = await generateDemo('retail agent', {}, deps);
    // We can't directly inspect historyEntry, but we can check clock was called at least twice
    // (once for startTime, once for generationTimeSec)
    expect(clock.mock.calls.length).toBeGreaterThanOrEqual(2);
    // result.success should still be true
    expect(result.success).toBe(true);
  });
});
