import { describe, it, expect } from 'vitest';
import { updateSystemInstruction } from '../../src/codegen/update-system-instruction.js';

// A minimal setup-script fragment that includes the pattern
// "1. **BigQuery toolset:**...\n<body>\n  2. **Maps Toolset:**"
// This is the section the regex replaces.
const TEMPLATE = `#!/bin/bash
gcloud run services update agent \\
  --set-env-vars SYSTEM_INSTRUCTION='1. **BigQuery toolset:** Use these tools for data queries.
  The agent should use BigQuery effectively.
  Follow these guidelines carefully.

  2. **Maps Toolset:** Use these for location services.'
`;

describe('updateSystemInstruction', () => {
  it('replaces the body between BigQuery and Maps Toolset markers', () => {
    const business = 'Retail AI agent for inventory management.';
    const technical = 'Use BigQuery for stock data.';
    const result = updateSystemInstruction(TEMPLATE, business, technical);

    // The BigQuery header line should be preserved
    expect(result).toContain('1. **BigQuery toolset:**');
    // The Maps Toolset marker should be preserved
    expect(result).toContain('2. **Maps Toolset:**');
    // New content should appear
    expect(result).toContain('Retail AI agent');
    // Old placeholder content should be gone
    expect(result).not.toContain('The agent should use BigQuery effectively.');
  });

  it('escapes backslashes in the instruction', () => {
    const business = 'Use path C:\\Users\\data.';
    const technical = 'Technical note.';
    const result = updateSystemInstruction(TEMPLATE, business, technical);
    // The backslash should be escaped as double-backslash in the output
    expect(result).toContain('C:\\\\Users\\\\data');
  });

  it('escapes single quotes in the instruction', () => {
    const business = "The company's mission is clear.";
    const technical = 'Technical note.';
    const result = updateSystemInstruction(TEMPLATE, business, technical);
    // Single quote should be escaped as '\''
    expect(result).toContain("company'\\''s");
  });

  it('escapes newlines in the instruction', () => {
    const business = 'Line one\nLine two';
    const technical = 'Technical note.';
    const result = updateSystemInstruction(TEMPLATE, business, technical);
    // Newlines should be replaced with \n literal
    expect(result).toContain('Line one\\nLine two');
  });

  it('returns the script unchanged when the pattern is not found', () => {
    const scriptWithoutPattern = '#!/bin/bash\necho "no markers here"\n';
    const result = updateSystemInstruction(scriptWithoutPattern, 'business', 'technical');
    expect(result).toBe(scriptWithoutPattern);
  });

  it('combines business and technical instructions with double newline separator', () => {
    const business = 'Business part.';
    const technical = 'Technical part.';
    const result = updateSystemInstruction(TEMPLATE, business, technical);
    // fullInstruction = business + '\n\n' + technical, newlines become \n literal
    expect(result).toContain('Business part.\\n\\nTechnical part.');
  });
});
