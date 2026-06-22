/**
 * planning/plan-and-generate.js — Node port of GAS planAndGenerateData orchestrator.
 *
 * Faithful port of Code.gs:735-845.
 * This is the integration hub of the planning pipeline: it calls buildPlanningPrompt,
 * augments the prompt for MCP/Workspace, calls the LLM, parses and repairs JSON,
 * builds the dataPreview, generates images, validates, and returns planResult.
 *
 * Pure helpers are imported directly (2d-A through 2d-D).
 * External-touching collaborators are injected via deps (2d-E spec).
 */

import { buildPlanningPrompt } from './planning-prompt.js';
import { repairTruncatedJson } from './json-repair.js';
import { parseCSVLine, validateGeneratedData } from './validate-data.js';
import { getTechnicalInstruction } from './technical-instruction.js';
import { resolvePlannedPublicDatasetId } from './plan-helpers.js';

/**
 * Returns Asia/Tokyo date as yyyy-MM-dd using Intl.DateTimeFormat.
 * Fallback when deps.today is not provided.
 *
 * @param {Date} d
 * @returns {string} e.g. "2026-06-22"
 */
function formatTokyoDate(d) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * Port of planAndGenerateData (Code.gs:735-845).
 * Orchestrates: discovery → prompt build → LLM call → parse → dataPreview →
 * image gen → validate → return planResult.
 *
 * @param {string} userGoal - Business problem description
 * @param {object} options
 * @param {boolean} [options.usePublicDataset]
 * @param {string} [options.publicDatasetId]
 * @param {number} [options.rowCount]
 * @param {string} [options.dataProfile]
 * @param {Array}  [options.importedMcpList]
 * @param {boolean}[options.enableWorkspaceMcp]
 * @param {object} [deps={}]
 * @param {{ generateContent: Function }} [deps.vertexClient] - Replaces callVertexAIWithRetry
 * @param {Function} [deps.discoverPublicDataset] - (userGoal) => Promise<datasetId>
 * @param {Function} [deps.verifyAndResolveTable] - Passed into resolvePlannedPublicDatasetId
 * @param {Function} [deps.generateImage] - Optional; (imagePrompt) => {base64Data, mimeType}
 * @param {string}   [deps.today] - Asia/Tokyo yyyy-MM-dd referenceDate fallback
 * @returns {Promise<object>} planResult with 13 fields
 */
export async function planAndGenerateData(userGoal, options, deps = {}) {
  // Step 0 (Code.gs:3-4): If using public dataset and no ID specified, discover one
  if (options.usePublicDataset && !options.publicDatasetId) {
    options.publicDatasetId = await deps.discoverPublicDataset(userGoal);
  }

  // Build base planning prompt (Code.gs:7)
  let prompt = buildPlanningPrompt(userGoal, options);

  // MCP augmentation (Code.gs:8-19): verbatim
  if (options.importedMcpList && options.importedMcpList.length > 0) {
    options.importedMcpList.forEach((mcp, idx) => {
      const caps = mcp.capabilities ? mcp.capabilities.join(', ') : 'External system integration';
      const repoName = mcp.github_url.split('/').pop().replace(/\.git$/, '');
      prompt += `\n- **🔌 CUSTOM MCP SERVER TOOL #${idx + 1} AVAILABLE (${repoName})**:
    - A custom external MCP server has been imported by the user.
    - **Capabilities**: ${caps}
    - You MUST leverage these capabilities when generating the 'businessInstruction' and 'demoGuide' (prompts).
    - In 'businessInstruction', mention that the agent has access to these capabilities via a custom MCP toolset.
    - You MUST design at least TWO prompts (out of the 7 required) in the 'demoGuide' that explicitly ask the agent to perform tasks using these capabilities. Formulate business scenario logic where the agent reaches out to this custom tool to complete its autonomous task.
\n`;
    });
  }

  // Workspace MCP augmentation (Code.gs:21-28): verbatim
  if (options.enableWorkspaceMcp) {
    prompt += `\n- **🔌 GOOGLE WORKSPACE MCP TOOLS AVAILABLE**:
    - The official Google Workspace MCP servers are enabled (Gmail, Drive, Calendar, Chat, People).
    - You MUST leverage these capabilities when generating the 'businessInstruction' and 'demoGuide' (prompts).
    - In 'businessInstruction', mention that the agent has access to Google Workspace data via Workspace MCP toolsets.
    - You MUST design at least TWO prompts (out of the 7 required) in the 'demoGuide' that explicitly ask the agent to perform tasks using these Workspace capabilities (e.g., searching for info in Drive, checking Calendar events, drafting emails, listing chat messages).
\n`;
  }

  // LLM call (Code.gs:29): callVertexAIWithRetry → deps.vertexClient.generateContent
  const response = await deps.vertexClient.generateContent(prompt);

  // Parse response (Code.gs:32-38): strip ```json fence → repairTruncatedJson → JSON.parse
  let parsed;
  try {
    let jsonStr = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    jsonStr = repairTruncatedJson(jsonStr);
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error('Failed to parse AI response. Try reducing the row/table count.');
  }

  // Extract dataPreview (Code.gs:41-61)
  const dataPreview = [];
  if (parsed.tables) {
    for (const table of parsed.tables) {
      if (table.csvData) {
        const lines = table.csvData.trim().split('\n');
        const headers = parseCSVLine(lines[0]);
        const previewRows = lines.slice(1).map(line => {
          const values = parseCSVLine(line);
          const row = {};
          headers.forEach((h, i) => { row[h.trim().replace(/^"|"$/g, '')] = values[i] || ''; });
          return row;
        });
        dataPreview.push({
          tableName: table.tableName,
          headers: headers.map(h => h.trim().replace(/^"|"$/g, '')),
          rows: previewRows,
          totalRows: lines.length - 1,
        });
      }
    }
  }

  // Generate in-memory simulated images (Code.gs:63-82)
  if (parsed.externalFiles && parsed.externalFiles.length > 0) {
    console.log('[ImageGen-Pipeline] Scanning externalFiles for dynamic images...');
    for (let i = 0; i < parsed.externalFiles.length; i++) {
      const file = parsed.externalFiles[i];
      if (file.mimeType && file.mimeType.startsWith('image/') && file.imagePrompt) {
        try {
          console.log(`[ImageGen-Pipeline] Generating simulated image for [${file.fileName}]...`);
          // generateImageBase64WithRetry → deps.generateImage (optional, injected)
          if (deps.generateImage) {
            const genResult = await deps.generateImage(file.imagePrompt);

            // JSONオブジェクトを直接拡張（In-Memory保存）
            file.base64Data = genResult.base64Data;
            file.mimeType = genResult.mimeType || file.mimeType;

            console.log(`[ImageGen-Pipeline] SUCCESS! Bound base64 image data to file: ${file.fileName}`);
          }
        } catch (imgErr) {
          console.error(`[ImageGen-Pipeline] FAILED to generate image for ${file.fileName}: ${imgErr.message}`);
        }
      }
    }
  }

  // Validation and Clean-up (Code.gs:85)
  // validateGeneratedData signature: (planResult, targetRows, dataProfileId)
  validateGeneratedData(parsed, options.rowCount, options.dataProfile);

  // Build biz string (Code.gs:89) for reuse in businessInstruction + systemInstruction
  const biz = parsed.businessInstruction || parsed.systemInstruction || '';

  // Return planResult (Code.gs:87-101)
  return {
    tables: parsed.tables,
    businessInstruction: biz,
    technicalInstruction: getTechnicalInstruction(),
    systemInstruction: `${biz}\n\n${getTechnicalInstruction()}`,
    // referenceDate (Code.gs:92): parsed value or deps.today fallback or formatTokyoDate
    referenceDate: parsed.referenceDate || (deps.today ?? formatTokyoDate(new Date())),
    // resolvePlannedPublicDatasetId (Code.gs:93): inject verifyAndResolveTable via deps
    publicDatasetId: resolvePlannedPublicDatasetId(
      parsed.publicDatasetId,
      options,
      { verifyAndResolveTable: deps.verifyAndResolveTable }
    ),
    agentShortName: parsed.agentShortName || null,
    oneSentenceSummary: parsed.oneSentenceSummary || null,
    demoGuide: parsed.demoGuide,
    externalFiles: parsed.externalFiles || [],
    appliedFactors: parsed.appliedFactors || null,
    firestore: parsed.firestore || null,
    dataPreview: dataPreview,
  };
}
