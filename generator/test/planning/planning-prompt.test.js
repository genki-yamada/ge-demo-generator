/**
 * planning-prompt.test.js — TDD for planning/planning-prompt.js
 *
 * Structural assertions (not byte-golden) for the verbatim-ported
 * buildPlanningPrompt function (Code.gs:1066-1457, 392 lines).
 *
 * deps.today is injected for determinism.
 * getDataProfile is used as the real implementation (deterministic, no I/O).
 */
import { describe, it, expect } from 'vitest';
import { buildPlanningPrompt } from '../../src/planning/planning-prompt.js';

const TODAY = '2026-06-22';

// ---------------------------------------------------------------------------
// Baseline: userGoal interpolation & structural integrity
// ---------------------------------------------------------------------------

describe('buildPlanningPrompt — userGoal interpolation', () => {
  it('contains the exact userGoal string in the returned prompt', () => {
    const goal = 'Optimize supply chain logistics for a retail company';
    const result = buildPlanningPrompt(goal, {}, { today: TODAY });
    expect(result).toContain(goal);
  });

  it('returns a non-empty string', () => {
    const result = buildPlanningPrompt('test goal', {}, { today: TODAY });
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// today injection (Code.gs:4 — Utilities.formatDate replacement)
// ---------------------------------------------------------------------------

describe('buildPlanningPrompt — today injection', () => {
  it('contains the injected today date in the prompt', () => {
    const result = buildPlanningPrompt('some goal', {}, { today: TODAY });
    expect(result).toContain(TODAY);
  });

  it('contains today date in TEMPORAL ANCHOR section', () => {
    const result = buildPlanningPrompt('some goal', {}, { today: TODAY });
    // The source has "Today's actual date is **${todayStr}**"
    expect(result).toContain(`Today's actual date is **${TODAY}**`);
  });

  it('contains today in referenceDate field instruction', () => {
    const result = buildPlanningPrompt('some goal', {}, { today: TODAY });
    // The source has: "referenceDate": "MUST be exactly today's date, ${todayStr}
    expect(result).toContain(`MUST be exactly today's date, ${TODAY}`);
  });

  it('defaults to a plausible date string when deps.today is not injected', () => {
    // When no today injected, should use Intl.DateTimeFormat Asia/Tokyo
    const result = buildPlanningPrompt('some goal', {});
    // Just check it produced a yyyy-MM-dd pattern somewhere in the TEMPORAL ANCHOR section
    expect(result).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(result).toContain("Today's actual date is **");
  });
});

// ---------------------------------------------------------------------------
// maxRows (Code.gs:3 — Math.min(rowCount || defaultRowCount, 150))
// ---------------------------------------------------------------------------

describe('buildPlanningPrompt — maxRows interpolation', () => {
  it('uses profile.defaultRowCount=100 for standard profile when rowCount omitted', () => {
    const result = buildPlanningPrompt('retail goal', { dataProfile: 'standard' }, { today: TODAY });
    // The source has: "at least ${profile.txnMinRows} rows (Target: ${maxRows} rows)"
    // standard profile: txnMinRows=30, defaultRowCount=100 → maxRows=min(100,150)=100
    expect(result).toContain('Target: 100 rows');
  });

  it('uses explicit rowCount when provided (capped at 150)', () => {
    const result = buildPlanningPrompt('goal', { rowCount: 80 }, { today: TODAY });
    // maxRows = min(80, 150) = 80
    expect(result).toContain('Target: 80 rows');
  });

  it('caps rowCount at 150', () => {
    const result = buildPlanningPrompt('goal', { rowCount: 300 }, { today: TODAY });
    // maxRows = min(300, 150) = 150
    expect(result).toContain('Target: 150 rows');
  });

  it('uses deep profile defaultRowCount=150 for deep profile', () => {
    const result = buildPlanningPrompt('goal', { dataProfile: 'deep' }, { today: TODAY });
    // deep: defaultRowCount=150, maxRows=min(150,150)=150
    expect(result).toContain('Target: 150 rows');
  });

  it('uses wide profile defaultRowCount=50 for wide profile', () => {
    const result = buildPlanningPrompt('goal', { dataProfile: 'wide' }, { today: TODAY });
    // wide: defaultRowCount=50, maxRows=min(50,150)=50
    expect(result).toContain('Target: 50 rows');
  });
});

// ---------------------------------------------------------------------------
// publicDatasetInfo conditional (Code.gs:5-12)
// ---------------------------------------------------------------------------

describe('buildPlanningPrompt — publicDataset conditional branch', () => {
  it('includes ENRICHMENT text and publicDatasetId when usePublicDataset=true and publicDatasetId set', () => {
    const result = buildPlanningPrompt(
      'some goal',
      { usePublicDataset: true, publicDatasetId: 'bigquery-public-data.usa_names.usa_1910_2013' },
      { today: TODAY }
    );
    expect(result).toContain('bigquery-public-data.usa_names.usa_1910_2013');
    expect(result).toContain('ENRICHMENT ONLY');
    expect(result).toContain('EXTERNAL CONTEXT');
    expect(result).toContain('OUTPUT FIELD (MANDATORY)');
  });

  it('includes the no-public-dataset notice when usePublicDataset=false', () => {
    const result = buildPlanningPrompt(
      'some goal',
      { usePublicDataset: false },
      { today: TODAY }
    );
    expect(result).toContain('NO public dataset should be used for this demo');
    expect(result).toContain('"publicDatasetId" to null');
    expect(result).not.toContain('ENRICHMENT ONLY');
  });

  it('includes the no-public-dataset notice when usePublicDataset is undefined (falsy)', () => {
    const result = buildPlanningPrompt('some goal', {}, { today: TODAY });
    expect(result).toContain('NO public dataset should be used for this demo');
  });

  it('includes the no-public-dataset notice when publicDatasetId is falsy even if usePublicDataset=true', () => {
    // Source: options.usePublicDataset && options.publicDatasetId — both must be truthy
    const result = buildPlanningPrompt(
      'some goal',
      { usePublicDataset: true, publicDatasetId: '' },
      { today: TODAY }
    );
    expect(result).toContain('NO public dataset should be used for this demo');
  });
});

// ---------------------------------------------------------------------------
// profile values (Code.gs:83-95)
// ---------------------------------------------------------------------------

describe('buildPlanningPrompt — profile interpolations', () => {
  it('contains standard profile label', () => {
    const result = buildPlanningPrompt('goal', { dataProfile: 'standard' }, { today: TODAY });
    expect(result).toContain('Standard');
  });

  it('contains deep profile label', () => {
    const result = buildPlanningPrompt('goal', { dataProfile: 'deep' }, { today: TODAY });
    expect(result).toContain('Deep Analysis');
  });

  it('contains wide profile label', () => {
    const result = buildPlanningPrompt('goal', { dataProfile: 'wide' }, { today: TODAY });
    expect(result).toContain('Wide Schema');
  });

  it('contains masterMinRows for standard profile', () => {
    const result = buildPlanningPrompt('goal', { dataProfile: 'standard' }, { today: TODAY });
    // standard: masterMinRows=10, masterRows='20-30'
    expect(result).toContain('AT LEAST 10 rows');
    expect(result).toContain('20-30 rows');
  });

  it('contains the profile strategy string', () => {
    const result = buildPlanningPrompt('goal', { dataProfile: 'standard' }, { today: TODAY });
    // standard strategy contains "Balanced star-schema"
    expect(result).toContain('Balanced star-schema');
  });

  it('falls back to standard profile when dataProfile is not provided', () => {
    const result = buildPlanningPrompt('goal', {}, { today: TODAY });
    expect(result).toContain('Standard');
  });

  it('contains profile tableCount', () => {
    const result = buildPlanningPrompt('goal', { dataProfile: 'standard' }, { today: TODAY });
    // standard: tableCount='5'
    expect(result).toContain('(5 tables)');
  });

  it('contains profile masterRows in MAXIMUM DATA section', () => {
    const result = buildPlanningPrompt('goal', { dataProfile: 'standard' }, { today: TODAY });
    // source line: "**${profile.masterRows} rows for Master Tables**"
    expect(result).toContain('20-30 rows for Master Tables');
  });

  it('contains profile txnRows in MAXIMUM DATA section', () => {
    const result = buildPlanningPrompt('goal', { dataProfile: 'standard' }, { today: TODAY });
    // source line: "at least ${profile.txnRows} rows (target ${maxRows})"
    expect(result).toContain('at least 80+ rows');
  });
});

// ---------------------------------------------------------------------------
// Real prompt section headings (verbatim from source)
// ---------------------------------------------------------------------------

describe('buildPlanningPrompt — verbatim section headings', () => {
  it('contains AGENT ARCHETYPE & FIRESTORE STRATEGY section', () => {
    const result = buildPlanningPrompt('goal', {}, { today: TODAY });
    expect(result).toContain('## AGENT ARCHETYPE & FIRESTORE STRATEGY (CRITICAL)');
  });

  it('contains Type A: Automated Transactional Operator heading', () => {
    const result = buildPlanningPrompt('goal', {}, { today: TODAY });
    expect(result).toContain('### Type A: Automated Transactional Operator (Write-Heavy / Queue-Driven)');
  });

  it('contains Type B: Strategic Insight Advisor heading', () => {
    const result = buildPlanningPrompt('goal', {}, { today: TODAY });
    expect(result).toContain('### Type B: Strategic Insight Advisor (Read-Heavy / Diagnostic / Proposal-Driven)');
  });

  it('contains TEMPORAL ANCHOR section', () => {
    const result = buildPlanningPrompt('goal', {}, { today: TODAY });
    expect(result).toContain('## TEMPORAL ANCHOR (CRITICAL — TODAY\'S DATE)');
  });

  it('contains REALISTIC DATA SYNTHESIS section', () => {
    const result = buildPlanningPrompt('goal', {}, { today: TODAY });
    expect(result).toContain('## REALISTIC DATA SYNTHESIS (CRITICAL)');
  });

  it('contains Output Format section', () => {
    const result = buildPlanningPrompt('goal', {}, { today: TODAY });
    expect(result).toContain('## Output Format (JSON)');
  });

  it('contains Critical Notes section', () => {
    const result = buildPlanningPrompt('goal', {}, { today: TODAY });
    expect(result).toContain('## Critical Notes');
  });

  it('contains Business Problem section', () => {
    const result = buildPlanningPrompt('goal', {}, { today: TODAY });
    expect(result).toContain('## Business Problem');
  });

  it('contains Requirements section', () => {
    const result = buildPlanningPrompt('goal', {}, { today: TODAY });
    expect(result).toContain('## Requirements');
  });

  it('contains CRITICAL LANGUAGE RULE verbatim', () => {
    const result = buildPlanningPrompt('goal', {}, { today: TODAY });
    expect(result).toContain('**CRITICAL LANGUAGE RULE (MANDATORY)**');
  });

  it('contains Audit Seeds section', () => {
    const result = buildPlanningPrompt('goal', {}, { today: TODAY });
    expect(result).toContain('### 6. Audit Seeds');
  });

  it('contains STRICT CSV FORMATTING section', () => {
    const result = buildPlanningPrompt('goal', {}, { today: TODAY });
    expect(result).toContain('**STRICT CSV FORMATTING**');
  });
});
