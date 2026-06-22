/**
 * plan-and-generate.test.js — TDD for planning/plan-and-generate.js
 *
 * Covers the planAndGenerateData orchestrator (Code.gs:735-845).
 * ALL external deps are stubbed. Pure helpers (buildPlanningPrompt,
 * repairTruncatedJson, parseCSVLine, validateGeneratedData,
 * getTechnicalInstruction, resolvePlannedPublicDatasetId) are imported real.
 *
 * validate-data.js is vi.mock'd so that validateGeneratedData is a spy that
 * calls through to the real implementation by default; the no-csvData test
 * overrides it once to suppress the validator so the dataPreview skip branch
 * can be observed before validation runs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock validate-data so validateGeneratedData is a controllable spy
vi.mock('../../src/planning/validate-data.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    validateGeneratedData: vi.fn((...args) => real.validateGeneratedData(...args)),
  };
});

import { planAndGenerateData } from '../../src/planning/plan-and-generate.js';
import { getTechnicalInstruction } from '../../src/planning/technical-instruction.js';
import { validateGeneratedData } from '../../src/planning/validate-data.js';

// ---------------------------------------------------------------------------
// Canned LLM response — minimal valid plan JSON
// ---------------------------------------------------------------------------

const CANNED_TABLE = {
  tableName: 'orders',
  schema: [
    { name: 'order_id', type: 'INTEGER', description: 'Order ID' },
    { name: 'amount', type: 'FLOAT', description: 'Order amount' },
    { name: 'note', type: 'STRING', description: 'Note' },
  ],
  csvData: [
    'order_id,amount,note',
    '1,100.00,first',
    '2,200.00,second',
    '3,300.00,third',
  ].join('\n'),
};

const CANNED_PLAN = {
  tables: [CANNED_TABLE],
  businessInstruction: 'Business instruction text.',
  demoGuide: ['Step 1', 'Step 2'],
  agentShortName: 'OrderBot',
  oneSentenceSummary: 'Manages orders.',
  externalFiles: [],
  appliedFactors: { factor: 'value' },
  firestore: null,
  referenceDate: '2026-01-15',
  publicDatasetId: null,
};

function makeCannedResponse(overrides = {}) {
  return JSON.stringify({ ...CANNED_PLAN, ...overrides });
}

// ---------------------------------------------------------------------------
// Default stub factory
// ---------------------------------------------------------------------------

function makeDefaultDeps(overrides = {}) {
  return {
    vertexClient: {
      generateContent: vi.fn().mockResolvedValue(makeCannedResponse()),
    },
    discoverPublicDataset: vi.fn().mockResolvedValue('bigquery-public-data.samples'),
    verifyAndResolveTable: vi.fn().mockReturnValue(null),
    generateImage: vi.fn().mockResolvedValue({ base64Data: 'base64abc', mimeType: 'image/png' }),
    today: '2026-06-22',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. vertexClient.generateContent called with buildPlanningPrompt output
// ---------------------------------------------------------------------------

describe('vertexClient.generateContent called with correct prompt', () => {
  it('calls generateContent with a prompt string containing the userGoal', async () => {
    const deps = makeDefaultDeps();
    const options = { rowCount: 10, dataProfile: 'standard' };
    await planAndGenerateData('retail inventory management', options, deps);
    expect(deps.vertexClient.generateContent).toHaveBeenCalledOnce();
    const promptArg = deps.vertexClient.generateContent.mock.calls[0][0];
    expect(typeof promptArg).toBe('string');
    expect(promptArg.length).toBeGreaterThan(50);
    // buildPlanningPrompt output includes the userGoal
    expect(promptArg).toContain('retail inventory management');
  });
});

// ---------------------------------------------------------------------------
// 2. MCP / Workspace prompt augmentation (verbatim from source lines 8-28)
// ---------------------------------------------------------------------------

describe('MCP and Workspace prompt augmentation (source lines 8-28)', () => {
  it('appends importedMcpList entry to prompt when present', async () => {
    const mcpList = [
      {
        github_url: 'https://github.com/example/my-mcp-server.git',
        capabilities: ['search', 'write'],
      },
    ];
    const deps = makeDefaultDeps();
    const options = { rowCount: 10, importedMcpList: mcpList };
    await planAndGenerateData('logistics', options, deps);
    const promptArg = deps.vertexClient.generateContent.mock.calls[0][0];
    expect(promptArg).toContain('CUSTOM MCP SERVER TOOL #1 AVAILABLE (my-mcp-server)');
    expect(promptArg).toContain('search, write');
    expect(promptArg).toContain("You MUST leverage these capabilities");
  });

  it('appends enableWorkspaceMcp block when enabled', async () => {
    const deps = makeDefaultDeps();
    const options = { rowCount: 10, enableWorkspaceMcp: true };
    await planAndGenerateData('calendar scheduling', options, deps);
    const promptArg = deps.vertexClient.generateContent.mock.calls[0][0];
    expect(promptArg).toContain('GOOGLE WORKSPACE MCP TOOLS AVAILABLE');
    expect(promptArg).toContain('Gmail, Drive, Calendar, Chat, People');
  });

  it('does NOT append MCP block when importedMcpList is empty', async () => {
    const deps = makeDefaultDeps();
    const options = { rowCount: 10, importedMcpList: [] };
    await planAndGenerateData('logistics', options, deps);
    const promptArg = deps.vertexClient.generateContent.mock.calls[0][0];
    expect(promptArg).not.toContain('CUSTOM MCP SERVER TOOL');
  });

  it('does NOT append Workspace block when enableWorkspaceMcp is falsy', async () => {
    const deps = makeDefaultDeps();
    const options = { rowCount: 10 };
    await planAndGenerateData('logistics', options, deps);
    const promptArg = deps.vertexClient.generateContent.mock.calls[0][0];
    expect(promptArg).not.toContain('GOOGLE WORKSPACE MCP TOOLS AVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// 3. discoverPublicDataset called when usePublicDataset && !publicDatasetId
// ---------------------------------------------------------------------------

describe('discoverPublicDataset (source line 3-4)', () => {
  it('calls discoverPublicDataset and sets options.publicDatasetId when usePublicDataset=true and no id', async () => {
    const deps = makeDefaultDeps();
    const options = { usePublicDataset: true };
    await planAndGenerateData('sales analytics', options, deps);
    expect(deps.discoverPublicDataset).toHaveBeenCalledOnce();
    expect(deps.discoverPublicDataset).toHaveBeenCalledWith('sales analytics');
    // options.publicDatasetId is set from returned value
    expect(options.publicDatasetId).toBe('bigquery-public-data.samples');
  });

  it('does NOT call discoverPublicDataset when publicDatasetId already set', async () => {
    const deps = makeDefaultDeps();
    const options = { usePublicDataset: true, publicDatasetId: 'existing-id' };
    await planAndGenerateData('sales analytics', options, deps);
    expect(deps.discoverPublicDataset).not.toHaveBeenCalled();
  });

  it('does NOT call discoverPublicDataset when usePublicDataset=false', async () => {
    const deps = makeDefaultDeps();
    const options = { usePublicDataset: false };
    await planAndGenerateData('sales analytics', options, deps);
    expect(deps.discoverPublicDataset).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Return shape matches specification exactly (source lines 87-101)
// ---------------------------------------------------------------------------

describe('return shape (source lines 87-101)', () => {
  it('returns all 13 required fields', async () => {
    const deps = makeDefaultDeps();
    const result = await planAndGenerateData('demo goal', {}, deps);
    const expected = [
      'tables', 'businessInstruction', 'technicalInstruction', 'systemInstruction',
      'referenceDate', 'publicDatasetId', 'agentShortName', 'oneSentenceSummary',
      'demoGuide', 'externalFiles', 'appliedFactors', 'firestore', 'dataPreview',
    ];
    for (const field of expected) {
      expect(result).toHaveProperty(field);
    }
  });

  it('businessInstruction falls back through systemInstruction then empty string', async () => {
    // parsed.businessInstruction missing → uses parsed.systemInstruction
    const plan = { ...CANNED_PLAN, businessInstruction: undefined, systemInstruction: 'FallbackSys' };
    const deps = makeDefaultDeps({
      vertexClient: { generateContent: vi.fn().mockResolvedValue(JSON.stringify(plan)) },
    });
    const result = await planAndGenerateData('goal', {}, deps);
    expect(result.businessInstruction).toBe('FallbackSys');
  });

  it('businessInstruction falls back to empty string when both undefined', async () => {
    const plan = { ...CANNED_PLAN, businessInstruction: undefined, systemInstruction: undefined };
    const deps = makeDefaultDeps({
      vertexClient: { generateContent: vi.fn().mockResolvedValue(JSON.stringify(plan)) },
    });
    const result = await planAndGenerateData('goal', {}, deps);
    expect(result.businessInstruction).toBe('');
  });

  it('systemInstruction = businessInstruction + "\\n\\n" + getTechnicalInstruction()', async () => {
    const deps = makeDefaultDeps();
    const result = await planAndGenerateData('goal', {}, deps);
    const expected = `${CANNED_PLAN.businessInstruction}\n\n${getTechnicalInstruction()}`;
    expect(result.systemInstruction).toBe(expected);
  });

  it('technicalInstruction equals getTechnicalInstruction()', async () => {
    const deps = makeDefaultDeps();
    const result = await planAndGenerateData('goal', {}, deps);
    expect(result.technicalInstruction).toBe(getTechnicalInstruction());
  });

  it('externalFiles defaults to [] when missing from parsed', async () => {
    const plan = { ...CANNED_PLAN, externalFiles: undefined };
    const deps = makeDefaultDeps({
      vertexClient: { generateContent: vi.fn().mockResolvedValue(JSON.stringify(plan)) },
    });
    const result = await planAndGenerateData('goal', {}, deps);
    expect(result.externalFiles).toEqual([]);
  });

  it('agentShortName defaults to null when missing', async () => {
    const plan = { ...CANNED_PLAN, agentShortName: undefined };
    const deps = makeDefaultDeps({
      vertexClient: { generateContent: vi.fn().mockResolvedValue(JSON.stringify(plan)) },
    });
    const result = await planAndGenerateData('goal', {}, deps);
    expect(result.agentShortName).toBeNull();
  });

  it('appliedFactors defaults to null when missing', async () => {
    const plan = { ...CANNED_PLAN, appliedFactors: undefined };
    const deps = makeDefaultDeps({
      vertexClient: { generateContent: vi.fn().mockResolvedValue(JSON.stringify(plan)) },
    });
    const result = await planAndGenerateData('goal', {}, deps);
    expect(result.appliedFactors).toBeNull();
  });

  it('firestore defaults to null when missing', async () => {
    const plan = { ...CANNED_PLAN, firestore: undefined };
    const deps = makeDefaultDeps({
      vertexClient: { generateContent: vi.fn().mockResolvedValue(JSON.stringify(plan)) },
    });
    const result = await planAndGenerateData('goal', {}, deps);
    expect(result.firestore).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. referenceDate fallback (source line 92)
// ---------------------------------------------------------------------------

describe('referenceDate fallback (source line 92)', () => {
  it('uses parsed.referenceDate when present', async () => {
    const deps = makeDefaultDeps();
    const result = await planAndGenerateData('goal', {}, deps);
    expect(result.referenceDate).toBe('2026-01-15');
  });

  it('falls back to deps.today when parsed.referenceDate is absent', async () => {
    const plan = { ...CANNED_PLAN, referenceDate: undefined };
    const deps = makeDefaultDeps({
      vertexClient: { generateContent: vi.fn().mockResolvedValue(JSON.stringify(plan)) },
      today: '2026-06-22',
    });
    const result = await planAndGenerateData('goal', {}, deps);
    expect(result.referenceDate).toBe('2026-06-22');
  });

  it('falls back to formatTokyoDate(new Date()) when neither parsed nor today supplied', async () => {
    const plan = { ...CANNED_PLAN, referenceDate: undefined };
    const { today: _today, ...depsWithoutToday } = makeDefaultDeps({
      vertexClient: { generateContent: vi.fn().mockResolvedValue(JSON.stringify(plan)) },
    });
    const result = await planAndGenerateData('goal', {}, depsWithoutToday);
    // Should be a valid yyyy-MM-dd string
    expect(result.referenceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// 6. dataPreview construction from csvData (source lines 41-61)
// ---------------------------------------------------------------------------

describe('dataPreview construction (source lines 41-61)', () => {
  it('builds dataPreview with correct headers, rows, totalRows', async () => {
    const deps = makeDefaultDeps();
    const result = await planAndGenerateData('goal', {}, deps);
    expect(result.dataPreview).toHaveLength(1);
    const preview = result.dataPreview[0];
    expect(preview.tableName).toBe('orders');
    expect(preview.headers).toEqual(['order_id', 'amount', 'note']);
    expect(preview.totalRows).toBe(3);
    expect(preview.rows).toHaveLength(3);
    expect(preview.rows[0]).toMatchObject({ order_id: '1', note: 'first' });
  });

  it('strips outer quotes from header names', async () => {
    const tableWithQuotedHeaders = {
      ...CANNED_TABLE,
      schema: [
        { name: 'order_id', type: 'INTEGER', description: 'Order ID' },
        { name: 'amount', type: 'FLOAT', description: 'Amount' },
        { name: 'note', type: 'STRING', description: 'Note' },
      ],
      csvData: [
        '"order_id","amount","note"',
        '"1",100.00,"first"',
        '"2",200.00,"second"',
      ].join('\n'),
    };
    const plan = { ...CANNED_PLAN, tables: [tableWithQuotedHeaders] };
    const deps = makeDefaultDeps({
      vertexClient: { generateContent: vi.fn().mockResolvedValue(JSON.stringify(plan)) },
    });
    const result = await planAndGenerateData('goal', {}, deps);
    expect(result.dataPreview[0].headers).toEqual(['order_id', 'amount', 'note']);
  });

  it('throws via validateGeneratedData when parsed.tables is empty', async () => {
    const plan = { ...CANNED_PLAN, tables: [] };
    const deps = makeDefaultDeps({
      vertexClient: { generateContent: vi.fn().mockResolvedValue(JSON.stringify(plan)) },
    });
    // validateGeneratedData throws on empty tables — catch it
    await expect(planAndGenerateData('goal', {}, deps)).rejects.toThrow('No table definitions generated');
  });

  it('skips dataPreview entry for table without csvData', async () => {
    // Two tables: one WITH csvData, one WITHOUT — only the former should appear in dataPreview.
    // validateGeneratedData is suppressed for this test (it would throw on the csvData-less table)
    // so we can observe the if (table.csvData) skip branch in plan-and-generate.js line 107.
    const tableWithCsv = { ...CANNED_TABLE };
    const tableNoCsv = {
      tableName: 'no_csv_table',
      schema: [{ name: 'id', type: 'INTEGER', description: 'ID' }],
      // csvData intentionally absent — JSON.stringify will omit this key
    };
    const plan = { ...CANNED_PLAN, tables: [tableWithCsv, tableNoCsv] };
    // Suppress validateGeneratedData for this test only so the throw on missing csvData
    // doesn't prevent us from observing the dataPreview result.
    validateGeneratedData.mockImplementationOnce(() => {});
    const deps = makeDefaultDeps({
      vertexClient: { generateContent: vi.fn().mockResolvedValue(JSON.stringify(plan)) },
    });
    const result = await planAndGenerateData('goal', {}, deps);
    // Only the table WITH csvData should appear in dataPreview (the skip branch was exercised)
    expect(result.dataPreview).toHaveLength(1);
    expect(result.dataPreview[0].tableName).toBe('orders');
  });
});

// ---------------------------------------------------------------------------
// 7. Image generation loop (source lines 63-82)
// ---------------------------------------------------------------------------

describe('image generation loop (source lines 63-82)', () => {
  it('calls generateImage for externalFiles with image/ mimeType and imagePrompt', async () => {
    const imageFile = {
      fileName: 'chart.png',
      mimeType: 'image/png',
      imagePrompt: 'A bar chart of sales data',
    };
    const plan = { ...CANNED_PLAN, externalFiles: [imageFile] };
    const deps = makeDefaultDeps({
      vertexClient: { generateContent: vi.fn().mockResolvedValue(JSON.stringify(plan)) },
    });
    const result = await planAndGenerateData('goal', {}, deps);
    expect(deps.generateImage).toHaveBeenCalledOnce();
    expect(deps.generateImage).toHaveBeenCalledWith('A bar chart of sales data');
    expect(result.externalFiles[0].base64Data).toBe('base64abc');
    expect(result.externalFiles[0].mimeType).toBe('image/png');
  });

  it('skips generateImage for non-image externalFiles', async () => {
    const docFile = {
      fileName: 'report.pdf',
      mimeType: 'application/pdf',
    };
    const plan = { ...CANNED_PLAN, externalFiles: [docFile] };
    const deps = makeDefaultDeps({
      vertexClient: { generateContent: vi.fn().mockResolvedValue(JSON.stringify(plan)) },
    });
    await planAndGenerateData('goal', {}, deps);
    expect(deps.generateImage).not.toHaveBeenCalled();
  });

  it('skips generateImage for image files without imagePrompt', async () => {
    const imageFileNoPrompt = {
      fileName: 'logo.png',
      mimeType: 'image/png',
      // no imagePrompt
    };
    const plan = { ...CANNED_PLAN, externalFiles: [imageFileNoPrompt] };
    const deps = makeDefaultDeps({
      vertexClient: { generateContent: vi.fn().mockResolvedValue(JSON.stringify(plan)) },
    });
    await planAndGenerateData('goal', {}, deps);
    expect(deps.generateImage).not.toHaveBeenCalled();
  });

  it('tolerates generateImage throwing — swallows error and continues', async () => {
    const imageFile = {
      fileName: 'broken.png',
      mimeType: 'image/png',
      imagePrompt: 'Generate something',
    };
    const plan = { ...CANNED_PLAN, externalFiles: [imageFile] };
    const deps = makeDefaultDeps({
      vertexClient: { generateContent: vi.fn().mockResolvedValue(JSON.stringify(plan)) },
      generateImage: vi.fn().mockRejectedValue(new Error('Image gen failed')),
    });
    // Should NOT throw — error is swallowed
    const result = await planAndGenerateData('goal', {}, deps);
    expect(result).toBeDefined();
    // base64Data not set on file since generation failed
    expect(result.externalFiles[0].base64Data).toBeUndefined();
  });

  it('works without generateImage injected (optional dep)', async () => {
    const imageFile = {
      fileName: 'optional.png',
      mimeType: 'image/png',
      imagePrompt: 'Draw something',
    };
    const plan = { ...CANNED_PLAN, externalFiles: [imageFile] };
    const { generateImage: _gi, ...depsNoImage } = makeDefaultDeps({
      vertexClient: { generateContent: vi.fn().mockResolvedValue(JSON.stringify(plan)) },
    });
    const result = await planAndGenerateData('goal', {}, depsNoImage);
    // Should complete without error
    expect(result).toBeDefined();
    expect(result.externalFiles[0].base64Data).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 8. Bad JSON parsing → throws 'Failed to parse AI response...' (source line 36-38)
// ---------------------------------------------------------------------------

describe('JSON parse error handling (source lines 33-38)', () => {
  it('throws on completely unparseable response', async () => {
    const deps = makeDefaultDeps({
      vertexClient: { generateContent: vi.fn().mockResolvedValue('THIS IS NOT JSON AT ALL!!!') },
    });
    await expect(planAndGenerateData('goal', {}, deps)).rejects.toThrow(
      'Failed to parse AI response. Try reducing the row/table count.'
    );
  });

  it('handles ```json fence-wrapped response gracefully (strips fence)', async () => {
    const wrapped = '```json\n' + makeCannedResponse() + '\n```';
    const deps = makeDefaultDeps({
      vertexClient: { generateContent: vi.fn().mockResolvedValue(wrapped) },
    });
    const result = await planAndGenerateData('goal', {}, deps);
    expect(result.businessInstruction).toBe('Business instruction text.');
  });
});

// ---------------------------------------------------------------------------
// 9. validateGeneratedData called (source line 85)
// ---------------------------------------------------------------------------

describe('validateGeneratedData called on parsed result (source line 85)', () => {
  it('validateGeneratedData mutates csvData (type-quotes headers)', async () => {
    // The real validateGeneratedData re-quotes STRING/DATE headers
    // After validation, the headers in csvData get quote-wrapped
    const deps = makeDefaultDeps();
    const result = await planAndGenerateData('goal', {}, deps);
    // After validation, tables[0].csvData is cleaned (STRING cols quoted in header)
    expect(result.tables[0].csvData).toContain('"note"');
  });
});

// ---------------------------------------------------------------------------
// 10. resolvePlannedPublicDatasetId called with correct args (source line 93)
// ---------------------------------------------------------------------------

describe('resolvePlannedPublicDatasetId (source line 93)', () => {
  it('returns null when usePublicDataset=false', async () => {
    const deps = makeDefaultDeps();
    const result = await planAndGenerateData('goal', { usePublicDataset: false }, deps);
    expect(result.publicDatasetId).toBeNull();
  });

  it('returns options.publicDatasetId when usePublicDataset=true', async () => {
    const plan = { ...CANNED_PLAN, publicDatasetId: 'some-dataset' };
    const deps = makeDefaultDeps({
      vertexClient: { generateContent: vi.fn().mockResolvedValue(JSON.stringify(plan)) },
    });
    const result = await planAndGenerateData(
      'goal',
      { usePublicDataset: true, publicDatasetId: 'some-dataset' },
      deps
    );
    expect(result.publicDatasetId).toBe('some-dataset');
  });
});
