/**
 * technical-instruction.test.js — TDD tests for getTechnicalInstruction
 *
 * Verifies:
 *   1. Returns a string
 *   2. Deterministic (same output on two calls)
 *   3. Contains verbatim section headings / fixed strings from the GAS source
 */

import { describe, it, expect } from 'vitest';
import { getTechnicalInstruction } from '../../src/planning/technical-instruction.js';

describe('getTechnicalInstruction', () => {
  it('returns a string', () => {
    expect(typeof getTechnicalInstruction()).toBe('string');
  });

  it('is deterministic (same output on two calls)', () => {
    expect(getTechnicalInstruction()).toBe(getTechnicalInstruction());
  });

  it('contains the MOST IMPORTANT RULE section heading', () => {
    expect(getTechnicalInstruction()).toContain(
      '=== MOST IMPORTANT RULE: OUTPUT PLACEMENT ==='
    );
  });

  it('contains the OUTPUT PLACEMENT rule #9 text', () => {
    expect(getTechnicalInstruction()).toContain(
      '9. **OUTPUT PLACEMENT (HIGHEST PRIORITY — RULE #0)**'
    );
  });

  it('contains A2UI INTERACTIVE UI PATTERNS section', () => {
    expect(getTechnicalInstruction()).toContain(
      '10. **A2UI INTERACTIVE UI PATTERNS (MANDATORY — NEVER SKIP)**'
    );
  });

  it('contains SUGGESTION CHIPS section', () => {
    expect(getTechnicalInstruction()).toContain(
      '11. **SUGGESTION CHIPS (CRITICAL)**'
    );
  });

  it('contains WELCOME CARD section', () => {
    expect(getTechnicalInstruction()).toContain(
      '12. **WELCOME CARD (FIRST INTERACTION)**'
    );
  });

  it('contains VERTICAL SPACING / SPACER HACK section', () => {
    expect(getTechnicalInstruction()).toContain(
      '13. **VERTICAL SPACING / SPACER HACK (CRITICAL)**'
    );
  });

  it('contains the backtick variable constructed from String.fromCharCode(96)', () => {
    // The source uses: const bt = String.fromCharCode(96).repeat(3);
    // and then uses bt in string interpolation for ` + bt + `python ... ` + bt + `
    // The resulting string should contain ```python
    expect(getTechnicalInstruction()).toContain('```python');
  });

  it('contains the CONFIRMATION WORKFLOW section', () => {
    expect(getTechnicalInstruction()).toContain(
      '8. **CONFIRMATION WORKFLOW (CRITICAL)**'
    );
  });

  it('starts with Technical instructions header', () => {
    expect(getTechnicalInstruction()).toContain(
      'Technical instructions for the agent regarding tool usage and system behavior.'
    );
  });
});
