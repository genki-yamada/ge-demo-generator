import { describe, it, expect } from 'vitest';
import { bashEscape, escapeForSystemInstruction } from '../../src/codegen/bash-escape.js';

describe('bashEscape', () => {
  it("escapes single quote in \"it's\"", () => {
    expect(bashEscape("it's")).toBe("it'\\''s");
  });

  it('returns plain string unchanged', () => {
    expect(bashEscape("hello")).toBe("hello");
  });

  it('returns empty string for empty input', () => {
    expect(bashEscape("")).toBe("");
  });

  it('returns empty string for null (falsy)', () => {
    expect(bashEscape(null)).toBe("");
  });

  it('escapes multiple single quotes', () => {
    expect(bashEscape("a'b'c")).toBe("a'\\''b'\\''c");
  });
});

describe('escapeForSystemInstruction', () => {
  it('handles backslash, single quote, braces, and newline', () => {
    expect(escapeForSystemInstruction("a\\b'c{d}e\nf")).toBe("a\\\\\\\\b'\\''c{{d}}e\\nf");
  });

  it('escapes backslash in x\\y', () => {
    expect(escapeForSystemInstruction("x\\y")).toBe("x\\\\\\\\y");
  });

  it('escapes curly braces in {a}', () => {
    expect(escapeForSystemInstruction("{a}")).toBe("{{a}}");
  });

  it('escapes newline', () => {
    expect(escapeForSystemInstruction("line1\nline2")).toBe("line1\\nline2");
  });

  it("escapes single quote in \"it's\"", () => {
    expect(escapeForSystemInstruction("it's")).toBe("it'\\''s");
  });
});
