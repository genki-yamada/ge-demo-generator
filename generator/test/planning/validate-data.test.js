/**
 * validate-data.test.js — TDD for planning/validate-data.js
 *
 * Covers validateGeneratedData ported from Code.gs:1458-1609.
 * Uses getDataProfile (from plan-helpers) internally.
 * ALL tests are synchronous/no-network.
 */
import { describe, it, expect, vi } from 'vitest';
import { validateGeneratedData, validateAndRepairValue, parseCSVLine } from '../../src/planning/validate-data.js';

// ---------------------------------------------------------------------------
// Helpers to build planResult fixtures
// ---------------------------------------------------------------------------

function makeTable({ tableName = 'orders', schema, csvData } = {}) {
  return { tableName, schema, csvData };
}

function makePlanResult(tables) {
  return { tables };
}

// Simple valid plan result: one table, 3 INTEGER cols, header + 5 data rows
const SIMPLE_SCHEMA = [
  { name: 'id', type: 'INTEGER', description: 'Row id' },
  { name: 'amount', type: 'INTEGER', description: 'Amount' },
  { name: 'qty', type: 'INTEGER', description: 'Qty' },
];

function makeIntCsv(rows = 5) {
  const header = 'id,amount,qty';
  const dataRows = Array.from({ length: rows }, (_, i) => `${i + 1},${(i + 1) * 100},${i + 2}`);
  return [header, ...dataRows].join('\n');
}

// STRING-typed table (gets quoted in output)
const STRING_SCHEMA = [
  { name: 'name', type: 'STRING', description: 'Name' },
  { name: 'category', type: 'STRING', description: 'Category' },
];

function makeStringCsv(rows = 12) {
  const header = 'name,category';
  const dataRows = Array.from({ length: rows }, (_, i) => `item${i + 1},cat${i % 3}`);
  return [header, ...dataRows].join('\n');
}

// Table with DATE column → classified as transaction
const TXN_SCHEMA = [
  { name: 'event_date', type: 'DATE', description: 'Event date' },
  { name: 'value', type: 'FLOAT', description: 'Value' },
  { name: 'note', type: 'STRING', description: 'Note' },
];

function makeTxnCsv(rows = 35) {
  const header = 'event_date,value,note';
  const dataRows = Array.from({ length: rows }, (_, i) =>
    `2025-01-${String((i % 28) + 1).padStart(2, '0')},${(i + 1) * 1.5},note${i}`
  );
  return [header, ...dataRows].join('\n');
}

// ---------------------------------------------------------------------------
// (a) Throws when no tables
// ---------------------------------------------------------------------------

describe('throws when no tables (source line 103-105)', () => {
  it('throws "No table definitions generated" when tables is empty array', () => {
    const planResult = makePlanResult([]);
    expect(() => validateGeneratedData(planResult, 100)).toThrow('No table definitions generated');
  });

  it('throws "No table definitions generated" when tables is missing', () => {
    expect(() => validateGeneratedData({}, 100)).toThrow('No table definitions generated');
  });
});

// ---------------------------------------------------------------------------
// (b) Throws when table has no schema or no csvData
// ---------------------------------------------------------------------------

describe('throws on incomplete table data (source line 108)', () => {
  it('throws when table missing schema', () => {
    const planResult = makePlanResult([
      { tableName: 'orders', csvData: makeIntCsv() },
    ]);
    expect(() => validateGeneratedData(planResult, 100)).toThrow('Incomplete table data for "orders"');
  });

  it('throws when table missing csvData', () => {
    const planResult = makePlanResult([
      { tableName: 'orders', schema: SIMPLE_SCHEMA },
    ]);
    expect(() => validateGeneratedData(planResult, 100)).toThrow('Incomplete table data for "orders"');
  });
});

// ---------------------------------------------------------------------------
// (c) Passes (does not throw) for valid planResult
// ---------------------------------------------------------------------------

describe('passes for valid planResult (integer columns)', () => {
  it('does not throw for a valid integer-column table', () => {
    const planResult = makePlanResult([
      makeTable({ schema: SIMPLE_SCHEMA, csvData: makeIntCsv(15) }),
    ]);
    expect(() => validateGeneratedData(planResult, 100)).not.toThrow();
  });

  it('does not throw for a valid string-column table with enough rows', () => {
    const planResult = makePlanResult([
      makeTable({ tableName: 'products', schema: STRING_SCHEMA, csvData: makeStringCsv(15) }),
    ]);
    expect(() => validateGeneratedData(planResult, 100)).not.toThrow();
  });

  it('does not throw for transaction table with DATE column', () => {
    const planResult = makePlanResult([
      makeTable({ tableName: 'events', schema: TXN_SCHEMA, csvData: makeTxnCsv(35) }),
    ]);
    expect(() => validateGeneratedData(planResult, 100)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// (d) csvData is modified in-place — string values get quoted
// ---------------------------------------------------------------------------

describe('string values get double-quoted in output (source lines 198-233)', () => {
  it('STRING column values are wrapped in double quotes', () => {
    const table = makeTable({ schema: STRING_SCHEMA, csvData: makeStringCsv(12) });
    const planResult = makePlanResult([table]);
    validateGeneratedData(planResult, 100);
    const lines = table.csvData.split('\n');
    // Header line: STRING columns get quoted
    const headerLine = lines[0];
    expect(headerLine).toContain('"name"');
    expect(headerLine).toContain('"category"');
  });

  it('INTEGER column values are NOT quoted', () => {
    const table = makeTable({ schema: SIMPLE_SCHEMA, csvData: makeIntCsv(15) });
    const planResult = makePlanResult([table]);
    validateGeneratedData(planResult, 100);
    const lines = table.csvData.split('\n');
    // Data rows: integers should be unquoted
    const dataLine = lines[1];
    expect(dataLine).not.toContain('"');
  });
});

// ---------------------------------------------------------------------------
// (e) Schema repair when CSV columns != schema columns (source lines 118-138)
// ---------------------------------------------------------------------------

describe('schema repair on CSV/schema column count mismatch (source lines 118-138)', () => {
  it('repairs schema to match CSV header when counts differ', () => {
    // CSV has 4 columns but schema has 3
    const schema = [
      { name: 'id', type: 'INTEGER' },
      { name: 'name', type: 'STRING' },
      { name: 'amount', type: 'INTEGER' },
    ];
    const csvData = [
      'id,name,amount,extra',
      '1,foo,100,extra_val',
      '2,bar,200,other_val',
    ].join('\n');
    const table = makeTable({ schema, csvData });
    const planResult = makePlanResult([table]);
    validateGeneratedData(planResult, 100);
    // schema should now have 4 columns
    expect(table.schema).toHaveLength(4);
    expect(table.schema[3].name).toBe('extra');
    expect(table.schema[3].type).toBe('STRING'); // default for unknown
  });

  it('uses existing schema type when header name matches (case-insensitive)', () => {
    // CSV has 2 cols, schema has 2 but different case
    const schema = [
      { name: 'ID', type: 'INTEGER' },
      { name: 'Amount', type: 'FLOAT' },
    ];
    const csvData = 'id,amount\n1,10.5\n2,20.0\n3,30.1\n4,40.0\n5,50.0\n6,60.0\n7,70.0\n8,80.0\n9,90.0\n10,100.0\n11,110.0';
    const table = makeTable({ schema, csvData });
    const planResult = makePlanResult([table]);
    validateGeneratedData(planResult, 100);
    // schema should be rebuilt but types preserved from original schema
    expect(table.schema[0].type).toBe('INTEGER');
    expect(table.schema[1].type).toBe('FLOAT');
  });
});

// ---------------------------------------------------------------------------
// (f) Per-row column count repair — padding and truncation (source lines 161-176)
// ---------------------------------------------------------------------------

describe('per-row column count repair (source lines 161-176)', () => {
  it('pads rows with too few columns', () => {
    const schema = [
      { name: 'a', type: 'INTEGER' },
      { name: 'b', type: 'INTEGER' },
      { name: 'c', type: 'INTEGER' },
    ];
    // Row 2 has only 2 values — should be padded
    const csvData = 'a,b,c\n1,2,3\n4,5\n6,7,8\n9,10,11\n12,13,14\n15,16,17';
    const table = makeTable({ schema, csvData });
    const planResult = makePlanResult([table]);
    validateGeneratedData(planResult, 100);
    const lines = table.csvData.split('\n');
    // All data rows should have 3 values (unquoted integers)
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      expect(parts).toHaveLength(3);
    }
  });

  it('truncates rows with too many columns', () => {
    const schema = [
      { name: 'a', type: 'INTEGER' },
      { name: 'b', type: 'INTEGER' },
    ];
    // Row 2 has 3 values — should be truncated to 2
    const csvData = 'a,b\n1,2\n3,4,5\n6,7\n8,9\n10,11\n12,13';
    const table = makeTable({ schema, csvData });
    const planResult = makePlanResult([table]);
    validateGeneratedData(planResult, 100);
    const lines = table.csvData.split('\n');
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      expect(parts).toHaveLength(2);
    }
  });
});

// ---------------------------------------------------------------------------
// (g) maxRows (targetRows) warning — does NOT truncate rows, just warns
// ---------------------------------------------------------------------------

describe('targetRows: warns but does not remove rows when under target (source lines 191-194)', () => {
  it('does not remove rows when count is below targetRows', () => {
    // 5 data rows, target 100 — should still have 5 rows
    const table = makeTable({ schema: SIMPLE_SCHEMA, csvData: makeIntCsv(5) });
    const planResult = makePlanResult([table]);
    validateGeneratedData(planResult, 100);
    const lines = table.csvData.split('\n');
    expect(lines.length).toBe(6); // 1 header + 5 data
  });

  it('preserves all rows even when count exceeds targetRows', () => {
    // 20 data rows, target 10 — rows are NOT trimmed (targetRows is just a warning threshold)
    const table = makeTable({ schema: SIMPLE_SCHEMA, csvData: makeIntCsv(20) });
    const planResult = makePlanResult([table]);
    validateGeneratedData(planResult, 10);
    const lines = table.csvData.split('\n');
    // Rows preserved — validate does not truncate
    expect(lines.length).toBe(21); // 1 header + 20 data
  });
});

// ---------------------------------------------------------------------------
// (h) Profile selection via third argument (source line 102)
// ---------------------------------------------------------------------------

describe('profile selection (source line 102)', () => {
  it('uses standard profile by default (no dataProfileId given)', () => {
    // standard: masterMinRows=10. Table without timestamp and <=8 cols = master.
    // 5 rows is fewer than 10 — should warn (doesn't throw).
    const table = makeTable({ schema: SIMPLE_SCHEMA, csvData: makeIntCsv(5) });
    const planResult = makePlanResult([table]);
    // Should not throw — just warns
    expect(() => validateGeneratedData(planResult, 100)).not.toThrow();
  });

  it('uses "deep" profile when dataProfileId is "deep"', () => {
    // deep: masterMinRows=8. Table without timestamp and <=8 cols = master.
    // 5 rows < 8 — warns only.
    const table = makeTable({ schema: SIMPLE_SCHEMA, csvData: makeIntCsv(5) });
    const planResult = makePlanResult([table]);
    expect(() => validateGeneratedData(planResult, 100, 'deep')).not.toThrow();
  });

  it('uses "wide" profile when dataProfileId is "wide"', () => {
    // wide: txnMinRows=20. TXN table (has DATE). 35 rows > 20 — no warn.
    const table = makeTable({ tableName: 'events', schema: TXN_SCHEMA, csvData: makeTxnCsv(35) });
    const planResult = makePlanResult([table]);
    expect(() => validateGeneratedData(planResult, 100, 'wide')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// (i) isMasterTable classification (source lines 144-146)
// ---------------------------------------------------------------------------

describe('isMasterTable classification (source lines 144-146)', () => {
  it('table without timestamp and <=8 schema cols is treated as master', () => {
    // SIMPLE_SCHEMA = 3 INTEGER cols, no TIMESTAMP/DATE/DATETIME → master
    // standard masterMinRows = 10; with 5 rows we just expect no throw
    const table = makeTable({ schema: SIMPLE_SCHEMA, csvData: makeIntCsv(5) });
    const planResult = makePlanResult([table]);
    expect(() => validateGeneratedData(planResult, 100, 'standard')).not.toThrow();
  });

  it('table with DATE column is NOT treated as master (hasTimestamp=true)', () => {
    // TXN_SCHEMA has DATE → txnMinRows applies (standard=30; 35 rows ok)
    const table = makeTable({ schema: TXN_SCHEMA, csvData: makeTxnCsv(35) });
    const planResult = makePlanResult([table]);
    expect(() => validateGeneratedData(planResult, 100, 'standard')).not.toThrow();
  });

  it('table with TIMESTAMP column is treated as transaction table', () => {
    const tsSchema = [
      { name: 'ts', type: 'TIMESTAMP', description: 'Timestamp' },
      { name: 'val', type: 'INTEGER', description: 'Value' },
    ];
    const tsCsv = (() => {
      const hdr = 'ts,val';
      const rows = Array.from({ length: 35 }, (_, i) => `2025-01-01T00:00:${String(i).padStart(2,'0')}Z,${i}`);
      return [hdr, ...rows].join('\n');
    })();
    const table = makeTable({ tableName: 'logs', schema: tsSchema, csvData: tsCsv });
    const planResult = makePlanResult([table]);
    expect(() => validateGeneratedData(planResult, 100, 'standard')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// (j) Multiple tables are all validated
// ---------------------------------------------------------------------------

describe('multiple tables validated (source: loop over planResult.tables)', () => {
  it('validates all tables in planResult.tables', () => {
    const t1 = makeTable({ tableName: 't1', schema: SIMPLE_SCHEMA, csvData: makeIntCsv(15) });
    const t2 = makeTable({ tableName: 't2', schema: STRING_SCHEMA, csvData: makeStringCsv(15) });
    const planResult = makePlanResult([t1, t2]);
    expect(() => validateGeneratedData(planResult, 100)).not.toThrow();
    // Both tables should have csvData modified (strings quoted)
    expect(t2.csvData).toContain('"');
  });

  it('throws when second table has no schema, even if first is valid', () => {
    const t1 = makeTable({ tableName: 't1', schema: SIMPLE_SCHEMA, csvData: makeIntCsv(15) });
    const t2 = { tableName: 't2', csvData: makeIntCsv(5) }; // no schema
    const planResult = makePlanResult([t1, t2]);
    expect(() => validateGeneratedData(planResult, 100)).toThrow('Incomplete table data for "t2"');
  });
});

// ---------------------------------------------------------------------------
// (k) csvData with quoted fields containing commas (parseCSVLine correctness)
// ---------------------------------------------------------------------------

describe('parseCSVLine handles quoted fields with commas', () => {
  it('parses a row with a comma inside a quoted STRING field', () => {
    const schema = [
      { name: 'id', type: 'INTEGER' },
      { name: 'description', type: 'STRING' },
      { name: 'amount', type: 'INTEGER' },
    ];
    // "hello, world" is a single field despite the comma
    const csvData = 'id,description,amount\n1,"hello, world",100\n2,"foo bar",200\n3,"baz qux",300\n4,"a b",400\n5,"c d",500\n6,"e f",600\n7,"g h",700\n8,"i j",800\n9,"k l",900\n10,"m n",1000\n11,"o p",1100';
    const table = makeTable({ schema, csvData });
    const planResult = makePlanResult([table]);
    expect(() => validateGeneratedData(planResult, 100)).not.toThrow();
    const lines = table.csvData.split('\n');
    // Each data row should produce exactly 3 columns after rebuild
    // The description field stays quoted, integers stay unquoted
    const firstDataLine = lines[1];
    // Should be: 1,"hello, world",100 form
    expect(firstDataLine.split(',').length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// (l) Focused parseCSVLine unit tests — pins faithful (real source) behavior
// Real source: Code.gs:1761-1788
// ---------------------------------------------------------------------------

describe('parseCSVLine — faithful port unit tests (Code.gs:1761-1788)', () => {
  it('splits a plain CSV line into trimmed fields', () => {
    expect(parseCSVLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('trims whitespace from unquoted fields (real source uses current.trim())', () => {
    // Real source trims: result.push(current.trim()) and final push also trims
    expect(parseCSVLine('  a ,  b , c  ')).toEqual(['a', 'b', 'c']);
  });

  it('handles quoted field containing a comma', () => {
    expect(parseCSVLine('"hello, world",foo')).toEqual(['hello, world', 'foo']);
  });

  it('unescapes doubled double-quotes inside quoted fields', () => {
    // "" inside quotes → single "
    expect(parseCSVLine('"say ""hi""",bar')).toEqual(['say "hi"', 'bar']);
  });

  it('handles empty fields', () => {
    expect(parseCSVLine('a,,c')).toEqual(['a', '', 'c']);
  });

  it('handles empty quoted field', () => {
    expect(parseCSVLine('"",b')).toEqual(['', 'b']);
  });

  it('handles a single field with no comma', () => {
    expect(parseCSVLine('hello')).toEqual(['hello']);
  });

  it('handles quoted field that starts mid-value (real source toggles inQuotes)', () => {
    // Quote toggles inQuotes state on open/close
    expect(parseCSVLine('"foo bar",baz')).toEqual(['foo bar', 'baz']);
  });

  it('returns trimmed result for trailing whitespace in last field', () => {
    expect(parseCSVLine('a,b,c  ')).toEqual(['a', 'b', 'c']);
  });
});

// ---------------------------------------------------------------------------
// (m) Focused validateAndRepairValue unit tests — pins faithful behavior
// Real source: Code.gs:1610-1709
// ---------------------------------------------------------------------------

describe('validateAndRepairValue — faithful port unit tests (Code.gs:1610-1709)', () => {
  // --- Empty value ---
  it('returns empty string with repaired=false for empty input', () => {
    expect(validateAndRepairValue('', 'INTEGER', 'id', 0)).toEqual({ value: '', repaired: false });
  });

  it('returns empty string with repaired=false for whitespace-only input', () => {
    expect(validateAndRepairValue('   ', 'INTEGER', 'id', 0)).toEqual({ value: '', repaired: false });
  });

  // --- INTEGER ---
  it('accepts valid integer string', () => {
    expect(validateAndRepairValue('42', 'INTEGER', 'count', 0)).toEqual({ value: '42', repaired: false });
  });

  it('accepts negative integer string', () => {
    expect(validateAndRepairValue('-7', 'INTEGER', 'delta', 0)).toEqual({ value: '-7', repaired: false });
  });

  it('repairs range expression "51-100" → first number (real source: rangeMatch[1])', () => {
    const result = validateAndRepairValue('51-100', 'INTEGER', 'age_range', 0);
    expect(result).toEqual({ value: '51', repaired: true });
  });

  it('accepts INT64 alias', () => {
    expect(validateAndRepairValue('10', 'INT64', 'n', 0)).toEqual({ value: '10', repaired: false });
  });

  it('repairs "abc123def" by extracting embedded number', () => {
    const result = validateAndRepairValue('abc123def', 'INTEGER', 'qty', 0);
    expect(result.value).toBe('123');
    expect(result.repaired).toBe(true);
  });

  it('falls back to generateDefaultValue for fully non-numeric INTEGER (returns a string)', () => {
    const result = validateAndRepairValue('not-a-number', 'INTEGER', 'id', 2);
    // generateDefaultValue for 'id' column → sequential: rowIndex+1 = 3
    expect(result.repaired).toBe(true);
    expect(result.value).toBe('3');
  });

  it('context-aware default: column ending with _id gets rowIndex+1', () => {
    const result = validateAndRepairValue('xyz', 'INTEGER', 'customer_id', 4);
    expect(result.value).toBe('5'); // rowIndex+1
    expect(result.repaired).toBe(true);
  });

  // --- FLOAT ---
  it('accepts valid float string', () => {
    expect(validateAndRepairValue('3.14', 'FLOAT', 'score', 0)).toEqual({ value: '3.14', repaired: false });
  });

  it('accepts integer as FLOAT (matches /^-?\\d*\\.?\\d+$/)', () => {
    expect(validateAndRepairValue('5', 'FLOAT', 'val', 0)).toEqual({ value: '5', repaired: false });
  });

  it('repairs "~12.5kg" by extracting float', () => {
    const result = validateAndRepairValue('~12.5kg', 'FLOAT', 'weight', 0);
    expect(result.value).toBe('12.5');
    expect(result.repaired).toBe(true);
  });

  it('accepts FLOAT64 alias', () => {
    expect(validateAndRepairValue('1.0', 'FLOAT64', 'x', 0)).toEqual({ value: '1.0', repaired: false });
  });

  it('accepts NUMBER alias', () => {
    expect(validateAndRepairValue('99.9', 'NUMBER', 'x', 0)).toEqual({ value: '99.9', repaired: false });
  });

  // --- DATE ---
  it('accepts valid YYYY-MM-DD date', () => {
    expect(validateAndRepairValue('2025-01-15', 'DATE', 'event_date', 0)).toEqual({ value: '2025-01-15', repaired: false });
  });

  it('extracts date from string with prefix', () => {
    const result = validateAndRepairValue('Date: 2025-03-10T00:00:00', 'DATE', 'dt', 0);
    expect(result.value).toBe('2025-03-10');
    expect(result.repaired).toBe(true);
  });

  it('falls back to generated date for non-parseable DATE value', () => {
    const result = validateAndRepairValue('tomorrow', 'DATE', 'event_date', 0);
    expect(result.repaired).toBe(true);
    // Generated date matches YYYY-MM-DD pattern
    expect(result.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // --- TIMESTAMP / DATETIME ---
  it('accepts valid ISO timestamp', () => {
    const result = validateAndRepairValue('2025-01-01T12:00:00Z', 'TIMESTAMP', 'ts', 0);
    expect(result.repaired).toBe(false);
    expect(result.value).toBe('2025-01-01T12:00:00Z');
  });

  it('accepts timestamp with space separator', () => {
    const result = validateAndRepairValue('2025-01-01 08:30:00', 'DATETIME', 'ts', 0);
    expect(result.repaired).toBe(false);
    expect(result.value).toBe('2025-01-01 08:30:00');
  });

  it('repairs out-of-range hours by clamping to 23', () => {
    const result = validateAndRepairValue('2025-01-01T25:00:00', 'TIMESTAMP', 'ts', 0);
    expect(result.repaired).toBe(true);
    expect(result.value).toContain('23:');
  });

  it('repairs out-of-range minutes by clamping to 59', () => {
    const result = validateAndRepairValue('2025-01-01T10:65:00', 'TIMESTAMP', 'ts', 0);
    expect(result.repaired).toBe(true);
    expect(result.value).toContain(':59:');
  });

  it('converts bare date to timestamp with 00:00:00 UTC suffix (real source behavior)', () => {
    const result = validateAndRepairValue('2025-06-15', 'TIMESTAMP', 'created_at', 0);
    expect(result.value).toBe('2025-06-15 00:00:00 UTC');
    expect(result.repaired).toBe(true);
  });

  it('falls back to generated timestamp for non-parseable TIMESTAMP value', () => {
    const result = validateAndRepairValue('now', 'TIMESTAMP', 'ts', 0);
    expect(result.repaired).toBe(true);
    // Generated ISO timestamp
    expect(result.value).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  // --- STRING (default case) ---
  it('accepts STRING value as-is (trimmed)', () => {
    expect(validateAndRepairValue('  hello world  ', 'STRING', 'name', 0)).toEqual({ value: 'hello world', repaired: false });
  });

  it('accepts BOOLEAN string as STRING (real source has no BOOLEAN case — falls to default)', () => {
    // Real source has no BOOLEAN case; it falls through to default STRING handling
    expect(validateAndRepairValue('true', 'BOOLEAN', 'flag', 0)).toEqual({ value: 'true', repaired: false });
  });

  it('accepts unknown type as STRING pass-through', () => {
    expect(validateAndRepairValue('some value', 'JSONB', 'data', 0)).toEqual({ value: 'some value', repaired: false });
  });

  // --- Real vs inferred: no quote-stripping (real source uses value.trim() only) ---
  it('does NOT strip surrounding quotes from value (real source has no quote strip)', () => {
    // Inferred implementation stripped leading/trailing " — real source does NOT
    // parseCSVLine already handles quotes; validateAndRepairValue receives the raw field
    const result = validateAndRepairValue('"hello"', 'STRING', 'name', 0);
    expect(result.value).toBe('"hello"');
    expect(result.repaired).toBe(false);
  });
});
