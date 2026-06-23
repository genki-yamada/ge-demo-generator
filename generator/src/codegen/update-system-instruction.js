/**
 * codegen/update-system-instruction.js — faithful port of Code.gs:15984-15988.
 *
 * Updates the system-instruction section in a setup script, replacing the body
 * between "1. **BigQuery toolset:**" and "2. **Maps Toolset:**" with a
 * combined and shell-escaped business+technical instruction.
 */

/**
 * Replaces the instruction body in a setup script.
 *
 * Code.gs:15984 function updateSystemInstruction(setupScript, newBusinessInstruction, technicalInstruction)
 *
 * @param {string} setupScript             - The shell script containing the instruction block
 * @param {string} newBusinessInstruction  - New business instruction text
 * @param {string} technicalInstruction    - Technical instruction text to append
 * @returns {string} Updated setup script
 */
export function updateSystemInstruction(setupScript, newBusinessInstruction, technicalInstruction) {
  const fullInstruction = `${newBusinessInstruction}\n\n${technicalInstruction}`;
  const escaped = fullInstruction.replace(/\\/g, '\\\\').replace(/'/g, "'\\''").replace(/\n/g, '\\n');
  return setupScript.replace(/(1\.\s+\*\*BigQuery toolset:\*\*.*?\n)([\s\S]*?)(\n\s+2\.\s+\*\*Maps Toolset:\*\*)/, `$1${escaped}$3`);
}
