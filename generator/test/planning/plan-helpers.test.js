/**
 * plan-helpers.test.js — TDD for planning/plan-helpers.js
 *
 * Covers the 3 functions ported from Code.gs:
 *   - getDataProfile     (Code.gs:436-486)
 *   - resolvePlannedPublicDatasetId  (Code.gs:723-734)
 *   - generateBaseName   (Code.gs:1826-1855)
 *
 * ALL deps are stubbed — no network calls.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  getDataProfile,
  resolvePlannedPublicDatasetId,
  generateBaseName,
} from '../../src/planning/plan-helpers.js';

// ---------------------------------------------------------------------------
// getDataProfile (Code.gs:436-486)
// ---------------------------------------------------------------------------

describe('getDataProfile (Code.gs:436-486)', () => {
  it('returns deep profile for "deep" id', () => {
    const p = getDataProfile('deep');
    expect(p.id).toBe('deep');
    expect(p.label).toBe('Deep Analysis');
    expect(p.defaultRowCount).toBe(150);
    expect(p.txnRowTarget).toBe(120);
    expect(p.masterMinRows).toBe(8);
    expect(p.txnMinRows).toBe(50);
  });

  it('returns standard profile for "standard" id', () => {
    const p = getDataProfile('standard');
    expect(p.id).toBe('standard');
    expect(p.label).toBe('Standard');
    expect(p.defaultRowCount).toBe(100);
    expect(p.txnRowTarget).toBe(80);
    expect(p.masterMinRows).toBe(10);
    expect(p.txnMinRows).toBe(30);
  });

  it('returns wide profile for "wide" id', () => {
    const p = getDataProfile('wide');
    expect(p.id).toBe('wide');
    expect(p.label).toBe('Wide Schema');
    expect(p.defaultRowCount).toBe(50);
    expect(p.txnRowTarget).toBe(40);
    expect(p.masterMinRows).toBe(6);
    expect(p.txnMinRows).toBe(20);
  });

  it('falls back to standard for unknown profile id (source line 47)', () => {
    const p = getDataProfile('unknown');
    expect(p.id).toBe('standard');
    expect(p.defaultRowCount).toBe(100);
  });

  it('falls back to standard when called with undefined (source line 47)', () => {
    const p = getDataProfile(undefined);
    expect(p.id).toBe('standard');
  });

  it('returns strategy string for deep profile', () => {
    const p = getDataProfile('deep');
    expect(typeof p.strategy).toBe('string');
    expect(p.strategy).toContain('time-series');
  });

  it('deep profile tableCount is "3-4"', () => {
    const p = getDataProfile('deep');
    expect(p.tableCount).toBe('3-4');
    expect(p.masterRows).toBe('15-25');
    expect(p.masterCols).toBe('5-7');
    expect(p.txnRows).toBe('120+');
    expect(p.txnCols).toBe('8-12');
  });

  it('standard profile tableCount is "5"', () => {
    const p = getDataProfile('standard');
    expect(p.tableCount).toBe('5');
    expect(p.masterRows).toBe('20-30');
  });

  it('wide profile tableCount is "7-8"', () => {
    const p = getDataProfile('wide');
    expect(p.tableCount).toBe('7-8');
    expect(p.txnRows).toBe('40-50');
  });
});

// ---------------------------------------------------------------------------
// resolvePlannedPublicDatasetId (Code.gs:723-734)
// ---------------------------------------------------------------------------

describe('resolvePlannedPublicDatasetId (Code.gs:723-734)', () => {
  it('returns null when usePublicDataset is false (source line 56)', () => {
    const result = resolvePlannedPublicDatasetId('some-id', {
      usePublicDataset: false,
      publicDatasetId: 'fallback-id',
    });
    expect(result).toBeNull();
  });

  it('returns options.publicDatasetId when parsedId is empty string', () => {
    const result = resolvePlannedPublicDatasetId('', {
      usePublicDataset: true,
      publicDatasetId: 'my-dataset',
    });
    expect(result).toBe('my-dataset');
  });

  it('returns options.publicDatasetId when parsedId is same as options.publicDatasetId', () => {
    const result = resolvePlannedPublicDatasetId('my-dataset', {
      usePublicDataset: true,
      publicDatasetId: 'my-dataset',
    });
    expect(result).toBe('my-dataset');
  });

  it('returns options.publicDatasetId when parsedId is non-string (source line 57)', () => {
    const result = resolvePlannedPublicDatasetId(null, {
      usePublicDataset: true,
      publicDatasetId: 'fallback-id',
    });
    expect(result).toBe('fallback-id');
  });

  it('returns null when usePublicDataset is true but no publicDatasetId and empty parsedId (source line 63)', () => {
    const result = resolvePlannedPublicDatasetId('', {
      usePublicDataset: true,
      publicDatasetId: null,
    });
    expect(result).toBeNull();
  });

  it('resolves a different parsedId when verifiable (source lines 58-61)', () => {
    // When parsedId differs from options.publicDatasetId, verifyAndResolveTable is called.
    // Since verifyAndResolveTable is injected, we stub it to return the verified value.
    const verifyAndResolveTable = vi.fn().mockReturnValue('verified-dataset');
    const result = resolvePlannedPublicDatasetId('different-id', {
      usePublicDataset: true,
      publicDatasetId: 'original-id',
    }, { verifyAndResolveTable });
    expect(verifyAndResolveTable).toHaveBeenCalledWith('different-id');
    expect(result).toBe('verified-dataset');
  });

  it('falls back to options.publicDatasetId when verifyAndResolveTable returns falsy (source lines 61-62)', () => {
    const verifyAndResolveTable = vi.fn().mockReturnValue(null);
    const result = resolvePlannedPublicDatasetId('unverifiable-id', {
      usePublicDataset: true,
      publicDatasetId: 'fallback-id',
    }, { verifyAndResolveTable });
    expect(result).toBe('fallback-id');
  });
});

// ---------------------------------------------------------------------------
// generateBaseName (Code.gs:1826-1855)
// ---------------------------------------------------------------------------

describe('generateBaseName (Code.gs:1826-1855)', () => {
  it('calls vertexClient.generateContent with a prompt containing userGoal (source lines 71-81)', async () => {
    const vertexClient = {
      generateContent: vi.fn().mockResolvedValue('retail-inventory'),
    };
    await generateBaseName('retail inventory management', 'abc12345', { vertexClient });
    expect(vertexClient.generateContent).toHaveBeenCalledOnce();
    const [prompt] = vertexClient.generateContent.mock.calls[0];
    expect(prompt).toContain('retail inventory management');
  });

  it('prompt instructs lowercase hyphens only, max 20 chars (source lines 71-81)', async () => {
    const vertexClient = {
      generateContent: vi.fn().mockResolvedValue('bakery-sales'),
    };
    await generateBaseName('bakery sales tracking', 'abc12345', { vertexClient });
    const [prompt] = vertexClient.generateContent.mock.calls[0];
    expect(prompt).toContain('lowercase');
    expect(prompt).toContain('20 characters');
  });

  it('returns cleanName-suffix format (source line 93)', async () => {
    const vertexClient = {
      generateContent: vi.fn().mockResolvedValue('shop-sales'),
    };
    const result = await generateBaseName('shop sales tracking', 'abc12345', { vertexClient });
    // "shop-sales" = 10 chars, within 15 char limit
    expect(result).toBe('shop-sales-abc12345');
  });

  it('strips non-alphabet/non-hyphen chars from LLM response (source line 85)', async () => {
    const vertexClient = {
      generateContent: vi.fn().mockResolvedValue('retail_inventory!'),
    };
    const result = await generateBaseName('retail inventory', 'abc12345', { vertexClient });
    // underscores and ! become hyphens, then collapsed
    expect(result).toMatch(/^[a-z-]+-abc12345$/);
    expect(result).not.toContain('_');
    expect(result).not.toContain('!');
  });

  it('collapses multiple hyphens (source line 86)', async () => {
    const vertexClient = {
      generateContent: vi.fn().mockResolvedValue('retail--inventory'),
    };
    const result = await generateBaseName('retail inventory', 'abc12345', { vertexClient });
    expect(result).not.toContain('--');
  });

  it('removes leading and trailing hyphens (source line 87)', async () => {
    const vertexClient = {
      generateContent: vi.fn().mockResolvedValue('-shop-sales-'),
    };
    const result = await generateBaseName('shop sales', 'abc12345', { vertexClient });
    // "-shop-sales-" → strip leading/trailing → "shop-sales" → 10 chars
    expect(result).not.toMatch(/^-/);
    // cleanName after strip is "shop-sales", result is "shop-sales-abc12345"
    expect(result).toBe('shop-sales-abc12345');
  });

  it('truncates cleanName to 15 chars before suffix (source line 89)', async () => {
    const vertexClient = {
      generateContent: vi.fn().mockResolvedValue('very-long-business-name-here-exceeds-limit'),
    };
    const result = await generateBaseName('very long business problem', 'abc12345', { vertexClient });
    const [cleanName] = result.split('-abc12345');
    expect(cleanName.length).toBeLessThanOrEqual(15);
  });

  it('no trailing hyphen after truncation (source line 90)', async () => {
    const vertexClient = {
      generateContent: vi.fn().mockResolvedValue('very-long-busin'),
    };
    const result = await generateBaseName('very long business', 'abc12345', { vertexClient });
    // cleanName of exactly 15 chars — ending with 'n', no trailing hyphen
    const [cleanName] = result.split('-abc12345');
    expect(cleanName).not.toMatch(/-$/);
  });

  it('uses fallback "demo-env" when cleanName is too short (source line 92)', async () => {
    const vertexClient = {
      generateContent: vi.fn().mockResolvedValue('ab'),
    };
    const result = await generateBaseName('some goal', 'abc12345', { vertexClient });
    expect(result).toBe('demo-env-abc12345');
  });

  it('uses fallback "env-{suffix}" on LLM error (source lines 94-96)', async () => {
    const vertexClient = {
      generateContent: vi.fn().mockRejectedValue(new Error('LLM unavailable')),
    };
    const result = await generateBaseName('retail inventory', 'abc12345', { vertexClient });
    expect(result).toBe('env-abc12345');
  });

  it('result is lowercase (source line 85)', async () => {
    const vertexClient = {
      generateContent: vi.fn().mockResolvedValue('RETAIL-INVENTORY'),
    };
    const result = await generateBaseName('retail inventory', 'abc12345', { vertexClient });
    expect(result).toBe(result.toLowerCase());
  });
});
