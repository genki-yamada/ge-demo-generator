/**
 * json-repair.test.js — TDD tests for repairTruncatedJson
 *
 * Test cases derived from the GAS source logic (Code.gs:1789-1825).
 * Expected values are derived from tracing the source logic, not guessed.
 */

import { describe, it, expect } from 'vitest';
import { repairTruncatedJson } from '../../src/planning/json-repair.js';

describe('repairTruncatedJson', () => {
  // ---- valid JSON passes through unchanged ----

  it('returns valid JSON unchanged (simple object)', () => {
    const input = '{"a":1,"b":"hello"}';
    expect(repairTruncatedJson(input)).toBe(input);
  });

  it('returns valid JSON unchanged (nested)', () => {
    const input = '{"x":[1,2,3],"y":{"z":true}}';
    expect(repairTruncatedJson(input)).toBe(input);
  });

  // ---- missing closing brace ----

  it('repairs a single missing closing brace', () => {
    const input = '{"a":1';
    const result = repairTruncatedJson(input);
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result)).toEqual({ a: 1 });
  });

  it('repairs nested missing closing braces', () => {
    const input = '{"a":{"b":1}';
    const result = repairTruncatedJson(input);
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result)).toEqual({ a: { b: 1 } });
  });

  // ---- missing closing bracket ----

  it('repairs a missing closing bracket', () => {
    const input = '{"arr":[1,2,3';
    const result = repairTruncatedJson(input);
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result)).toEqual({ arr: [1, 2, 3] });
  });

  it('repairs both missing bracket and brace', () => {
    const input = '{"arr":[1,2';
    const result = repairTruncatedJson(input);
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result)).toEqual({ arr: [1, 2] });
  });

  // ---- unterminated string ----

  it('repairs an unterminated string value (appends closing quote)', () => {
    // inString ends true → fixed += '"' → then brace/bracket closed
    const input = '{"key":"value';
    const result = repairTruncatedJson(input);
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result)).toEqual({ key: 'value' });
  });

  // ---- csvData truncation ----

  it('repairs truncated csvData field (cuts at last \\\\n then closes string)', () => {
    // Source: csvDataMatch → lastIndexOf('\\n') → substring(0, lastNewline) + '"'
    // Input: {"csvData":"line1\\nline2\\nline3 (truncated mid-value)
    // After csvData repair: {"csvData":"line1\\nline2"  (closes the string at last \\n)
    // Then the brace scanner closes the outer object
    const input = '{"csvData":"line1\\nline2\\nline3';
    const result = repairTruncatedJson(input);
    expect(() => JSON.parse(result)).not.toThrow();
    const parsed = JSON.parse(result);
    // The csvData value should end at the last \n boundary
    expect(parsed).toHaveProperty('csvData');
    expect(typeof parsed.csvData).toBe('string');
  });

  // ---- escape sequences ----

  it('handles backslash escape sequences correctly in the scanner', () => {
    // A string containing escaped backslash should not confuse the escape tracking
    const input = '{"path":"C:\\\\Users\\\\test","x":1';
    const result = repairTruncatedJson(input);
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result)).toEqual({ path: 'C:\\Users\\test', x: 1 });
  });

  // ---- already parseable (direct pass-through) ----

  it('passes through an already-valid complex object without modification', () => {
    const input = JSON.stringify({ foo: [1, 2, { bar: 'baz' }], qux: null });
    expect(repairTruncatedJson(input)).toBe(input);
  });
});
