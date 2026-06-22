/**
 * taxonomy.test.js — TDD tests for planning/taxonomy.js
 *
 * Tests three exports ported from Code.gs:
 *   - TAXONOMY                    Code.gs:95-112
 *   - callTaxonomyModel_          Code.gs:15906-15977
 *   - classifyDemoTaxonomy_       Code.gs:15849-15892
 *
 * vertexClient is stubbed — no real network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TAXONOMY,
  callTaxonomyModel_,
  classifyDemoTaxonomy_,
} from '../../src/planning/taxonomy.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(textOrFn) {
  return {
    generateContent:
      typeof textOrFn === 'function'
        ? vi.fn(textOrFn)
        : vi.fn().mockResolvedValue(textOrFn),
  };
}

// A canned taxonomy response matching Code.gs parse path:
//   JSON.parse(candidates[0].content.parts[0].text)
function makeVertexResponse(obj) {
  // callTaxonomyModel_ calls vertexClient.generateContent which returns parsed text.
  // The model returns a JSON string in the text part; vertex.js returns that text string.
  // callTaxonomyModel_ then does JSON.parse on the returned string.
  return JSON.stringify(obj);
}

// ---------------------------------------------------------------------------
// TAXONOMY constant (Code.gs:95-112)
// ---------------------------------------------------------------------------

describe('TAXONOMY', () => {
  it('exports TAXONOMY with industry, persona, useCase arrays', () => {
    expect(TAXONOMY).toHaveProperty('industry');
    expect(TAXONOMY).toHaveProperty('persona');
    expect(TAXONOMY).toHaveProperty('useCase');
    expect(Array.isArray(TAXONOMY.industry)).toBe(true);
    expect(Array.isArray(TAXONOMY.persona)).toBe(true);
    expect(Array.isArray(TAXONOMY.useCase)).toBe(true);
  });

  it('TAXONOMY.industry contains "Other" (Code.gs:100)', () => {
    expect(TAXONOMY.industry).toContain('Other');
  });

  it('TAXONOMY.persona contains "Other" (Code.gs:105)', () => {
    expect(TAXONOMY.persona).toContain('Other');
  });

  it('TAXONOMY.useCase contains "Other" (Code.gs:110)', () => {
    expect(TAXONOMY.useCase).toContain('Other');
  });

  it('TAXONOMY.industry has the exact 15 values from Code.gs:96-101', () => {
    expect(TAXONOMY.industry).toEqual([
      'Retail', 'Finance', 'Healthcare', 'Manufacturing', 'Public Sector',
      'Media & Entertainment', 'Technology', 'Logistics & Supply Chain',
      'Energy & Utilities', 'Telecom', 'Education', 'Travel & Hospitality',
      'Automotive', 'Legal & Professional Services', 'Other',
    ]);
  });

  it('TAXONOMY.persona has the exact 13 values from Code.gs:102-106', () => {
    expect(TAXONOMY.persona).toEqual([
      'Sales', 'Marketing', 'Operations', 'Finance', 'Customer Service',
      'Product', 'HR', 'IT / Engineering', 'Executive', 'Supply Chain',
      'Legal & Compliance', 'R&D / Research', 'Other',
    ]);
  });

  it('TAXONOMY.useCase has the exact 10 values from Code.gs:107-111', () => {
    expect(TAXONOMY.useCase).toEqual([
      'Analytics & Insights', 'Process Automation', 'Customer Engagement',
      'Forecasting & Planning', 'Document Processing', 'Knowledge Retrieval',
      'Risk & Anomaly Detection', 'Optimization', 'Compliance & Audit', 'Other',
    ]);
  });
});

// ---------------------------------------------------------------------------
// callTaxonomyModel_ (Code.gs:15906-15977)
// ---------------------------------------------------------------------------

describe('callTaxonomyModel_', () => {
  const allowed = {
    industry: TAXONOMY.industry,
    persona: TAXONOMY.persona,
    useCase: TAXONOMY.useCase,
  };

  it('calls generateContent with model="gemini-3.1-flash-lite" (Code.gs:15909)', async () => {
    const response = makeVertexResponse({ industry: 'Finance', persona: 'Sales', useCase: 'Analytics & Insights' });
    const client = makeClient(response);
    await callTaxonomyModel_('goal', 'summary', 'biz', allowed, { vertexClient: client });
    expect(client.generateContent).toHaveBeenCalledOnce();
    const [, opts] = client.generateContent.mock.calls[0];
    expect(opts).toMatchObject({ model: 'gemini-3.1-flash-lite' });
  });

  it('does NOT pass search:true — no grounding (Code.gs:15909 uses plain generateContent)', async () => {
    const response = makeVertexResponse({ industry: 'Finance', persona: 'Sales', useCase: 'Analytics & Insights' });
    const client = makeClient(response);
    await callTaxonomyModel_('goal', 'summary', 'biz', allowed, { vertexClient: client });
    const [, opts] = client.generateContent.mock.calls[0];
    expect(opts?.search).toBeFalsy();
  });

  it('passes generationConfig with temperature:0.1 and responseMimeType (Code.gs:15958-15962)', async () => {
    const response = makeVertexResponse({ industry: 'Finance', persona: 'Sales', useCase: 'Analytics & Insights' });
    const client = makeClient(response);
    await callTaxonomyModel_('goal', 'summary', 'biz', allowed, { vertexClient: client });
    const [, opts] = client.generateContent.mock.calls[0];
    expect(opts.generationConfig).toMatchObject({
      temperature: 0.1,
      responseMimeType: 'application/json',
    });
  });

  it('includes userGoal in prompt (Code.gs:15945)', async () => {
    const response = makeVertexResponse({ industry: 'Finance', persona: 'Sales', useCase: 'Analytics & Insights' });
    const client = makeClient(response);
    await callTaxonomyModel_('MY_SPECIAL_GOAL', 'summary', 'biz', allowed, { vertexClient: client });
    const [prompt] = client.generateContent.mock.calls[0];
    expect(prompt).toContain('MY_SPECIAL_GOAL');
  });

  it('includes aiSummary in prompt (Code.gs:15946)', async () => {
    const response = makeVertexResponse({ industry: 'Finance', persona: 'Sales', useCase: 'Analytics & Insights' });
    const client = makeClient(response);
    await callTaxonomyModel_('goal', 'MY_UNIQUE_SUMMARY', 'biz', allowed, { vertexClient: client });
    const [prompt] = client.generateContent.mock.calls[0];
    expect(prompt).toContain('MY_UNIQUE_SUMMARY');
  });

  it('includes businessInstruction truncated to 1500 chars in prompt (Code.gs:15947)', async () => {
    const response = makeVertexResponse({ industry: 'Finance', persona: 'Sales', useCase: 'Analytics & Insights' });
    const client = makeClient(response);
    const longBiz = 'X'.repeat(2000);
    await callTaxonomyModel_('goal', 'summary', longBiz, allowed, { vertexClient: client });
    const [prompt] = client.generateContent.mock.calls[0];
    expect(prompt).toContain('X'.repeat(1500));
    expect(prompt).not.toContain('X'.repeat(1501));
  });

  it('omits Business context line when businessInstruction is falsy (Code.gs:15947)', async () => {
    const response = makeVertexResponse({ industry: 'Finance', persona: 'Sales', useCase: 'Analytics & Insights' });
    const client = makeClient(response);
    await callTaxonomyModel_('goal', 'summary', '', allowed, { vertexClient: client });
    const [prompt] = client.generateContent.mock.calls[0];
    expect(prompt).not.toContain('Business context:');
  });

  it('includes allowed values in prompt (Code.gs:15923-15925)', async () => {
    const response = makeVertexResponse({ industry: 'Finance', persona: 'Sales', useCase: 'Analytics & Insights' });
    const client = makeClient(response);
    await callTaxonomyModel_('goal', 'summary', '', allowed, { vertexClient: client });
    const [prompt] = client.generateContent.mock.calls[0];
    expect(prompt).toContain('Finance');
    expect(prompt).toContain('Retail');
  });

  it('parses and returns JSON object from model response (Code.gs:15974-15975)', async () => {
    const expected = { industry: 'Technology', persona: 'IT / Engineering', useCase: 'Process Automation' };
    const response = makeVertexResponse(expected);
    const client = makeClient(response);
    const result = await callTaxonomyModel_('goal', 'summary', 'biz', allowed, { vertexClient: client });
    expect(result).toEqual(expected);
  });

  it('throws "Taxonomy AI Error: ..." when vertexClient throws with that prefix (Code.gs:15973)', async () => {
    const client = { generateContent: vi.fn().mockRejectedValue(new Error('Taxonomy AI Error: HTTP 500')) };
    await expect(
      callTaxonomyModel_('goal', 'summary', 'biz', allowed, { vertexClient: client })
    ).rejects.toThrow('Taxonomy AI Error:');
  });

  it('only requests fields present in allowed (subset: industry only)', async () => {
    const subAllowed = { industry: TAXONOMY.industry };
    const response = makeVertexResponse({ industry: 'Healthcare' });
    const client = makeClient(response);
    const result = await callTaxonomyModel_('goal', 'summary', '', subAllowed, { vertexClient: client });
    expect(result).toEqual({ industry: 'Healthcare' });
    const [prompt] = client.generateContent.mock.calls[0];
    // Should NOT mention PERSONA or USE CASE
    expect(prompt).not.toContain('PERSONA');
    expect(prompt).not.toContain('USE CASE');
  });

  it('includes *Other field in responseSchema when "Other" is in allowed (Code.gs:15952-15953)', async () => {
    const subAllowed = { industry: TAXONOMY.industry }; // includes 'Other'
    const response = makeVertexResponse({ industry: 'Other', industryOther: 'AgriTech' });
    const client = makeClient(response);
    const result = await callTaxonomyModel_('goal', 'summary', '', subAllowed, { vertexClient: client });
    expect(result.industryOther).toBe('AgriTech');
  });

  it('does NOT include *Other field in responseSchema when "Other" is NOT in allowed (Code.gs:15952-15953)', async () => {
    // force-allowed: Other removed
    const subAllowed = { industry: TAXONOMY.industry.filter((v) => v !== 'Other') };
    const response = makeVertexResponse({ industry: 'Healthcare' });
    const client = makeClient(response);
    const [, opts] = (await (async () => {
      await callTaxonomyModel_('goal', 'summary', '', subAllowed, { vertexClient: client });
      return client.generateContent.mock.calls[0];
    })());
    // responseSchema.properties should NOT have industryOther
    const schema = opts.generationConfig.responseSchema;
    expect(schema.properties).not.toHaveProperty('industryOther');
  });

  it('uses "Other is NOT permitted" rule when Other not in allowed (Code.gs:15929)', async () => {
    const subAllowed = { industry: TAXONOMY.industry.filter((v) => v !== 'Other') };
    const response = makeVertexResponse({ industry: 'Healthcare' });
    const client = makeClient(response);
    await callTaxonomyModel_('goal', 'summary', '', subAllowed, { vertexClient: client });
    const [prompt] = client.generateContent.mock.calls[0];
    expect(prompt).toContain('"Other" is NOT permitted');
  });

  it('uses "Use Other ONLY when none" rule when Other is in allowed (Code.gs:15927-15928)', async () => {
    const response = makeVertexResponse({ industry: 'Finance', persona: 'Sales', useCase: 'Analytics & Insights' });
    const client = makeClient(response);
    await callTaxonomyModel_('goal', 'summary', '', allowed, { vertexClient: client });
    const [prompt] = client.generateContent.mock.calls[0];
    expect(prompt).toContain('Use "Other" ONLY when none of the allowed values');
  });
});

// ---------------------------------------------------------------------------
// classifyDemoTaxonomy_ (Code.gs:15849-15892)
// ---------------------------------------------------------------------------

describe('classifyDemoTaxonomy_', () => {
  it('returns classification when first call returns valid enum values (Code.gs:15857-15861)', async () => {
    const firstResult = makeVertexResponse({
      industry: 'Finance',
      persona: 'Sales',
      useCase: 'Analytics & Insights',
    });
    const client = makeClient(firstResult);
    const result = await classifyDemoTaxonomy_('user goal', 'ai summary', 'biz', { vertexClient: client });
    expect(result).toEqual({
      industry: 'Finance',
      persona: 'Sales',
      useCase: 'Analytics & Insights',
      industryOther: '',
      personaOther: '',
      useCaseOther: '',
    });
  });

  it('calls vertexClient only once when no field is "Other" (Code.gs:15872)', async () => {
    const firstResult = makeVertexResponse({
      industry: 'Technology',
      persona: 'IT / Engineering',
      useCase: 'Process Automation',
    });
    const client = makeClient(firstResult);
    await classifyDemoTaxonomy_('goal', 'summary', '', { vertexClient: client });
    expect(client.generateContent).toHaveBeenCalledTimes(1);
  });

  it('triggers force-allowed second call when first call returns "Other" for industry (Code.gs:15863-15877)', async () => {
    let callCount = 0;
    const client = makeClient(() => {
      callCount++;
      if (callCount === 1) {
        // First call: industry=Other
        return Promise.resolve(makeVertexResponse({
          industry: 'Other',
          industryOther: 'AgriTech',
          persona: 'Sales',
          useCase: 'Analytics & Insights',
        }));
      } else {
        // Second call (force-allowed): industry forced to a specific value
        return Promise.resolve(makeVertexResponse({ industry: 'Technology' }));
      }
    });
    const result = await classifyDemoTaxonomy_('goal', 'summary', '', { vertexClient: client });
    // Two calls: first pass + force-allowed pass for industry
    expect(client.generateContent).toHaveBeenCalledTimes(2);
    // Forced value replaces 'Other'
    expect(result.industry).toBe('Technology');
  });

  it('force-allowed second call omits "Other" from allowed values (Code.gs:15868)', async () => {
    let callCount = 0;
    const client = makeClient(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(makeVertexResponse({
          industry: 'Other',
          industryOther: 'AgriTech',
          persona: 'Sales',
          useCase: 'Analytics & Insights',
        }));
      } else {
        return Promise.resolve(makeVertexResponse({ industry: 'Technology' }));
      }
    });
    await classifyDemoTaxonomy_('goal', 'summary', '', { vertexClient: client });
    // Second call prompt should NOT contain 'Other' in the allowed list for industry
    const secondPrompt = client.generateContent.mock.calls[1][0];
    // The allowed values for industry in second call exclude 'Other'
    // so 'Other' should not appear in the enum list in that prompt
    expect(secondPrompt).not.toMatch(/Retail.*Other/s);
    // Should contain "Other is NOT permitted" since Other was removed
    expect(secondPrompt).toContain('"Other" is NOT permitted');
  });

  it('keeps "Other" result when force-allowed second call also returns "Other" (Code.gs:15874-15876)', async () => {
    // forced[k] === 'Other' → do NOT override (Code.gs:15875: if forced[k] && forced[k] !== 'Other')
    let callCount = 0;
    const client = makeClient(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(makeVertexResponse({
          industry: 'Other',
          industryOther: 'AgriTech',
          persona: 'Sales',
          useCase: 'Analytics & Insights',
        }));
      } else {
        // Force-allowed should not return Other (Other removed), but if it somehow does,
        // Code.gs:15875 guard prevents override. Simulate by returning undefined.
        return Promise.resolve(makeVertexResponse({ industry: 'Other' }));
      }
    });
    const result = await classifyDemoTaxonomy_('goal', 'summary', '', { vertexClient: client });
    // first[k] remains 'Other' since forced[k] === 'Other'
    expect(result.industry).toBe('Other');
    expect(result.industryOther).toBe('AgriTech');
  });

  it('populates *Other fields only when value is "Other" (Code.gs:15884-15886)', async () => {
    const firstResult = makeVertexResponse({
      industry: 'Other',
      industryOther: 'AgriTech',
      persona: 'Sales',
      personaOther: 'should_be_cleared',
      useCase: 'Analytics & Insights',
      useCaseOther: 'should_be_cleared',
    });
    // Make force-allowed call still return Other (so Other stays, industryOther kept)
    const client = makeClient(() =>
      Promise.resolve(makeVertexResponse({
        industry: 'Other',
        industryOther: 'AgriTech',
        persona: 'Sales',
        useCase: 'Analytics & Insights',
      }))
    );
    const result = await classifyDemoTaxonomy_('goal', 'summary', '', { vertexClient: client });
    expect(result.industryOther).toBe('AgriTech');
    // persona is NOT 'Other', so personaOther must be empty
    expect(result.personaOther).toBe('');
    // useCase is NOT 'Other', so useCaseOther must be empty
    expect(result.useCaseOther).toBe('');
  });

  it('returns all-Other fallback when vertexClient throws (Code.gs:15888-15891)', async () => {
    const client = {
      generateContent: vi.fn().mockRejectedValue(new Error('network failure')),
    };
    const result = await classifyDemoTaxonomy_('goal', 'summary', 'biz', { vertexClient: client });
    expect(result).toEqual({
      industry: 'Other',
      persona: 'Other',
      useCase: 'Other',
      industryOther: '',
      personaOther: '',
      useCaseOther: '',
    });
  });

  it('defaults missing fields to "Other" in return shape (Code.gs:15880-15882)', async () => {
    // If model returns empty/partial object
    const firstResult = makeVertexResponse({});
    const client = makeClient(firstResult);
    // Force-allowed will be called for all 3 fields; returns empty again
    const result = await classifyDemoTaxonomy_('goal', 'summary', '', { vertexClient: client });
    expect(result.industry).toBe('Other');
    expect(result.persona).toBe('Other');
    expect(result.useCase).toBe('Other');
  });

  it('returns full shape {industry,persona,useCase,industryOther,personaOther,useCaseOther} (Code.gs:15879-15887)', async () => {
    const firstResult = makeVertexResponse({
      industry: 'Retail',
      persona: 'Marketing',
      useCase: 'Customer Engagement',
    });
    const client = makeClient(firstResult);
    const result = await classifyDemoTaxonomy_('goal', 'summary', 'biz', { vertexClient: client });
    expect(Object.keys(result).sort()).toEqual([
      'industry', 'industryOther', 'persona', 'personaOther', 'useCase', 'useCaseOther',
    ]);
  });

  it('force-allowed pass only re-runs "Other" fields, not all fields (Code.gs:15865-15870)', async () => {
    let callCount = 0;
    const client = makeClient(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(makeVertexResponse({
          industry: 'Finance',          // not Other
          persona: 'Other',             // Other → force-allowed
          useCase: 'Analytics & Insights', // not Other
        }));
      } else {
        return Promise.resolve(makeVertexResponse({ persona: 'Sales' }));
      }
    });
    await classifyDemoTaxonomy_('goal', 'summary', '', { vertexClient: client });
    // Second call prompt should mention PERSONA but NOT INDUSTRY or USE CASE
    const secondPrompt = client.generateContent.mock.calls[1][0];
    expect(secondPrompt).toContain('PERSONA');
    expect(secondPrompt).not.toContain('INDUSTRY');
    expect(secondPrompt).not.toContain('USE CASE');
  });
});
