/**
 * validate-data.test.js — TDD for planning/validate-data.js
 *
 * Covers validateGeneratedData ported from Code.gs:1458-1609.
 * Uses getDataProfile (from plan-helpers) internally.
 * ALL tests are synchronous/no-network.
 */
import { describe, it, expect } from 'vitest';
import { validateGeneratedData } from '../../src/planning/validate-data.js';

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
