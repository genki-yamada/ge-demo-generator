import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateSetupScript } from '../../../src/codegen/generate-setup-script.js';

const here = dirname(fileURLToPath(import.meta.url));
const fx = join(here, 'fixtures');
const cases = readdirSync(fx).filter(f => f.endsWith('.params.json')).map(f => f.replace('.params.json', ''));

// DEPS must match the values used when the golden fixtures were captured:
// appVersion='v10.100-public', fixed clock, callVertexAI throwing (→ userGoal fallback).
// See docs/codegen-golden-capture.md (Port contract).
const DEPS = {
  appVersion: 'v10.100-public',
  now: () => '2025-01-01T00:00:00.000Z',
  callVertexAI: () => { throw new Error('unavailable in test'); },
};
const norm = (s) => s.replace(/\r\n/g, '\n');

describe('generateSetupScript byte-equivalence vs GAS golden', () => {
  it('has at least 3 fixtures', () => { expect(cases.length).toBeGreaterThanOrEqual(3); });
  for (const name of cases) {
    it(`case ${name} matches golden byte-for-byte`, () => {
      // generateSetupScript mutates params.importedMcpList; deep-clone to keep fixture pristine.
      const params = JSON.parse(readFileSync(join(fx, `${name}.params.json`), 'utf8'));
      const golden = readFileSync(join(fx, `${name}.golden.sh`), 'utf8');
      const out = generateSetupScript(params, DEPS);
      expect(norm(out)).toBe(norm(golden));
    });
  }
});
