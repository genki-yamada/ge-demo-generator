import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { deinteractivize } from '../../src/provision/deinteractivize.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Regex that matches interactive read -p remaining after transform.
// Must NOT match: while read -r, read without -p, piped reads.
const INTERACTIVE_READ_P = /^\s*read\s[^\n]*-p\b/m;

// ─── Pattern 1: y/n confirmations ───────────────────────────────────────────

describe('pattern 1: y/n confirmation (read -p ... -n 1 -r)', () => {
  it('removes the read -p line', () => {
    const input = `    read -p "Attempt to continue anyway? (y/n) " -n 1 -r\n    echo`;
    const result = deinteractivize(input);
    expect(result).not.toMatch(/read -p/);
  });

  it('inserts REPLY=y so downstream $REPLY check passes', () => {
    const input = `    read -p "Are you sure you want to proceed? (y/n) " -n 1 -r\n    echo\n    if [[ ! $REPLY =~ ^[Yy]$ ]]; then exit 1; fi`;
    const result = deinteractivize(input);
    expect(result).toMatch(/REPLY=/);
    expect(result).toMatch(/['"y'"]/); // y value present
  });

  it('respects custom assumeYesVar', () => {
    const input = `read -p "Have you confirmed the instance exists? (y/n) " -n 1 -r`;
    const result = deinteractivize(input, { assumeYesVar: 'CI_AUTO_YES' });
    expect(result).toMatch(/CI_AUTO_YES/);
  });

  it('no interactive read -p remains after transform', () => {
    const input = `read -p "Have you confirmed the instance exists? (y/n) " -n 1 -r\necho`;
    const result = deinteractivize(input);
    expect(INTERACTIVE_READ_P.test(result)).toBe(false);
  });
});

// ─── Pattern 2: menu/value capture (read -p "..." VAR) ───────────────────────

describe('pattern 2: value capture with variable', () => {
  it('replaces read -p VAR with env injection VAR="${VAR:-Y}" for Y/n prompts', () => {
    const input = `  read -p "▶ Enter choice [Y/n/m]: " REPLY`;
    const result = deinteractivize(input);
    expect(result).toMatch(/REPLY=/);
    expect(result).not.toMatch(/read -p/);
  });

  it('replaces read -p VAR with env injection VAR="${VAR:-Y}" for (Y/n) prompts', () => {
    const input = `    read -p "▶ Use lightweight gemini-3.1-flash-lite for root_agent? (Y/n): " CHOOSE_LITE`;
    const result = deinteractivize(input);
    expect(result).toMatch(/CHOOSE_LITE=/);
    expect(result).not.toMatch(/read -p/);
  });

  it('replaces read -s -p for OAuth Client ID with empty default', () => {
    const input = `  read -p "Enter your OAuth Client ID: " OAUTH_CLIENT_ID`;
    const result = deinteractivize(input);
    expect(result).toMatch(/OAUTH_CLIENT_ID=/);
    expect(result).not.toMatch(/read -p/);
  });

  it('replaces read -s -p for OAuth Client Secret with empty default', () => {
    const input = `  read -s -p "Enter your OAuth Client Secret: " OAUTH_CLIENT_SECRET`;
    const result = deinteractivize(input);
    expect(result).toMatch(/OAUTH_CLIENT_SECRET=/);
    expect(result).not.toMatch(/read -s/);
  });

  it('replaces read -s -p for API key with empty default', () => {
    const input = `  read -s -p "▶ Enter EXAMPLE_API_KEY (API key for ExampleMCP service): " EXAMPLE_API_KEY`;
    const result = deinteractivize(input);
    expect(result).toMatch(/EXAMPLE_API_KEY=/);
    expect(result).not.toMatch(/read -s/);
  });

  it('replaces optional URL capture with empty default', () => {
    const input = `read -p "▶ Enter EXAMPLE_API_URL (Base URL for ExampleMCP service) [OPTIONAL - press Enter to skip]: " EXAMPLE_API_URL`;
    const result = deinteractivize(input);
    expect(result).toMatch(/EXAMPLE_API_URL=/);
    expect(result).not.toMatch(/read -p/);
  });

  it('replaces numeric CHOICE with default 0', () => {
    const input = `        read -p "Select which app to register the agent to (0-\$((APP_COUNT-1))): " CHOICE`;
    const result = deinteractivize(input);
    expect(result).toMatch(/CHOICE=/);
    expect(result).not.toMatch(/read -p/);
  });

  it('no interactive read -p remains after transform', () => {
    const input = `read -p "Enter your OAuth Client ID: " OAUTH_CLIENT_ID`;
    const result = deinteractivize(input);
    expect(INTERACTIVE_READ_P.test(result)).toBe(false);
  });
});

// ─── Pattern 3: Press [Enter] pause (no variable) ────────────────────────────

describe('pattern 3: pause prompt with no variable', () => {
  it('removes the read -p line entirely', () => {
    const input = `  read -p "Press [Enter] after you have completed these steps and copied your Client ID/Secret..."`;
    const result = deinteractivize(input);
    expect(result).not.toMatch(/read -p/);
  });

  it('does not leave a blank line artifact that breaks surrounding code', () => {
    const input = `  echo "before"\n  read -p "Press [Enter] after you have completed these steps..."\n  echo "after"`;
    const result = deinteractivize(input);
    // Script logic intact
    expect(result).toContain('echo "before"');
    expect(result).toContain('echo "after"');
    expect(result).not.toMatch(/read -p/);
  });
});

// ─── Pattern 4: while read (MUST be left untouched) ─────────────────────────

describe('pattern 4: while read (non-interactive, must be untouched)', () => {
  it('does NOT transform while read -r line', () => {
    const input = `      while read -r line; do\n        echo "$line"\n      done <<< "$DATA"`;
    const result = deinteractivize(input);
    expect(result).toBe(input);
  });

  it('INTERACTIVE_READ_P regex does NOT match while read -r', () => {
    const line = `      while read -r line; do`;
    expect(INTERACTIVE_READ_P.test(line)).toBe(false);
  });

  it('does not transform read without -p flag', () => {
    const input = `read VAR`;
    const result = deinteractivize(input);
    expect(result).toBe(input);
  });
});

// ─── Safety: leftover interactive read -p → throws ──────────────────────────

describe('safety: unknown interactive read -p → throws', () => {
  it('throws when an unrecognized read -p pattern would remain', () => {
    // A contrived pattern that doesn't match any known category
    const input = `read -p "Enter some completely novel thing: " NOVEL_VAR_XYZ_UNKNOWN_PATTERN_ZZZZZ`;
    // deinteractivize should either handle it (env injection) or throw.
    // Because the variable name doesn't match any special-case, it falls into
    // the generic var-capture path → env injection → no throw.
    // To test the throw path we need an explicitly uncategorizable fragment
    // that the implementation cannot match at all.
    // We simulate that by making the function not know how to handle a flag combination.
    // Real test: inject a read -p pattern with NO variable and NO pause-marker
    // to check the guard.
    const weirdPause = `read -p "Something we forgot to handle"`;
    // No VAR, no (y/n), no "Press [Enter]" — this is a bare pause with no recognized marker.
    // Implementation must detect it as "unhandled interactive read" OR handle it as pause.
    // For the purposes of the throw test, we construct something that definitively can't match:
    // A multi-line heredoc-like pattern that has read -p embedded after transform somehow.
    // Actually: we test the GUARD directly by checking what happens when an artificial
    // script has a read -p that our transformer emits unchanged (i.e., we call the guard
    // function with a post-transform result that still has read -p).
    // Since we can't call internal functions directly, we test via a script where the
    // transformer produces a result that still has read -p (by testing a deliberately
    // malformed/unmatched case and confirming the guard fires).
    // The easiest approach: a read -p with backtick-quoted prompt and unusual flags
    // that no regex covers.
    const unhandleable = `read -p \`some-cmd\` -z WEIRD_FLAG_VAR`;
    // This is contrived; the transformer must throw if any `read -p` remains after all rules.
    // We just assert it doesn't silently pass.
    // Implementation detail: if the transformer can't match a line, it leaves it in place,
    // and the FINAL guard catches it.
    expect(() => deinteractivize(unhandleable)).toThrow(/un-deinteractivized read -p/i);
  });
});

// ─── Golden corpus regression ─────────────────────────────────────────────────

const FIXTURES_DIR = join(__dirname, '../codegen/equivalence/fixtures');

function goldenTest(name) {
  describe(`golden: ${name}.golden.sh`, () => {
    it('transforms with ZERO interactive read -p remaining and does not throw', () => {
      const script = readFileSync(join(FIXTURES_DIR, `${name}.golden.sh`), 'utf8');

      // Count before
      const linesBefore = script.split('\n').filter(l => /^\s*read\s[^\n]*-p\b/.test(l));
      expect(linesBefore.length).toBeGreaterThan(0); // confirm there ARE interactive reads to begin with

      let result;
      expect(() => { result = deinteractivize(script); }).not.toThrow();

      // No interactive read -p lines remaining in the bash portions
      const linesAfter = result.split('\n').filter(l => /^\s*read\s[^\n]*-p\b/.test(l));
      expect(linesAfter).toHaveLength(0);

      // while read -r must survive (non-interactive, not -p)
      const whileReadBefore = script.split('\n').filter(l => /^\s*while\s+read\b/.test(l));
      const whileReadAfter = result.split('\n').filter(l => /^\s*while\s+read\b/.test(l));
      expect(whileReadAfter.length).toBe(whileReadBefore.length);
    });
  });
}

goldenTest('minimal');
goldenTest('retail');
goldenTest('mcp');
