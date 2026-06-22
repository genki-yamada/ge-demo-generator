/**
 * planning/validate-data.js — Node port of GAS validateGeneratedData.
 *
 * Faithful port of:
 *   validateGeneratedData   Code.gs:1458-1609
 *   validateAndRepairValue  Code.gs:1610-1709
 *   generateDefaultValue    Code.gs:1710-1759
 *   parseCSVLine            Code.gs:1761-1788
 *
 * getDataProfile is imported from plan-helpers (replaces getDataProfile_ call at Code.gs:1460).
 */

import { getDataProfile } from './plan-helpers.js';

// ---------------------------------------------------------------------------
// parseCSVLine — CSV line parser handling quoted fields (Code.gs:1761-1788)
// ---------------------------------------------------------------------------

/**
 * Parses a single CSV line into an array of field strings.
 * Handles fields enclosed in double-quotes (including commas within quotes).
 * Unescapes "" → " within quoted fields.
 * Fields are trimmed (matching the real source's current.trim() calls).
 *
 * @param {string} line
 * @returns {string[]}
 */
export function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Handle escaped double quotes: ""
        current += '"';
        i++; // Skip the next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// ---------------------------------------------------------------------------
// generateDefaultValue — context-aware default generation (Code.gs:1710-1759)
// ---------------------------------------------------------------------------

/**
 * Generates a sensible default value for a given type and column.
 *
 * @param {string} type - The column type
 * @param {string} columnName - Column name for context-aware generation
 * @param {number} rowIndex - Row index for sequential IDs
 * @returns {string} A valid default value
 */
export function generateDefaultValue(type, columnName, rowIndex) {
  const upperType = type.toUpperCase();
  const lowerColName = columnName.toLowerCase();

  switch (upperType) {
    case 'INT64':
    case 'INTEGER':
      // ID columns get sequential values
      if (lowerColName.endsWith('_id') || lowerColName === 'id') {
        return String(rowIndex + 1);
      }
      // Count/quantity columns
      if (lowerColName.includes('count') || lowerColName.includes('quantity') || lowerColName.includes('num')) {
        return String(Math.floor(Math.random() * 100) + 1);
      }
      // Default integer
      return String(Math.floor(Math.random() * 1000));

    case 'FLOAT64':
    case 'FLOAT':
    case 'DOUBLE':
    case 'NUMBER':
      // Price/amount columns
      if (lowerColName.includes('price') || lowerColName.includes('amount') || lowerColName.includes('cost')) {
        return (Math.random() * 1000 + 10).toFixed(2);
      }
      // Rating/score columns
      if (lowerColName.includes('rating') || lowerColName.includes('score')) {
        return (Math.random() * 4 + 1).toFixed(1);
      }
      // Default float
      return (Math.random() * 100).toFixed(2);

    case 'DATE': {
      // Generate a date within the past year
      const d = new Date();
      d.setDate(d.getDate() - Math.floor(Math.random() * 365));
      return d.toISOString().split('T')[0];
    }

    case 'TIMESTAMP':
    case 'DATETIME': {
      const dt = new Date();
      dt.setDate(dt.getDate() - Math.floor(Math.random() * 365));
      return dt.toISOString();
    }

    default:
      // STRING type
      return `${columnName}_${rowIndex + 1}`;
  }
}

// ---------------------------------------------------------------------------
// validateAndRepairValue — per-cell type validation and repair (Code.gs:1610-1709)
// ---------------------------------------------------------------------------

/**
 * Validates and repairs a cell value based on its declared type.
 * Returns the repaired value and whether repair was needed.
 *
 * @param {string} value - The raw value (already unquoted by parseCSVLine)
 * @param {string} type - The column type (INTEGER, FLOAT, DATE, STRING, etc.)
 * @param {string} columnName - Column name for context-aware defaults
 * @param {number} rowIndex - Row index for generating sequential defaults
 * @returns {{value: string, repaired: boolean}}
 */
export function validateAndRepairValue(value, type, columnName, rowIndex) {
  const upperType = type.toUpperCase();
  const trimmedVal = value.trim();

  // Empty values are allowed (NULL)
  if (trimmedVal === '') {
    return { value: '', repaired: false };
  }

  switch (upperType) {
    case 'INT64':
    case 'INTEGER': {
      // Check for range expressions like "51-100"
      const rangeMatch = trimmedVal.match(/^(\d+)\s*[-–—]\s*\d+$/);
      if (rangeMatch) {
        return { value: rangeMatch[1], repaired: true };
      }
      // Check for valid integer
      if (/^-?\d+$/.test(trimmedVal)) {
        return { value: trimmedVal, repaired: false };
      }
      // Try to extract a number
      const intMatch = trimmedVal.match(/-?\d+/);
      if (intMatch) {
        return { value: intMatch[0], repaired: true };
      }
      // Generate fallback
      return { value: generateDefaultValue(upperType, columnName, rowIndex), repaired: true };
    }

    case 'FLOAT64':
    case 'FLOAT':
    case 'DOUBLE':
    case 'NUMBER': {
      // Check for valid float
      if (/^-?\d*\.?\d+$/.test(trimmedVal)) {
        return { value: trimmedVal, repaired: false };
      }
      // Try to extract a number
      const floatMatch = trimmedVal.match(/-?\d+\.?\d*/);
      if (floatMatch) {
        return { value: floatMatch[0], repaired: true };
      }
      // Generate fallback
      return { value: generateDefaultValue(upperType, columnName, rowIndex), repaired: true };
    }

    case 'DATE': {
      // Check for valid date format YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmedVal)) {
        return { value: trimmedVal, repaired: false };
      }
      // Try to extract a date pattern
      const dateMatch = trimmedVal.match(/\d{4}-\d{2}-\d{2}/);
      if (dateMatch) {
        return { value: dateMatch[0], repaired: true };
      }
      // Generate fallback
      return { value: generateDefaultValue(upperType, columnName, rowIndex), repaired: true };
    }

    case 'TIMESTAMP':
    case 'DATETIME': {
      // Accept ISO format or similar, then validate time ranges
      if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(trimmedVal)) {
        // Validate hour/minute/second ranges (hour 0-23, min/sec 0-59)
        const tsTimeMatch = trimmedVal.match(/(\d{2}):(\d{2})(?::(\d{2}))?/);
        if (tsTimeMatch) {
          const h = parseInt(tsTimeMatch[1], 10);
          const m = parseInt(tsTimeMatch[2], 10);
          const s = tsTimeMatch[3] ? parseInt(tsTimeMatch[3], 10) : 0;
          if (h > 23 || m > 59 || s > 59) {
            // Clamp to valid range
            const fixedH = String(Math.min(h, 23)).padStart(2, '0');
            const fixedM = String(Math.min(m, 59)).padStart(2, '0');
            const fixedS = String(Math.min(s, 59)).padStart(2, '0');
            const fixedTs = trimmedVal.replace(/\d{2}:\d{2}(:\d{2})?/, `${fixedH}:${fixedM}:${fixedS}`);
            return { value: fixedTs, repaired: true };
          }
        }
        return { value: trimmedVal, repaired: false };
      }
      // If it's a date, convert to timestamp
      const tsDateMatch = trimmedVal.match(/^(\d{4}-\d{2}-\d{2})$/);
      if (tsDateMatch) {
        return { value: `${tsDateMatch[1]} 00:00:00 UTC`, repaired: true };
      }
      // Generate fallback as timestamp
      return { value: generateDefaultValue('TIMESTAMP', columnName, rowIndex), repaired: true };
    }

    default:
      // STRING type - accept as-is
      return { value: trimmedVal, repaired: false };
  }
}

// ---------------------------------------------------------------------------
// validateGeneratedData (Code.gs:1458-1609)
// ---------------------------------------------------------------------------

/**
 * Validates and repairs the generated plan result in-place.
 * Modifies table.schema and table.csvData on each table in planResult.tables.
 *
 * @param {object} planResult - The plan result from planAndGenerateData
 * @param {number} targetRows - The target row count (for warning only, not truncation)
 * @param {string} [dataProfileId='standard'] - Profile ID for min-row thresholds
 */
export function validateGeneratedData(planResult, targetRows, dataProfileId) {
  // Code.gs:1460: load profile (getDataProfile_ → imported getDataProfile)
  const profile = getDataProfile(dataProfileId || 'standard');

  // Code.gs:1461-1463: must have tables
  if (!planResult.tables || planResult.tables.length === 0) {
    throw new Error('No table definitions generated');
  }

  for (const table of planResult.tables) {
    // Code.gs:1466: each table must have schema and csvData
    if (!table.schema || !table.csvData) {
      throw new Error(`Incomplete table data for "${table.tableName}"`);
    }

    // Code.gs:1469-1471: split CSV into lines
    const lines = table.csvData.trim().split('\n');
    if (lines.length === 0) throw new Error(`Empty CSV data for "${table.tableName}"`);

    // Code.gs:1473-1476: parse header line and compare column counts
    const csvHeaders = parseCSVLine(lines[0]);
    const schemaColumnCount = table.schema.length;
    const csvColumnCount = csvHeaders.length;

    // Code.gs:1478-1138: repair schema when column counts mismatch
    if (csvColumnCount !== schemaColumnCount) {
      // Build a lookup map from schema for fast case-insensitive matching
      // Code.gs:1483-1487
      const schemaMap = {};
      for (const field of table.schema) {
        schemaMap[field.name.toLowerCase()] = field;
      }

      // Code.gs:1489-1496: rebuild schema from CSV headers, preserving types where possible
      const repairedSchema = csvHeaders.map(headerName => {
        const normalizedName = headerName.trim().toLowerCase();
        if (schemaMap[normalizedName]) {
          return schemaMap[normalizedName];
        }
        // Code.gs:1494-1496: default to STRING for unknown columns
        return { name: headerName.trim(), type: 'STRING', description: 'Auto-generated field' };
      });

      table.schema = repairedSchema;
    }

    const expectedColumnCount = table.schema.length;

    // Code.gs:1501-1504: determine row count and table classification
    const dataRowCount = lines.length - 1; // Exclude header
    const hasTimestamp = table.schema.some(f =>
      ['TIMESTAMP', 'DATE', 'DATETIME'].includes(f.type.toUpperCase())
    );
    const isMasterTable = !hasTimestamp && table.schema.length <= 8;
    const minExpectedRows = isMasterTable ? profile.masterMinRows : profile.txnMinRows;

    // Code.gs:1506-1508: warn if sparse
    if (dataRowCount < minExpectedRows) {
      console.warn(`[CSV QUALITY] Table "${table.tableName}" has only ${dataRowCount} rows (expected at least ${minExpectedRows}). Data may be sparse.`);
    }

    // Code.gs:1511-1513: set up per-row repair tracking
    const repairedLines = [];
    let repairCount = 0;

    // Code.gs:1514-1542: per-row column count repair
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      let parts = parseCSVLine(line);

      if (parts.length !== expectedColumnCount) {
        if (lineIdx === 0) {
          // Code.gs:1519-1521: header row mismatch — warn but skip repair
          console.warn(`[CSV REPAIR] Header row has ${parts.length} columns, expected ${expectedColumnCount}. Skipping repair.`);
        } else {
          // Code.gs:1523-1530: data row repair — pad or truncate
          if (parts.length < expectedColumnCount) {
            // Pad with empty values (Code.gs:1525-1527)
            while (parts.length < expectedColumnCount) {
              parts.push('');
            }
          } else {
            // Truncate excess columns (Code.gs:1529-1530)
            parts = parts.slice(0, expectedColumnCount);
          }
          repairCount++;
        }
      }
      repairedLines.push(parts);
    }

    if (repairCount > 0) {
      console.warn(`[CSV REPAIR] Repaired ${repairCount} malformed rows in "${table.tableName}".`);
    }

    // Code.gs:1545-1551: row count validation (warn only, no truncation)
    const currentDataRows = repairedLines.length - 1; // Exclude header
    if (currentDataRows < targetRows) {
      console.warn(`[ROW COUNT] Table "${table.tableName}" has ${currentDataRows} rows (target: ${targetRows}). AI did not generate enough rows.`);
    }

    // Code.gs:1555-1609: robust data cleaning & type validation
    let typeRepairCount = 0;
    const cleanedLines = repairedLines.map((parts, lineIdx) => {
      // Code.gs:1558-1568: header row — strip outer quotes, re-quote STRING/date cols
      if (lineIdx === 0) {
        return parts.map(v => v.replace(/^"|"$/g, '')).map((v, colIdx) => {
          const field = table.schema[colIdx];
          const type = field ? field.type.toUpperCase() : 'STRING';
          // Code.gs:1561-1566: numbers stay unquoted in header
          if (['INTEGER', 'FLOAT', 'DOUBLE', 'NUMBER', 'INT64', 'FLOAT64'].includes(type)) {
            return v;
          }
          // Code.gs:1567: all other types (STRING, DATE, etc.) get quoted
          return `"${v.replace(/"/g, '""')}"`;
        }).join(',');
      }

      // Code.gs:1571-1607: data rows — validate and repair each cell
      return parts.map((val, colIdx) => {
        const field = table.schema[colIdx];
        const type = field ? field.type.toUpperCase() : 'STRING';
        const columnName = field ? field.name : `col${colIdx}`;

        // Code.gs:1576-1580: call validateAndRepairValue helper
        const result = validateAndRepairValue(val, type, columnName, lineIdx - 1);
        if (result.repaired) {
          typeRepairCount++;
        }
        return result.value;
      }).map((v, colIdx) => {
        // Code.gs:1582-1591: final re-quoting as per BigQuery requirements
        const field = table.schema[colIdx];
        const type = field ? field.type.toUpperCase() : 'STRING';

        if (['INTEGER', 'FLOAT', 'DOUBLE', 'NUMBER', 'INT64', 'FLOAT64'].includes(type)) {
          return v; // Numbers stay unquoted (Code.gs:1588)
        }
        // Code.gs:1590: strings, dates, etc. get strictly quoted
        return `"${v.replace(/"/g, '""')}"`;
      }).join(',');
    });

    if (typeRepairCount > 0) {
      console.warn(`[TYPE REPAIR] Fixed ${typeRepairCount} type violations in "${table.tableName}".`);
    }

    // Code.gs:1608: write back cleaned CSV
    table.csvData = cleanedLines.join('\n');
  }
}
