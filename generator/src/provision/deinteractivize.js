/**
 * deinteractivize.js
 *
 * Post-processes a generated bash script string to remove interactive `read -p`
 * prompts so the script can run headlessly in a Cloud Run Job.
 *
 * Values come from environment variables which the Cloud Run Job injects from
 * Secret Manager (Plan C Task 6).
 *
 * Four transformation rules (in order of application):
 *
 * 1. y/n confirmations  – `read -p "...(y/n)..." -n 1 -r` or `-n 1 -r` flags
 *    → Remove read line; inject `REPLY=...` so downstream `$REPLY` checks pass.
 *
 * 2. Value/menu captures – `read [-s] -p "..." VAR`
 *    → Replace with `VAR="${VAR:-<default>}"` (env-injection form).
 *    Defaults: [Y/n]-style menus → "Y"; numeric (CHOICE/n) → "0"; else → "".
 *
 * 3. Press [Enter] pause – `read -p "Press [Enter]..."` (no VAR, no y/n marker)
 *    → Remove entirely (no-op).
 *
 * 4. Safety guard: if ANY `read -p` remains after all rules, throw.
 *    (`while read -r`, piped reads, reads without -p are left untouched.)
 *
 * IMPORTANT: This transformer ONLY touches `read -p` interactive lines
 * and their surrounding `while true; do ... done` validation loops.
 * All other script content (gcloud/bq/python/curl) is left unchanged.
 */

/**
 * @param {string} scriptText   The bash script as a string.
 * @param {object} [opts]
 * @param {string} [opts.assumeYesVar='ASSUME_YES']  Env var for the y/n guard
 *   (unused at runtime since we hard-default REPLY to 'y', but threaded through
 *   for documentation / future use).
 * @returns {string} Transformed script with all interactive read -p removed.
 * @throws {Error} If any interactive `read -p` survives after transformation.
 */
export function deinteractivize(scriptText, { assumeYesVar = 'ASSUME_YES' } = {}) {
  let result = scriptText;

  // ── Step 1: collapse `while true; do\n  read -p/read -s -p VAR ...\n  ...\ndone`
  //    validation loops into a single env-injection line.
  //    Pattern: `while true; do` on one line, then (optional blank/echo lines,)
  //    then `read [-s] -p "..." VAR`, then more lines, then `done`.
  //    We replace the entire while…done block with the env injection for VAR.
  result = result.replace(
    /^(\s*)while\s+true\s*;\s*do\n([\s\S]*?)\n\1done\b[^\n]*/gm,
    (fullMatch, indent, body) => {
      // Extract the read -p line inside the loop (if it has a VAR)
      const readMatch = body.match(/^\s*read\s+(?:-[^\s]+\s+)*-p\s+"[^"]*"\s+(\w+)\s*$/m);
      if (!readMatch) {
        // No read -p with a var in this while-true block; leave untouched.
        return fullMatch;
      }
      const varName = readMatch[1];
      const defaultVal = guessDefault(varName, body);
      return `${indent}${varName}="\${${varName}:-${defaultVal}}"`;
    }
  );

  // ── Step 2: y/n confirmations ────────────────────────────────────────────
  //    `read -p "...(y/n)..." -n 1 -r`  OR  `read -p "...[y/N]..." -n 1 -r`
  //    Also catches lines with `-n 1 -r` flags (they are always y/n confirms).
  //    Replace with REPLY injection so downstream `[[ $REPLY =~ ^[Yy]$ ]]` passes.
  result = result.replace(
    /^(\s*)read\s+-p\s+"[^"]*(?:\(y\/n\)|\[y\/N\]|\[Y\/n\])[^"]*"\s+-n\s+1\s+-r\s*$/gim,
    (match, indent) => {
      return (
        `${indent}REPLY="\${${assumeYesVar}:+y}"; REPLY="\${REPLY:-y}"  # auto-yes (headless)`
      );
    }
  );

  // Also handle the flags in different order: `-n 1 -r` before the prompt
  result = result.replace(
    /^(\s*)read\s+(?=-n\s+1\s+-r\s)-n\s+1\s+-r\s+-p\s+"[^"]*(?:\(y\/n\)|\[y\/N\]|\[Y\/n\])[^"]*"\s*$/gim,
    (match, indent) => {
      return (
        `${indent}REPLY="\${${assumeYesVar}:+y}"; REPLY="\${REPLY:-y}"  # auto-yes (headless)`
      );
    }
  );

  // ── Step 3: Press [Enter] pauses ─────────────────────────────────────────
  //    `read -p "Press [Enter]..."` with NO variable (no word after closing quote)
  result = result.replace(
    /^(\s*)read\s+-p\s+"[^"]*\bPress\s*\[?Enter\]?[^"]*"\s*$/gim,
    (_match, _indent) => `# (headless: pause removed)`
  );

  // ── Step 4: Value/menu captures ──────────────────────────────────────────
  //    `read [-s] -p "..." VAR`  (VAR is a shell identifier: word chars)
  //    Note: -s flag (silent) is fine to strip; we're injecting from env anyway.
  result = result.replace(
    /^(\s*)read\s+(?:-s\s+)?-p\s+"([^"]*)"\s+(\w+)\s*$/gim,
    (match, indent, promptText, varName) => {
      const defaultVal = guessDefault(varName, promptText);
      return `${indent}${varName}="\${${varName}:-${defaultVal}}"  # env-injected (headless)`;
    }
  );

  // Also handle: read -p "..." -s VAR  (flags in other order, less common)
  result = result.replace(
    /^(\s*)read\s+-p\s+"([^"]*)"\s+-s\s+(\w+)\s*$/gim,
    (match, indent, promptText, varName) => {
      const defaultVal = guessDefault(varName, promptText);
      return `${indent}${varName}="\${${varName}:-${defaultVal}}"  # env-injected (headless)`;
    }
  );

  // ── Step 5: Safety guard ──────────────────────────────────────────────────
  //    Any remaining line that is an interactive read -p (starts with optional
  //    whitespace, then `read`, then somewhere has `-p`) is a leak.
  //    We deliberately do NOT match `while read -r` (no -p flag on those).
  const remaining = result.split('\n').filter(line => /^\s*read\s[^\n]*-p\b/.test(line));
  if (remaining.length > 0) {
    throw new Error(
      `un-deinteractivized read -p remains:\n${remaining.map(l => `  ${l.trim()}`).join('\n')}`
    );
  }

  return result;
}

/**
 * Guess the headless default value for a captured variable.
 *
 * Rules (conservative, prefer keeping the script runnable over being clever):
 *   - varName looks like a y/n choice (REPLY, CHOOSE_*, *_LITE, *_CHOICE) → "Y"
 *   - promptText contains [Y/n] or (Y/n) → "Y"
 *   - promptText contains (y/n) (lowercase default n) → "y"  (still auto-yes)
 *   - varName is CHOICE or promptText has "(0-N)" numeric selection → "0"
 *   - anything else (API keys, OAuth secrets, URLs) → "" (must be injected by Job)
 *
 * @param {string} varName   Shell variable name captured from the read line.
 * @param {string} context   Prompt text or loop body for heuristic matching.
 * @returns {string}
 */
function guessDefault(varName, context) {
  const v = varName.toUpperCase();
  const c = context || '';

  // Numeric menu (CHOICE or prompt says "0-N")
  if (v === 'CHOICE' || /\(0-/.test(c)) {
    return '0';
  }

  // Y/n menu-style (REPLY for main menu, CHOOSE_LITE, etc.)
  if (v === 'REPLY' || /\[Y\/n\]|\(Y\/n\)/i.test(c)) {
    return 'Y';
  }
  if (/CHOOSE|LITE/.test(v)) {
    return 'Y';
  }

  // y/n (lower-case default) — still auto-yes for headless
  if (/\(y\/n\)|\[y\/N\]/i.test(c)) {
    return 'y';
  }

  // Secret/credential/URL captures — must come from Job env; default empty
  return '';
}
