/**
 * planning/json-repair.js — Node port of repairTruncatedJson (Code.gs:1789-1825)
 *
 * Faithful port of the truncated-JSON repair function.
 * Pure function: no imports, no I/O, no LLM calls.
 *
 * Algorithm (from source):
 *   1. Try JSON.parse; if succeeds, return as-is.
 *   2. If a truncated "csvData" string value is detected (regex match),
 *      cut to the last \n escape sequence and close the string quote.
 *   3. Walk the (possibly modified) string tracking:
 *      - open brace count
 *      - open bracket count
 *      - inString / escaped state
 *   4. Close any unterminated string, then close brackets, then close braces.
 *   5. Return the repaired string (caller still needs to JSON.parse).
 */

/**
 * Attempts to repair a truncated JSON string so it becomes parseable.
 * Faithful port of repairTruncatedJson (Code.gs:1789-1825).
 *
 * @param {string} jsonStr - Potentially truncated JSON string
 * @returns {string} Repaired JSON string (may still be invalid if input is severely malformed)
 */
export function repairTruncatedJson(jsonStr) {
  try { JSON.parse(jsonStr); return jsonStr; } catch (e) {}

  let fixed = jsonStr;
  const csvDataMatch = fixed.match(/"csvData"\s*:\s*"([^"]*?)$/s);
  if (csvDataMatch) {
    const lastNewline = fixed.lastIndexOf('\\n');
    if (lastNewline > 0) fixed = fixed.substring(0, lastNewline) + '"';
  }

  let openBraces = 0; let openBrackets = 0; let inString = false; let escaped = false;
  for (let i = 0; i < fixed.length; i++) {
    const char = fixed[i];
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (char === '"') inString = !inString;
    else if (!inString) {
      if (char === '{') openBraces++; else if (char === '}') openBraces--;
      else if (char === '[') openBrackets++; else if (char === ']') openBrackets--;
    }
  }
  if (inString) fixed += '"';
  while (openBrackets > 0) { fixed += ']'; openBrackets--; }
  while (openBraces > 0) { fixed += '}'; openBraces--; }
  return fixed;
}
