/**
 * research.test.js — TDD tests for planning/research.js
 *
 * Tests three functions ported from Code.gs:
 *   - researchCompanyByDomain  (Code.gs:15501)
 *   - regenerateGoalForWorkflows (Code.gs:15644)
 *   - optimizeGoalWithMagicWand  (Code.gs:16413)
 *
 * vertexClient is stubbed — no real network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  researchCompanyByDomain,
  regenerateGoalForWorkflows,
  optimizeGoalWithMagicWand,
} from '../../src/planning/research.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(textOrFn) {
  return {
    generateContent: typeof textOrFn === 'function'
      ? vi.fn(textOrFn)
      : vi.fn().mockResolvedValue(textOrFn),
  };
}

// A valid research JSON payload (matching Code.gs:15621-15629 return shape)
const VALID_RESEARCH_JSON = JSON.stringify({
  companyName: 'Toyota Motor Corporation',
  companySummary: 'A global automotive manufacturer headquartered in Toyota, Aichi.',
  industry: 'Manufacturing',
  businessChallenges: ['Supply chain complexity', 'EV transition', 'Cost pressure'],
  workflows: [
    { name: 'Procurement', automatable: true, reason: 'High volume repetitive tasks' },
    { name: 'Logistics', automatable: false, reason: 'Requires human judgment' },
  ],
  suggestedGoal: 'Toyota needs an AI agent to optimize its procurement process.',
});

// A research JSON missing required fields (Code.gs:15617 validation)
const RESEARCH_JSON_MISSING_FIELDS = JSON.stringify({
  companySummary: 'Some text',
});

// A response where JSON is wrapped in markdown code block (Code.gs:15600)
const RESEARCH_JSON_IN_CODEBLOCK = '```json\n' + VALID_RESEARCH_JSON + '\n```';

// A response where JSON is embedded in surrounding text (Code.gs:15607)
const RESEARCH_JSON_EMBEDDED = 'Here is the research:\n' + VALID_RESEARCH_JSON + '\nEnd.';

// ---------------------------------------------------------------------------
// researchCompanyByDomain
// ---------------------------------------------------------------------------

describe('researchCompanyByDomain', () => {
  it('returns {success:false, error:"Domain is required."} when domain is falsy (Code.gs:15502-15504)', async () => {
    const client = makeClient('irrelevant');
    const result = await researchCompanyByDomain('', { vertexClient: client });
    expect(result).toEqual({ success: false, error: 'Domain is required.' });
    expect(client.generateContent).not.toHaveBeenCalled();
  });

  it('returns {success:false, error:"Domain is required."} when domain is not a string (Code.gs:15502)', async () => {
    const client = makeClient('irrelevant');
    const result = await researchCompanyByDomain(null, { vertexClient: client });
    expect(result).toEqual({ success: false, error: 'Domain is required.' });
  });

  it('calls generateContent with search:true (Code.gs:15576-15578)', async () => {
    const client = makeClient(VALID_RESEARCH_JSON);
    await researchCompanyByDomain('toyota.co.jp', { vertexClient: client });
    expect(client.generateContent).toHaveBeenCalledOnce();
    const [, opts] = client.generateContent.mock.calls[0];
    expect(opts).toMatchObject({ search: true });
  });

  it('includes domain in the prompt (Code.gs:15530)', async () => {
    const client = makeClient(VALID_RESEARCH_JSON);
    await researchCompanyByDomain('toyota.co.jp', { vertexClient: client });
    const [prompt] = client.generateContent.mock.calls[0];
    expect(prompt).toContain('toyota.co.jp');
  });

  it('normalizes domain — strips https://www. prefix (Code.gs:15507)', async () => {
    const client = makeClient(VALID_RESEARCH_JSON);
    await researchCompanyByDomain('https://www.Toyota.Co.JP/some/path', { vertexClient: client });
    const [prompt] = client.generateContent.mock.calls[0];
    expect(prompt).toContain('toyota.co.jp');
    expect(prompt).not.toContain('https://');
    expect(prompt).not.toContain('www.');
  });

  it('detects Japanese TLD and sets response language to 日本語 (Code.gs:15511)', async () => {
    const client = makeClient(VALID_RESEARCH_JSON);
    await researchCompanyByDomain('toyota.co.jp', { vertexClient: client });
    const [prompt] = client.generateContent.mock.calls[0];
    expect(prompt).toContain('日本語');
  });

  it('detects .com TLD and sets response language to English (Code.gs:15516)', async () => {
    const client = makeClient(VALID_RESEARCH_JSON);
    await researchCompanyByDomain('example.com', { vertexClient: client });
    const [prompt] = client.generateContent.mock.calls[0];
    expect(prompt).toContain('English');
  });

  it('strips markdown code block and parses JSON (Code.gs:15600)', async () => {
    const client = makeClient(RESEARCH_JSON_IN_CODEBLOCK);
    const result = await researchCompanyByDomain('toyota.co.jp', { vertexClient: client });
    expect(result.success).toBe(true);
    expect(result.companyName).toBe('Toyota Motor Corporation');
  });

  it('extracts embedded JSON using regex fallback (Code.gs:15607)', async () => {
    const client = makeClient(RESEARCH_JSON_EMBEDDED);
    const result = await researchCompanyByDomain('toyota.co.jp', { vertexClient: client });
    expect(result.success).toBe(true);
    expect(result.companyName).toBe('Toyota Motor Corporation');
  });

  it('returns full success shape matching Code.gs:15621-15629', async () => {
    const client = makeClient(VALID_RESEARCH_JSON);
    const result = await researchCompanyByDomain('toyota.co.jp', { vertexClient: client });
    expect(result).toEqual({
      success: true,
      companyName: 'Toyota Motor Corporation',
      companySummary: 'A global automotive manufacturer headquartered in Toyota, Aichi.',
      industry: 'Manufacturing',
      businessChallenges: ['Supply chain complexity', 'EV transition', 'Cost pressure'],
      workflows: [
        { name: 'Procurement', automatable: true, reason: 'High volume repetitive tasks' },
        { name: 'Logistics', automatable: false, reason: 'Requires human judgment' },
      ],
      suggestedGoal: 'Toyota needs an AI agent to optimize its procurement process.',
    });
  });

  it('returns {success:false,error} when required fields missing (Code.gs:15617-15618)', async () => {
    const client = makeClient(RESEARCH_JSON_MISSING_FIELDS);
    const result = await researchCompanyByDomain('unknown.io', { vertexClient: client });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Could not find sufficient information for domain: unknown.io');
  });

  it('defaults optional fields to empty values when absent (Code.gs:15624-15628)', async () => {
    const minimal = JSON.stringify({ companyName: 'Acme', suggestedGoal: 'Do stuff' });
    const client = makeClient(minimal);
    const result = await researchCompanyByDomain('acme.com', { vertexClient: client });
    expect(result.success).toBe(true);
    expect(result.companySummary).toBe('');
    expect(result.industry).toBe('');
    expect(result.businessChallenges).toEqual([]);
    expect(result.workflows).toEqual([]);
  });

  it('returns {success:false, error:"Research failed: ..."} on generateContent rejection (Code.gs:15630-15633)', async () => {
    const client = { generateContent: vi.fn().mockRejectedValue(new Error('network error')) };
    const result = await researchCompanyByDomain('toyota.co.jp', { vertexClient: client });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Research failed: network error');
  });

  it('returns {success:false, error} on completely unparseable response (Code.gs:15611-15613)', async () => {
    const client = makeClient('This is not JSON at all, no braces');
    const result = await researchCompanyByDomain('toyota.co.jp', { vertexClient: client });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Research failed:');
  });
});

// ---------------------------------------------------------------------------
// regenerateGoalForWorkflows
// ---------------------------------------------------------------------------

describe('regenerateGoalForWorkflows', () => {
  const companyInfo = {
    companyName: 'Toyota Motor Corporation',
    industry: 'Manufacturing',
    companySummary: 'A global automotive manufacturer.',
  };

  const selectedWorkflows = [
    { name: 'Procurement', reason: 'High volume repetitive tasks' },
    { name: 'Demand Forecasting', reason: 'Data-driven automation potential' },
  ];

  it('returns {success:false} when companyInfo is missing (Code.gs:15645)', async () => {
    const client = makeClient('Goal text');
    const result = await regenerateGoalForWorkflows(null, selectedWorkflows, { vertexClient: client });
    expect(result).toEqual({ success: false, error: 'Company info and at least one workflow are required.' });
    expect(client.generateContent).not.toHaveBeenCalled();
  });

  it('returns {success:false} when selectedWorkflows is empty (Code.gs:15645)', async () => {
    const client = makeClient('Goal text');
    const result = await regenerateGoalForWorkflows(companyInfo, [], { vertexClient: client });
    expect(result).toEqual({ success: false, error: 'Company info and at least one workflow are required.' });
  });

  it('returns {success:false} when selectedWorkflows is missing (Code.gs:15645)', async () => {
    const client = makeClient('Goal text');
    const result = await regenerateGoalForWorkflows(companyInfo, undefined, { vertexClient: client });
    expect(result).toEqual({ success: false, error: 'Company info and at least one workflow are required.' });
  });

  it('calls generateContent without search (Code.gs:15679-15683)', async () => {
    const client = makeClient('Generated goal text.');
    await regenerateGoalForWorkflows(companyInfo, selectedWorkflows, { vertexClient: client });
    expect(client.generateContent).toHaveBeenCalledOnce();
    // No search option or search:false
    const callArgs = client.generateContent.mock.calls[0];
    const opts = callArgs[1];
    expect(opts?.search).toBeFalsy();
  });

  it('includes company name, industry, and summary in prompt (Code.gs:15655-15658)', async () => {
    const client = makeClient('Generated goal text.');
    await regenerateGoalForWorkflows(companyInfo, selectedWorkflows, { vertexClient: client });
    const [prompt] = client.generateContent.mock.calls[0];
    expect(prompt).toContain('Toyota Motor Corporation');
    expect(prompt).toContain('Manufacturing');
    expect(prompt).toContain('A global automotive manufacturer.');
  });

  it('includes selected workflow names in prompt (Code.gs:15661)', async () => {
    const client = makeClient('Generated goal text.');
    await regenerateGoalForWorkflows(companyInfo, selectedWorkflows, { vertexClient: client });
    const [prompt] = client.generateContent.mock.calls[0];
    expect(prompt).toContain('Procurement');
    expect(prompt).toContain('Demand Forecasting');
  });

  it('detects Japanese from companySummary and sets response language to 日本語 (Code.gs:15649)', async () => {
    const jpCompany = {
      companyName: 'トヨタ自動車',
      industry: '製造業',
      companySummary: 'グローバルな自動車メーカー。',
    };
    const client = makeClient('目標テキスト');
    await regenerateGoalForWorkflows(jpCompany, selectedWorkflows, { vertexClient: client });
    const [prompt] = client.generateContent.mock.calls[0];
    expect(prompt).toContain('日本語');
  });

  it('sets English for ASCII-only companySummary (Code.gs:15649)', async () => {
    const client = makeClient('Generated goal text.');
    await regenerateGoalForWorkflows(companyInfo, selectedWorkflows, { vertexClient: client });
    const [prompt] = client.generateContent.mock.calls[0];
    expect(prompt).toContain('English');
  });

  it('returns {success:true, goal: trimmed text} matching Code.gs:15695-15696', async () => {
    const client = makeClient('  Generated goal text with spaces.  ');
    const result = await regenerateGoalForWorkflows(companyInfo, selectedWorkflows, { vertexClient: client });
    expect(result).toEqual({ success: true, goal: 'Generated goal text with spaces.' });
  });

  it('returns {success:false, error:e.message} on generateContent rejection (Code.gs:15697-15700)', async () => {
    const client = { generateContent: vi.fn().mockRejectedValue(new Error('AI Error: quota exceeded')) };
    const result = await regenerateGoalForWorkflows(companyInfo, selectedWorkflows, { vertexClient: client });
    expect(result).toEqual({ success: false, error: 'AI Error: quota exceeded' });
  });
});

// ---------------------------------------------------------------------------
// optimizeGoalWithMagicWand
// ---------------------------------------------------------------------------

describe('optimizeGoalWithMagicWand', () => {
  it('calls generateContent with the rawGoal embedded in prompt (Code.gs:16419-16451)', async () => {
    const client = makeClient('# Optimized Scenario\nFull markdown output here.');
    await optimizeGoalWithMagicWand('Toyota procurement optimization', { vertexClient: client });
    expect(client.generateContent).toHaveBeenCalledOnce();
    const [prompt] = client.generateContent.mock.calls[0];
    expect(prompt).toContain('Toyota procurement optimization');
  });

  it('prompt contains CRITICAL MULTILINGUAL RULE instruction (Code.gs:16427)', async () => {
    const client = makeClient('# Title\nContent');
    await optimizeGoalWithMagicWand('some goal', { vertexClient: client });
    const [prompt] = client.generateContent.mock.calls[0];
    expect(prompt).toContain('CRITICAL MULTILINGUAL RULE');
  });

  it('prompt instructs return of raw Markdown, no code blocks (Code.gs:16451)', async () => {
    const client = makeClient('# Title\nContent');
    await optimizeGoalWithMagicWand('some goal', { vertexClient: client });
    const [prompt] = client.generateContent.mock.calls[0];
    expect(prompt).toContain('Return ONLY the raw Markdown text');
  });

  it('returns {success:true, optimizedGoal: trimmed string} on success (Code.gs:16477)', async () => {
    const client = makeClient('  # Title\n\nContent  ');
    const result = await optimizeGoalWithMagicWand('some goal', { vertexClient: client });
    expect(result).toEqual({ success: true, optimizedGoal: '# Title\n\nContent' });
  });

  it('returns {success:false, error:...} when generateContent rejects (Code.gs:16496)', async () => {
    const client = { generateContent: vi.fn().mockRejectedValue(new Error('AI Optimization API Error (HTTP 500): server error')) };
    const result = await optimizeGoalWithMagicWand('some goal', { vertexClient: client });
    expect(result.success).toBe(false);
    expect(result.error).toContain('AI Optimization API Error');
  });

  it('returns {success:false, error} with fallback message when error has no message (Code.gs:16496)', async () => {
    const client = { generateContent: vi.fn().mockRejectedValue(new Error('')) };
    const result = await optimizeGoalWithMagicWand('some goal', { vertexClient: client });
    expect(result.success).toBe(false);
  });

  it('does not call generateContent with search:true (Code.gs:16453 — no googleSearch tool)', async () => {
    const client = makeClient('# Output');
    await optimizeGoalWithMagicWand('some goal', { vertexClient: client });
    const callArgs = client.generateContent.mock.calls[0];
    const opts = callArgs[1];
    expect(opts?.search).toBeFalsy();
  });
});
