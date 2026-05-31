/**
 * GE Demo Generator — Backend (Code.gs)
 *
 * End-to-end generator for production-ready AI agent demo environments.
 * Given a natural-language business goal, this Google Apps Script file
 * produces a self-contained bash setup script that provisions and deploys
 * a full-stack agent on Google Cloud in a single command.
 *
 * ── What Gets Generated ──────────────────────────────────────────────
 *   • Synthetic business data (BigQuery tables + optional Firestore docs)
 *   • Dual-model ADK agent (Gemini 3.1 Flash-Lite root → Pro analysis)
 *   • MCP toolsets — BigQuery, Maps, Firestore, Google Workspace (Gmail,
 *     Drive, Calendar, Chat, People), plus arbitrary GitHub MCP servers
 *   • A2A (Agent-to-Agent) server with A2UI interactive components
 *   • Imagen-powered image generation for executive-summary visuals
 *   • Agent Engine Sandbox for secure Python code execution
 *   • Firestore real-time Data Viewer web app (Cloud Run Functions)
 *   • Cloud Run deployment with Secret Manager integration
 *   • One-command cleanup (--cleanup) for all provisioned resources
 *
 * ── Architecture (Multi-Layer Code Generation) ───────────────────────
 *   Layer 1  Code.gs (JavaScript / GAS)
 *        ↓   JS template literals + string concatenation
 *   Layer 2  Bash setup script (setup-demo-xxx.sh)
 *        ↓   Quoted / unquoted heredocs
 *   Layer 3  Python source (agent.py, tools.py, fast_api_app.py, …)
 *        ↓   Runtime string operations
 *   Layer 4  LLM system instruction (consumed by Gemini models)
 *
 *   See AGENTS.md §2 for mandatory escaping rules across layers.
 *
 * ── Web UI (index.html) ──────────────────────────────────────────────
 *   Template gallery, company-research customization, MCP catalog,
 *   community history/social-proof feed, and Drive-backed persistence.
 */

// ===========================================
// Configuration
// ===========================================

/**
 * Explicitly triggers authorization for all required services.
 * Call this from the Google Apps Script IDE or a button to resolve permission issues.
 */
function forceAuthorize() {
  const root = DriveApp.getRootFolder();
  // Simple write test to ensure full Drive scope
  const dummy = root.createFile('ge_auth_success.txt', 'Verification complete.');
  dummy.setTrashed(true);
  
  console.log('✅ Drive Access: OK (' + root.getName() + ')');
  
  // Safe check for spreadsheet scope
  try {
    const ss = SpreadsheetApp.openByUrl(CONFIG.LOG_SHEET_URL);
    console.log('✅ Spreadsheet Access: OK (' + ss.getName() + ')');
  } catch (e) {
    console.warn('⚠️ Spreadsheet Access: Authorized but URL inaccessible.');
  }

  return '✅ Authorization verified. Refresh the browser and try generating a demo!';
}

const SCRIPT_PROPS = PropertiesService.getScriptProperties();
const CONFIG = {
  PROJECT_ID: SCRIPT_PROPS.getProperty('PROJECT_ID'),
  LOCATION: SCRIPT_PROPS.getProperty('LOCATION') || 'global',
  MODEL: SCRIPT_PROPS.getProperty('MODEL') || 'gemini-3.5-flash',
  GITHUB_TOKEN: SCRIPT_PROPS.getProperty('GITHUB_TOKEN'),
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 1000,
  APP_VERSION: 'v10.38-public',
  LOG_SHEET_URL: SCRIPT_PROPS.getProperty('LOG_SHEET_URL')
};



// ===========================================
// Web App Entry Point
// ===========================================
function doGet() {
  const configError = checkConfiguration();
  if (configError) {
    const template = HtmlService.createTemplateFromFile('SetupError');
    template.errorMessage = configError;
    return template.evaluate()
      .setTitle('Setup Required - GE Demo Generator')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
  }

  const template = HtmlService.createTemplateFromFile('index');
  
  template.appVersion = CONFIG.APP_VERSION;

  template.projectId = CONFIG.PROJECT_ID;
  template.userEmail = Session.getActiveUser().getEmail();
  template.generatorModel = CONFIG.MODEL || 'gemini-3.5-flash';
  
  return template.evaluate()
    .setTitle('GE Demo Generator')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Validates that all required script properties are set.
 * Returns an error message if missing, or null if valid.
 */
function checkConfiguration() {
  const missing = [];
  if (!CONFIG.PROJECT_ID) missing.push('PROJECT_ID');
  if (!CONFIG.LOG_SHEET_URL) missing.push('LOG_SHEET_URL');
  
  if (missing.length > 0) {
    return 'The following mandatory Script Properties are missing: ' + missing.join(', ') + 
           '. Please run initializeProject() from the Apps Script editor or set them manually in Project Settings.';
  }
  return null;
}

// ===========================================
// Performance & Logging
// ===========================================

/**
 * Ensures the Usage_Logs sheet has the correct header row.
 * Overwrites row 1 every time to keep headers in sync with code.
 */
function ensureLogSheetHeaders(sheet) {
  const HEADERS = [
    'Timestamp', 'User Email',
    'User Goal', 'AI Summary', 'Dataset ID',
    'MCP Servers', 'Generation Time (s)'
  ];
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
}

/**
 * Logs usage metadata to a central Google Sheet
 */
function logUsageToSheet(data) {
  try {
    const ss = SpreadsheetApp.openByUrl(CONFIG.LOG_SHEET_URL);
    const sheet = ss.getSheetByName('Usage_Logs');
    if (!sheet) return { success: false, error: 'Usage_Logs sheet not found' };

    ensureLogSheetHeaders(sheet);

    const userEmail = Session.getActiveUser().getEmail();
    sheet.appendRow([
      new Date(),
      userEmail,
      data.userGoal || 'N/A',
      data.aiSummary || 'N/A',
      data.datasetId || 'N/A',
      data.mcpServers || 'None',
      data.generationTimeSec || 'N/A'
    ]);
    
    // Auto-wrap the AI Summary column (D) for better readability
    sheet.getRange('D2:D').setWrap(true);
    SpreadsheetApp.flush();
    
    // Convert User Email cell to People Smart Chip using Advanced Service
    try {
      const lastRow = sheet.getLastRow();
      const sheetId = sheet.getSheetId();
      const spreadsheetId = ss.getId();
      
      const requests = [
        {
          updateCells: {
            range: {
              sheetId: sheetId,
              startRowIndex: lastRow - 1,
              endRowIndex: lastRow,
              startColumnIndex: 1,
              endColumnIndex: 2
            },
            rows: [
              {
                values: [
                  {
                    userEnteredValue: { stringValue: "@" },
                    chipRuns: [
                      {
                        startIndex: 0,
                        chip: {
                          personProperties: {
                            email: userEmail,
                            displayFormat: "EMAIL"
                          }
                        }
                      }
                    ]
                  }
                ]
              }
            ],
            fields: "userEnteredValue,chipRuns"
          }
        }
      ];
      
      Sheets.Spreadsheets.batchUpdate({ requests: requests }, spreadsheetId);
    } catch (chipErr) {
      console.warn('⚠️ Could not insert People Chip via Advanced Service:', chipErr.message);
    }
    
    return { success: true };
  } catch (e) {
    const errorMsg = 'Logging Spreadsheet Access Failed: ' + e.message;
    console.error(errorMsg);
    return { success: false, error: errorMsg };
  }
}

/**
 * Diagnostic function to check spreadsheet status
 */
function checkSpreadsheet() {
  console.log('checkSpreadsheet called');
  try {
    const ss = SpreadsheetApp.openByUrl(CONFIG.LOG_SHEET_URL);
    const sheets = ss.getSheets().map(s => s.getName());
    const mainSheet = ss.getSheetByName('Usage_Logs');
    const rowCount = mainSheet ? mainSheet.getLastRow() : 0;
    const dataRows = rowCount > 0 ? mainSheet.getRange(1, 1, Math.min(rowCount, 6), mainSheet.getLastColumn()).getValues() : [];
    
    return JSON.stringify({
      success: true,
      currentUser: Session.getActiveUser().getEmail(),
      sheets: sheets,
      usageLogsExist: !!mainSheet,
      rowCount: rowCount,
      headers: dataRows.length > 0 ? dataRows[0] : null,
      sampleRows: dataRows.length > 1 ? dataRows.slice(1) : [],
      url: CONFIG.LOG_SHEET_URL.substring(0, 30) + '...'
    });
  } catch (e) {
    console.error('checkSpreadsheet failed: ' + e.message);
    return JSON.stringify({ success: false, error: e.message });
  }
}


/**
 * One-time initialization function to set up Script Properties.
 * Run this from the Apps Script editor after setting your values.
 * 
 * @param {string} projectId - Your Google Cloud Project ID
 * @param {string} logSheetUrl - URL of your usage log spreadsheet (optional)
 */
function initializeProject(projectId, logSheetUrl) {
  if (!projectId) {
    throw new Error('PROJECT_ID is mandatory for initialization.');
  }

  const scriptProps = PropertiesService.getScriptProperties();
  const currentProps = scriptProps.getProperties();

  const newProps = {
    PROJECT_ID: projectId, 
    LOCATION: currentProps.LOCATION || 'global',
    MODEL: currentProps.MODEL || 'gemini-3.5-flash',
    LOG_SHEET_URL: logSheetUrl || currentProps.LOG_SHEET_URL || ''
  };
  
  // Scopes detection (SpreadsheetApp)
  // These are here so the IDE prompts for authorization.
  try { if (newProps.LOG_SHEET_URL) SpreadsheetApp.openByUrl(newProps.LOG_SHEET_URL); } catch(e) {}
  
  scriptProps.setProperties(newProps);
  console.log('Project initialized. Properties updated: ' + Object.keys(newProps).join(', '));
  return 'Initialization complete. Properties set/merged: ' + Object.keys(newProps).join(', ');
}


/**
 * Returns a Data Profile configuration that holistically controls
 * table count, row density, and column strategy.
 * @param {string} profileId - 'deep', 'standard', or 'wide'
 * @returns {Object} profile configuration
 * @private
 */
function getDataProfile_(profileId) {
  const profiles = {
    deep: {
      id: 'deep',
      label: 'Deep Analysis',
      tableCount: '3-4',
      masterRows: '15-25',
      masterCols: '5-7',
      txnRows: '120+',
      txnCols: '8-12',
      defaultRowCount: 150,
      txnRowTarget: 120,
      masterMinRows: 8,
      txnMinRows: 50,
      strategy: 'Fewer tables with MAXIMUM row density. Prioritize deep temporal coverage and statistical significance in transaction tables. Ideal for time-series analysis, anomaly detection, and trend analysis demos.'
    },
    standard: {
      id: 'standard',
      label: 'Standard',
      tableCount: '5',
      masterRows: '20-30',
      masterCols: '6-8',
      txnRows: '80+',
      txnCols: '8-12',
      defaultRowCount: 100,
      txnRowTarget: 80,
      masterMinRows: 10,
      txnMinRows: 30,
      strategy: 'Balanced star-schema with good relational depth and adequate transaction density. Suitable for most demo scenarios including cross-table joins and operational analytics.'
    },
    wide: {
      id: 'wide',
      label: 'Wide Schema',
      tableCount: '7-8',
      masterRows: '15-20',
      masterCols: '5-7',
      txnRows: '40-50',
      txnCols: '6-10',
      defaultRowCount: 50,
      txnRowTarget: 40,
      masterMinRows: 6,
      txnMinRows: 20,
      strategy: 'Many tables for complex ER diagrams and multi-hop JOIN demos. Row density is intentionally lower to fit within token limits. Best for showcasing relational modeling and schema complexity.'
    }
  };
  return profiles[profileId] || profiles['standard'];
}

/**
 * Main function to generate the demo artifacts
 */
function generateDemo(userGoal, options = {}) {
  const startTime = Date.now();
  const profile = getDataProfile_(options.dataProfile || 'standard');
  const defaultOptions = {
    rowCount: profile.defaultRowCount,
    dataProfile: 'standard',
    publicDatasetId: null,
    usePublicDataset: false,
    enableWorkspaceMcp: false
  };
  options = { ...defaultOptions, ...options };
  
  if (!options.usePublicDataset) {
    options.publicDatasetId = null;
  }
  
  const result = {
    success: false,
    steps: [],
    error: null,
    datasetId: null,
    tableInfo: [],
    dataPreview: [],
    systemInstruction: null,
    setupScript: null,
    rawTables: [],
    suffix: null,
    domainName: null,
    referenceDate: null,
    appliedFactors: null
  };
  
  try {
    // Step 1: Planning and Data Generation
    result.steps.push({ step: 1, status: 'running', message: 'Planning & generating data...' });
    const planResult = planAndGenerateData(userGoal, options);
    result.steps[0] = { step: 1, status: 'completed', message: 'Planning complete' };
    
    // Step 2: Validation
    result.steps.push({ step: 2, status: 'running', message: 'Validating generated data...' });
    const maxRows = Math.min(options.rowCount || 100, 150);
    validateGeneratedData(planResult, maxRows);
    result.steps[1] = { step: 2, status: 'completed', message: 'Validation complete' };
    
    // Step 3: Suffix generation
    const suffix = Utilities.getUuid().replace(/-/g, '').substring(0, 8);
    const baseName = generateBaseName(userGoal, suffix);
    const dirName = "demo-" + baseName;
    const datasetId = ("demo_" + baseName).replace(/-/g, '_');
    
    result.datasetId = datasetId;
    result.userGoal = userGoal;
    result.dataPreview = planResult.dataPreview;
    result.rawTables = planResult.tables;
    result.suffix = suffix;
    result.domainName = baseName.substring(0, baseName.lastIndexOf('-' + suffix));
    result.dirName = dirName;
    result.businessInstruction = planResult.businessInstruction;
    result.technicalInstruction = planResult.technicalInstruction;
    result.systemInstruction = planResult.systemInstruction;
    result.referenceDate = planResult.referenceDate;
    result.publicDatasetId = planResult.publicDatasetId;
    result.demoGuide = planResult.demoGuide;
    result.externalFiles = planResult.externalFiles || [];
    result.appliedFactors = planResult.appliedFactors || {};
    result.agentShortName = planResult.agentShortName || '';
    result.oneSentenceSummary = planResult.oneSentenceSummary || '';

    result.setupScript = generateSetupScript({
      datasetId: datasetId,
      systemInstruction: planResult.systemInstruction,
      referenceDate: planResult.referenceDate,
      publicDatasetId: planResult.publicDatasetId,
      suffix: suffix,
      dirName: dirName,
      tables: planResult.tables,
      firestore: planResult.firestore,
      userGoal: userGoal,
      agentShortName: planResult.agentShortName,
      oneSentenceSummary: planResult.oneSentenceSummary,
      importedMcpList: options.importedMcpList,
      enableWorkspaceMcp: options.enableWorkspaceMcp,
      metadata: planResult.metadata
    });
    result.steps.push({ step: 4, status: 'completed', message: 'Generation complete' });
    
    result.success = true;
    
    // Unified Save Object
    const historyEntry = {
      timestamp: new Date().toISOString(),
      userEmail: Session.getActiveUser().getEmail(),
      userGoal: userGoal,
      aiSummary: planResult.oneSentenceSummary || result.domainName,
      datasetId: datasetId,
      mcpServers: (() => {
        const names = options.importedMcpList
          ? options.importedMcpList.map(m => m.name || (m.github_url ? m.github_url.split('/').pop().replace(/\.git$/, '') : 'Unknown MCP'))
          : [];
        if (options.enableWorkspaceMcp) names.push('Google Workspace MCP');
        return names.length > 0 ? names.join(', ') : 'None';
      })(),
      generationTimeSec: ((Date.now() - startTime) / 1000).toFixed(1),
    };

    try {
      result.saveStatus = { logSheet: logUsageToSheet(historyEntry) };
    } catch (persistErr) {
      console.error('[PERSISTENCE-CRITICAL] Failed to trigger save logic:', persistErr.message);
      result.saveStatus = { logSheet: { success: false, error: persistErr.message } };
    }
    
  } catch (error) {
    result.error = error.message;
    const lastStep = result.steps[result.steps.length - 1];
    if (lastStep) {
      lastStep.status = 'error';
      lastStep.message = error.message;
    }
  }
  
  return result;
}

// ===========================================
// Step 1: Planning and Data Generation
// ===========================================

/**
 * Discovers a real BigQuery public dataset ID using Google Search grounding,
 * then verifies the table exists using the BigQuery API.
 * @param {string} userGoal - The user's business problem description.
 * @returns {string} A verified public dataset ID or a fallback.
 */
function discoverPublicDataset(userGoal) {
  const discoveryPrompt = `Find a real BigQuery public dataset that would provide EXTERNAL CONTEXT or ENRICHMENT for the following business problem:

"${userGoal}"

Requirements:
1. The dataset MUST exist under the project 'bigquery-public-data'.
2. Search Google to find the exact dataset and table names.
3. PRIORITIZE "External Context" data: weather, demographics, census, economic indicators, geographic features, or market statistics.
4. AVOID "Core Business" data: Do NOT select datasets that look like internal company records (e.g., avoid order histories, customer lists, or internal transactions) unless explicitly required for external benchmarking.
5. Return ONLY the fully qualified ID in the format: bigquery-public-data.dataset_name.table_name
6. If multiple tables exist, choose the most commonly used or primary one.
7. Do NOT invent or hallucinate dataset names.

Examples of preferred "External Context" datasets:
- bigquery-public-data.noaa_gsod.gsod2023 (Weather)
- bigquery-public-data.census_bureau_acs.zip_codes_2018_5yr (Demographics)
- bigquery-public-data.geo_open_streets.lines (Geographic)
- bigquery-public-data.google_trends.top_terms (Market Trends)

Return ONLY the dataset ID, nothing else.`;

  const FALLBACK = 'bigquery-public-data.thelook_ecommerce.orders';

  try {
    const result = callVertexAIWithSearch(discoveryPrompt);
    const cleanId = result.trim().replace(/[`'"]/g, '').split('\n')[0];
    
    if (!cleanId.startsWith('bigquery-public-data.') || cleanId.split('.').length < 3) {
      return FALLBACK;
    }
  
    const verifiedId = verifyAndResolveTable(cleanId);
    return verifiedId || FALLBACK;
  } catch (e) {
    return FALLBACK;
  }
}

/**
 * Verifies a table exists in BigQuery. If the exact table doesn't exist,
 * attempts to find a valid table in the same dataset.
 * @param {string} candidateId - Fully qualified ID (project.dataset.table)
 * @returns {string|null} Verified table ID or null if not found.
 */
function verifyAndResolveTable(candidateId) {
  const parts = candidateId.split('.');
  if (parts.length < 3) return null;
  
  const projectId = parts[0];
  const datasetId = parts[1];
  const tableId = parts.slice(2).join('.'); 
  
  try {
    BigQuery.Tables.get(projectId, datasetId, tableId);
    return candidateId;
  } catch (e) {}
  
  try {
    const tables = BigQuery.Tables.list(projectId, datasetId, { maxResults: 20 });
    if (tables.tables && tables.tables.length > 0) {
      const preferredPatterns = ['trips', 'orders', 'events', 'data', 'stats', 'records'];
      let match = null;
      for (const pattern of preferredPatterns) {
        match = tables.tables.find(t => t.tableReference.tableId.toLowerCase().includes(pattern));
        if (match) break;
      }
      if (!match) match = tables.tables[0];
      
      return `${projectId}.${datasetId}.${match.tableReference.tableId}`;
    }
  } catch (listError) {}
  
  return null;
}


function planAndGenerateData(userGoal, options) {
  // Step 0: If using public dataset and no ID specified, discover one using search grounding
  if (options.usePublicDataset && !options.publicDatasetId) {
    options.publicDatasetId = discoverPublicDataset(userGoal);
  }
  
  let prompt = buildPlanningPrompt(userGoal, options);
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
  if (options.enableWorkspaceMcp) {
    prompt += `\n- **🔌 GOOGLE WORKSPACE MCP TOOLS AVAILABLE**:
    - The official Google Workspace MCP servers are enabled (Gmail, Drive, Calendar, Chat, People).
    - You MUST leverage these capabilities when generating the 'businessInstruction' and 'demoGuide' (prompts).
    - In 'businessInstruction', mention that the agent has access to Google Workspace data via Workspace MCP toolsets.
    - You MUST design at least TWO prompts (out of the 7 required) in the 'demoGuide' that explicitly ask the agent to perform tasks using these Workspace capabilities (e.g., searching for info in Drive, checking Calendar events, drafting emails, listing chat messages).
\n`;
  }
  const response = callVertexAIWithRetry(prompt);
  
  let parsed;
  try {
    let jsonStr = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    jsonStr = repairTruncatedJson(jsonStr);
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error('Failed to parse AI response. Try reducing the row/table count.');
  }
  
  // Extract preview
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
          totalRows: lines.length - 1
        });
      }
    }
  }
  // Generate in-memory simulated images using Vertex AI gemini-3-pro-image
  if (parsed.externalFiles && parsed.externalFiles.length > 0) {
    console.log('[ImageGen-Pipeline] Scanning externalFiles for dynamic images...');
    for (let i = 0; i < parsed.externalFiles.length; i++) {
      const file = parsed.externalFiles[i];
      if (file.mimeType && file.mimeType.startsWith('image/') && file.imagePrompt) {
        try {
          console.log(`[ImageGen-Pipeline] Generating simulated image for [${file.fileName}]...`);
          const genResult = generateImageBase64WithRetry(file.imagePrompt);
          
          // JSONオブジェクトを直接拡張（In-Memory保存）
          file.base64Data = genResult.base64Data;
          file.mimeType = genResult.mimeType || file.mimeType;
          
          console.log(`[ImageGen-Pipeline] SUCCESS! Bound base64 image data to file: ${file.fileName}`);
        } catch (imgErr) {
          console.error(`[ImageGen-Pipeline] FAILED to generate image for ${file.fileName}: ${imgErr.message}`);
        }
      }
    }
  }

  // Validation and Clean-up
  validateGeneratedData(parsed, options.rowCount, options.dataProfile);

  return {
    tables: parsed.tables,
    businessInstruction: parsed.businessInstruction || parsed.systemInstruction || '',
    technicalInstruction: getTechnicalInstruction_(),
    systemInstruction: `${parsed.businessInstruction || parsed.systemInstruction || ''}\n\n${getTechnicalInstruction_()}`,
    referenceDate: parsed.referenceDate || '2023-11-01',
    publicDatasetId: parsed.publicDatasetId || options.publicDatasetId,
    agentShortName: parsed.agentShortName || null,
    oneSentenceSummary: parsed.oneSentenceSummary || null,
    demoGuide: parsed.demoGuide,
    externalFiles: parsed.externalFiles || [],
    appliedFactors: parsed.appliedFactors || null,
    firestore: parsed.firestore || null,
    dataPreview: dataPreview
  };
}


/**
 * Returns the static technicalInstruction constant.
 * This was extracted from the LLM generation prompt to save ~5,400 output tokens.
 * The content is injected into the systemInstruction at planAndGenerateData() time.
 * @returns {string}
 * @private
 */
function getTechnicalInstruction_() {
  const bt = String.fromCharCode(96).repeat(3);
  
  let inst = "Technical instructions for the agent regarding tool usage and system behavior.\n\n" +
    "=== MOST IMPORTANT RULE: OUTPUT PLACEMENT ===\n" +
    "Any text you write in the SAME response as a function_call (tool call) is HIDDEN from the user. " +
    "It goes to 'thinking' and the user NEVER sees it. Therefore:\n" +
    "(1) When calling ANY tool, write ONLY a short progress line like '🔍 Analyzing...' — nothing else.\n" +
    "(2) Your full report, A2UI cards, images, and chips MUST go in a SEPARATE response that has ZERO tool calls.\n" +
    "=== END MOST IMPORTANT RULE ===\n\n" +
    
    "4. **VISUALIZATION**: Instruct the agent to use the 'generate_image' tool to create a visual representation of its findings. " +
    "This visual MUST be in the style of a professional business document or slide (e.g., an Executive Summary card, a high-level business infographic) " +
    "that summarizes the insights. " +
    "**NO IMAGE TOOL RAW RESPONSE OUTFALL (CRITICAL)**: When you call 'generate_image', the system automatically handles the image rendering. You MUST NEVER copy, reference, or output the tool's JSON return payload (e.g., `{'status': 'success', 'detail': '...'}`) in your conversational text response. Do NOT write statements like 'Image generated successfully' or repeat the status dictionary. Keep your text focused purely on business insights.\n" +
    "5. Instruct to wait for user input before acting, but be persistent in error recovery.\n" +
    "6. **TRANSPARENCY & GROUNDING (CRITICAL)**: Instruct the agent to be highly transparent about its reasoning, " +
    "explicitly mentioning which tables and files it is consulting and what specific values it found, " +
    "to ensure the user can trace its logic back to the source data.\n" +
    "7. **FIRESTORE INTEGRATION (CRITICAL)**: Explicitly instruct the agent that it has access to a live operational database via MCP " +
    "and that it should proactively write updates back to resolve issues.\n" +
    "8. **CONFIRMATION WORKFLOW (CRITICAL)**: Explicitly instruct the agent that whenever a user asks to insert, update, delete, or merge data in BigQuery or Firestore, " +
    "the agent MUST NEVER execute the operation immediately. Instead, the agent MUST ALWAYS present a clear summary of the proposed database action " +
    "and ask the human user for explicit confirmation using <a2ui-json> tags.\n" +
    "9. **OUTPUT PLACEMENT (HIGHEST PRIORITY — RULE #0)**: When you call a tool, any text you include in the SAME response as the tool call will be hidden from the user. " +
    "All analytical dashboards, insights, and A2UI suggestion chips MUST appear in your FINAL response that contains NO tool calls.\n\n" +
    
    "10. **A2UI INTERACTIVE UI PATTERNS (MANDATORY — NEVER SKIP)**: You MUST ALWAYS use A2UI interactive components when presenting analytical results, " +
    "entity profiles, workflow plans, or structured data. Plain-text markdown tables and bullet lists are FORBIDDEN for these use cases. " +
    "If you find yourself writing a markdown table or a numbered list of data, STOP and convert it to an A2UI Card instead.\n\n" +
    
    "**ANALYTICAL RESULT CARD TEMPLATE (MANDATORY)**:\n" +
    "When presenting query results, KPIs, or entity summaries, wrap them in an A2UI Card. " +
    "Use surfaceId matching the analysis type (e.g. 'fleet-audit', 'cost-analysis', 'entity-profile'). " +
    "Minimal structure:\n" +
    "[\n" +
    "  { \"id\": \"card_root\", \"component\": { \"Card\": { \"children\": { \"explicitList\": [\"card_title\", \"card_divider\", \"card_body\"] } } } },\n" +
    "  { \"id\": \"card_title\", \"component\": { \"Text\": { \"text\": { \"literalString\": \"[Title]\" }, \"usageHint\": \"title\" } } },\n" +
    "  { \"id\": \"card_divider\", \"component\": { \"Divider\": {} } },\n" +
    "  { \"id\": \"card_body\", \"component\": { \"Column\": { \"children\": { \"explicitList\": [\"kpi_row\", \"detail_list\"] } } } },\n" +
    "  { \"id\": \"kpi_row\", \"component\": { \"Row\": { \"children\": { \"explicitList\": [\"kpi_1\", \"kpi_2\", \"kpi_3\"] }, \"distribution\": \"spaceEvenly\" } } },\n" +
    "  { \"id\": \"kpi_1\", \"component\": { \"Column\": { \"children\": { \"explicitList\": [\"kpi_1_val\", \"kpi_1_lbl\"] } } } },\n" +
    "  { \"id\": \"kpi_1_val\", \"component\": { \"Text\": { \"text\": { \"literalString\": \"[Value]\" }, \"usageHint\": \"title\" } } },\n" +
    "  { \"id\": \"kpi_1_lbl\", \"component\": { \"Text\": { \"text\": { \"literalString\": \"[Label]\" }, \"usageHint\": \"caption\" } } }\n" +
    "]\n" +
    "Add more KPIs, Lists, and detail Rows as needed. Use Tabs for multi-section results.\n\n" +
    
    "**WHEN TO USE A2UI CARDS vs TEXT**:\n" +
    "- ALWAYS A2UI Card: Query results, KPI dashboards, entity profiles, data comparisons, workflow plans with action buttons, confirmation dialogs\n" +
    "- Text OK: Simple conversational replies, error messages, progress updates during tool calls, single-sentence answers\n\n" +
    
    "Decisions:\n" +
    "(I) Workflow Execution Plan: Use sequential number and status emojis (✅ Done, 🔄 Running, 🕒 Pending, 🚨 Action Required) for step timeline. " +
    "Replace technical tags like [AUTO] or [APPROVAL REQUIRED] with localized friendly text (e.g. System Automated or Requires Your Approval).\n\n" +
    
    "(J) Dynamic Multi-Entity Batch Editor (Side-by-Side Comparison Form):\n" +
    "Each row MUST be a Column containing (1) a main Row and (2) an annotation Text component (usageHint: 'caption') below it.\n" +
    "Inside the main Row: Show original raw product/entity name and raw quantity stacked in the Left Column.\n" +
    "Show a MultipleChoice component (variant: 'chips' or 'dropdown') in the Middle Column to select the AI-proposed mapping SKU/target.\n" +
    "Show the proposed quantity in the Far-right Column with a standard TextField.\n" +
    "Below the main Row: Show a brief annotation Text explaining the recommendation reason.\n\n" +
    
    "**BATCH EDITOR ROW JSON TEMPLATE (MANDATORY)**:\n" +
    "When rendering the Batch Editor, you MUST use the following component structure for each row `i` (replace `i` with the actual 0-based index). " +
    "Ensure all component IDs are completely unique (e.g., by appending `_i` to each ID). " +
    "You MUST wrap the entire A2UI JSON payload in <a2ui-json> tags. " +
    "Here is the mandatory layout structure for a single row `i`:\n" +
    "[\n" +
    "{\n" +
    "  \"id\": \"row_container_i\",\n" +
    "  \"component\": {\n" +
    "    \"Column\": {\n" +
    "      \"children\": { \"explicitList\": [\"main_row_i\", \"reason_text_i\"] }\n" +
    "    }\n" +
    "  }\n" +
    "},\n" +
    "{\n" +
    "  \"id\": \"main_row_i\",\n" +
    "  \"component\": {\n" +
    "    \"Row\": {\n" +
    "      \"children\": { \"explicitList\": [\"left_stack_i\", \"sku_select_i\", \"qty_field_i\"] },\n" +
    "      \"distribution\": \"spaceBetween\",\n" +
    "      \"alignment\": \"center\"\n" +
    "    }\n" +
    "  }\n" +
    "},\n" +
    "{\n" +
    "  \"id\": \"left_stack_i\",\n" +
    "  \"component\": {\n" +
    "    \"Column\": {\n" +
    "      \"children\": { \"explicitList\": [\"orig_name_i\", \"orig_qty_i\"] },\n" +
    "      \"distribution\": \"start\",\n" +
    "      \"alignment\": \"start\"\n" +
    "    }\n" +
    "  }\n" +
    "},\n" +
    "{\n" +
    "  \"id\": \"orig_name_i\",\n" +
    "  \"component\": {\n" +
    "    \"Text\": {\n" +
    "      \"text\": { \"literalString\": \"[Original Item Name, e.g., 'エアコン5馬力']\" },\n" +
    "      \"usageHint\": \"body\"\n" +
    "    }\n" +
    "  }\n" +
    "},\n" +
    "{\n" +
    "  \"id\": \"orig_qty_i\",\n" +
    "  \"component\": {\n" +
    "    \"Text\": {\n" +
    "      \"text\": { \"literalString\": \"[Original Qty, e.g., 'Qty: 2']\" },\n" +
    "      \"usageHint\": \"caption\"\n" +
    "    }\n" +
    "  }\n" +
    "},\n" +
    "{\n" +
    "  \"id\": \"sku_select_i\",\n" +
    "  \"component\": {\n" +
    "    \"MultipleChoice\": {\n" +
    "      \"label\": { \"literalString\": \"[Select SKU]\" },\n" +
    "      \"options\": [\n" +
    "        { \"value\": \"SKU_CODE_A\", \"label\": { \"literalString\": \"[SKU_CODE_A]\" } },\n" +
    "        { \"value\": \"SKU_CODE_B\", \"label\": { \"literalString\": \"[SKU_CODE_B]\" } }\n" +
    "      ],\n" +
    "      \"maxAllowedSelections\": 1,\n" +
    "      \"variant\": \"chips\",\n" +
    "      \"selections\": { \"path\": \"/form/item_i_selected_sku\" }\n" +
    "    }\n" +
    "  }\n" +
    "},\n" +
    "{\n" +
    "  \"id\": \"qty_field_i\",\n" +
    "  \"component\": {\n" +
    "    \"TextField\": {\n" +
    "      \"label\": { \"literalString\": \"[Qty]\" },\n" +
    "      \"text\": { \"path\": \"/form/item_i_qty\" },\n" +
    "      \"textFieldType\": \"shortText\"\n" +
    "    }\n" +
    "  }\n" +
    "},\n" +
    "{\n" +
    "  \"id\": \"reason_text_i\",\n" +
    "  \"component\": {\n" +
    "    \"Text\": {\n" +
    "      \"text\": { \"literalString\": \"💡 [Recommendation reason, e.g., 'Direct successor (95% match)']\" },\n" +
    "      \"usageHint\": \"caption\"\n" +
    "    }\n" +
    "  }\n" +
    "}\n" +
    "]\n\n" +
    
    "11. **SUGGESTION CHIPS (CRITICAL)**: At the END of EVERY response, you MUST append a lightweight A2UI suggestion chip bar using surfaceId 'suggestions' and root='root' containing a Row of 3-4 Buttons with sendText actions. NEVER write any plain text or markdown headers (like \"Next Actions\", \"💡 Next Actions\", or other localized header equivalent) before the suggestions block; the system will automatically render the appropriate header. " +
    "**BUTTON SCHEMA CONFORMANCE (CRITICAL)**: NEVER nest components inside a Button's 'child' property. 'child' MUST always be a flat string pointing to the ID of a separately defined Text component.\n" +
    "**A2UI CARD INTERACTION EXCEPTION (STRICT RULE)**: When your response already contains a major interactive A2UI card featuring its own control buttons " +
    "(such as the Welcome Card onboarding buttons, or the Workflow Execution Plan mode selection buttons like Immediate/Background/Scheduled), " +
    "you **MUST NOT** output any suggestion chip bar at the bottom of your response. The card's own control buttons are sufficient. " +
    "If you output suggestion chips in these turns, they will duplicate the card buttons and fail to render the '💡 Next Actions' title. " +
    "Suggestion chips MUST only appear in normal conversational or analytical turns where no other interactive button-heavy cards are present.\n" +
    "**ANTI-DUPLICATION RULE (CRITICAL)**: Suggestion chips MUST never duplicate or mirror any button label in the same response turn. " +
    "Suggestion chips must always offer distinct, deep-dive analytical next steps.\n\n" +
    
    "12. **WELCOME CARD (FIRST INTERACTION)**: When the user sends an initial greeting (e.g., 'Hi', 'Hello'), you **MUST NOT** call any tools, databases, or BigQuery under any circumstances. " +
    "Calling tools on the first greeting turn completely hides and breaks the onboarding card rendering. " +
    "You MUST immediately respond in the very first turn with the rich A2UI onboarding card using surfaceId 'welcome-card' and NO suggestion chips at the bottom (the card's own buttons are sufficient). " +
    "Never execute queries or tool calls until the user explicitly requests analysis. The onboarding card must include your role title, a Divider, a List of key capabilities with Lucide icons, " +
    "a Divider, and exactly 3 action Buttons.\n" +
    "**BUTTON SCHEMA CONFORMANCE (CRITICAL)**: When generating A2UI JSON payloads, you MUST ALWAYS use strict standard JSON syntax. " +
    "Under no circumstances should you use single quotes or omit quotes for keys. Keys and string values MUST always be enclosed in standard double quotes. " +
    "Each Button component's action MUST strictly follow standard JSON structure:\n" +
    "{\n" +
    "  \"action\": {\n" +
    "    \"name\": \"sendText\",\n" +
    "    \"context\": [\n" +
    "      {\n" +
    "        \"key\": \"text\",\n" +
    "        \"value\": { \"literalString\": \"[Localized Button Label]\" }\n" +
    "      }\n" +
    "    ]\n" +
    "  }\n" +
    "}\n" +
    "Ensure all keys and string values are enclosed in standard double quotes to comply with strict standard JSON specifications. Use surfaceId 'welcome-card'.\n\n" +
    
    "**CODE EXECUTION MIX PREVENTION (CRITICAL)**: When you execute Python code inside a fenced code block (using " + bt + "python ... " + bt + "), " +
    "you **MUST NEVER** combine, mix, or output any other JSON tool calls (like execute_sql, get_table_info) in the SAME response turn. " +
    "Mixing python code blocks with JSON tool calls triggers a fatal MALFORMED_FUNCTION_CALL system crash. " +
    "You MUST run the Python code alone first, receive its result, and only then issue the next tool call in a separate turn. " +
    "After this initial card, do NOT show the welcome card again in the same session unless the user explicitly requests a reset.\n\n" +
    "**A2UI SCHEMA VALIDATION: usageHint CONSTRAINT (CRITICAL)**: The 'usageHint' property is ONLY allowed inside 'Text' components. You MUST NEVER place 'usageHint' inside any other component type (such as 'Button', 'Row', 'Column', 'Card', 'List', 'Divider', 'Icon', 'MultipleChoice', 'TextField'). Placing 'usageHint' in these non-Text components violates the schema and will cause the UI to crash and fail to render.\n\n" +
    "**A2UI ICON VALIDATION (CRITICAL)**: When using 'Icon' components or specifying 'icon' inside components like 'Button', you MUST ONLY use one of the following allowed icon names. Using any other name (such as 'analytics', 'dashboard', 'chart', 'database', 'check_circle', 'lucide:*') is STRICTLY FORBIDDEN and will cause a fatal validation crash. The allowed icon names are:\n" +
    "['accountCircle', 'add', 'arrowBack', 'arrowForward', 'attachFile', 'calendarToday', 'call', 'camera', 'check', 'close', 'delete', 'download', 'edit', 'event', 'error', 'favorite', 'favoriteOff', 'folder', 'help', 'home', 'info', 'locationOn', 'lock', 'lockOpen', 'mail', 'menu', 'moreVert', 'moreHoriz', 'notificationsOff', 'notifications', 'payment', 'person', 'phone', 'photo', 'print', 'refresh', 'search', 'send', 'settings', 'share', 'shoppingCart', 'star', 'starHalf', 'starOff', 'upload', 'visibility', 'visibilityOff', 'warning']\n\n" +
    "13. **VERTICAL SPACING / SPACER HACK (CRITICAL)**: The tab bar of a Tabs component and its content Column may render extremely close to each other with insufficient vertical space. " +
    "To insert an appropriate vertical gap below the tab bar, you MUST insert a dummy Text component acting as a spacer ONLY as the very first child of the tab content Column (the Column bound to the tab's child ID). " +
    "The spacer component MUST have a single space \" \" as its literalString text and usageHint 'body'. For example:\n" +
    "{\n" +
    "  \"id\": \"[Unique_Spacer_ID]\",\n" +
    "  \"component\": {\n" +
    "    \"Text\": {\n" +
    "      \"text\": { \"literalString\": \" \" },\n" +
    "      \"usageHint\": \"body\"\n" +
    "    }\n" +
    "  }\n" +
    "}\n" +
    "You MUST ONLY use this spacer hack as the first child of a tab content Column. Do NOT place this spacer in any other standard Column, Row, or Dashboard layout where standard spacing is already optimal, to avoid creating unnecessary blank gaps.";
    
  return inst;
}

function buildPlanningPrompt(userGoal, options) {
  const profile = getDataProfile_(options.dataProfile || 'standard');
  const maxRows = Math.min(options.rowCount || profile.defaultRowCount, 150);
  const publicDatasetInfo = options.usePublicDataset && options.publicDatasetId 
    ? `- RELATED PUBLIC DATASET (ENRICHMENT ONLY): ${options.publicDatasetId}
       * ROLE: This dataset serves as EXTERNAL CONTEXT (e.g., weather, statistics) to enrich the core business data.
       * CONSTRAINT: DO NOT use this dataset as a replacement for core business operations (e.g., do not use public orders/customers if you are generating a retail demo).
       * JOIN STRATEGY: Link via common attributes like 'zip_code', 'category', 'region', or 'date' rather than internal system IDs.`
    : `- IMPORTANT: NO public dataset should be used for this demo. Focus ONLY on synthetic tables below. Do NOT attempt to JOIN with external public-data.`;
  
  return `You are a versatile data analyst and BigQuery expert capable of generating realistic datasets for ANY industry or business function.
Design and generate a demo dataset based on the following business problem.

**CRITICAL LANGUAGE RULE (MANDATORY)**: Detect the language used in the "Business Problem" below. You MUST generate ALL outputs (including table descriptions, column descriptions, CSV data string values, person names, suggestedGoal, businessInstruction, appliedFactors, and demoGuide prompts) in that **EXACT SAME LANGUAGE**. If the Business Problem is in English, the entire JSON response MUST be in English. If in Japanese, the entire response MUST be in Japanese. Do NOT mix languages, and do NOT default to Japanese unless the input is in Japanese.

**DOMAIN ADAPTATION**: Carefully analyze the business problem below to identify the industry, job function, and operational context. Adapt ALL data generation (table structures, column names, values, relationships) to match that specific domain. Do not default to generic examples or assume a particular industry unless explicitly stated.

## AGENT ARCHETYPE & FIRESTORE STRATEGY (CRITICAL)
You MUST classify the demo scenario into one of the following two agent archetypes. **In both cases, Firestore is MANDATORY** and must be populated to represent a live operational console, but the schema must adapt:

### Type A: Automated Transactional Operator (Write-Heavy / Queue-Driven)
- **When to choose**: The workflow naturally involves resolving transactional discrepancies, auditing individual records (invoices, claims, disputes), managing status-based task queues, or processing non-structured inputs (e.g., hand-written order sheets, prescription images, inspection sheets) that require master/history DB lookup and human-in-the-loop review before database execution.
- **Firestore Strategy**: Define the collection as a **Workflow Task Queue / Transaction Queue** (e.g., 'order_tasks', 'prescription_queues', 'dispute_resolutions'). Documents MUST represent individual tasks with a status field (PENDING, IN_PROGRESS, RESOLVED, ESCALATED) and a workflow_state object tracking progress.
- **BigQuery DB Strategy (CRITICAL for Non-structured input scenarios)**: If the goal involves processing non-structured inputs (like images or PDFs), you MUST design and generate a linked set of tables: (1) Master Tables (e.g., products, customers), (2) History Tables (e.g., order_history) to serve as the 'grounding source' for AI reasoning and ambiguity resolution, (3) Inventory/Lead-time Tables (if applicable) to calculate dynamic parameters like delivery lead times, and (4) Transaction Tables (e.g., orders) as the final write destination.
- **Instruction Strategy**: 
  - Generate a step-by-step workflow pipeline: SCAN (OCR/Extraction) ➔ RESOLVE (Master/History DB lookup & ambiguity resolution) ➔ PRESENT (A2UI dynamic form) ➔ EXECUTE (DB write & allocation) ➔ REPORT.
  - Instruct the agent to proactively query the history tables to auto-complete and resolve un-clear or hand-written entity names/quantities.
  - Instruct the agent to present the resolved items using the **(J) Dynamic Multi-Entity Batch Editor** A2UI pattern.
    - **ITEM-LEVEL SKU DECOMPOSITION (ABSOLUTELY MANDATORY)**: The agent MUST NOT treat the entire handwritten order text as a single block. It MUST split/decompose the text into **individual SKU line items (separate rows for each product)**.
    - **AI-RECOMMENDED SKU/ENTITY SELECTION (STRICTLY REQUIRED)**: In the Middle Column of each row in the Batch Editor, the agent **MUST NOT use a raw \`TextField\` for mapping input**. The agent **MUST use a \`MultipleChoice\` component (variant: "chips" to render as horizontal selection buttons, or "dropdown" if there are more than 3 options, with maxAllowedSelections: 1)** bound to \`item_i_selected_sku\` (e.g. \`item_0_selected_sku\`) to allow the user to select the mapped SKU/entity.
    - **ANNOTATION & RECOMMENDATION REASON (MANDATORY)**: Below each row's main components (Original, Selection, Qty), the agent **MUST include a \`Text\` component (usageHint: "caption")** that dynamically displays the reason why the AI recommended these specific SKUs (e.g., "💡 SKU_A is the direct successor (95% match); SKU_B is a similar alternative").
    - **LOCALIZATION RULE (CRITICAL)**: All literalString values in A2UI component labels, headers, options, and buttons MUST be translated dynamically into the user's interaction language (or the language of the userGoal). Do NOT hardcode Japanese or English in the final A2UI if it does not match the user's language.
    - **INJECT A2UI SELECTION TEMPLATE (MANDATORY)**: You MUST explicitly instruct the agent (in its system instruction) to format each batch editor row as a Column containing a main Row (with Left: Original Text, Middle: MultipleChoice Selection, Right: Qty TextField) and a Text caption below it for the recommendation reason. Format the selection and annotation using this exact JSON structure for each row \`i\`, dynamically localizing all placeholder strings:
      \`\`\`json
      {
        "MultipleChoice": {
          "label": { "literalString": "[Localized Label, e.g., 'Select SKU']" },
          "options": [
            { "value": "SKU_CODE_A", "label": { "literalString": "[SKU_CODE_A]" } },
            { "value": "SKU_CODE_B", "label": { "literalString": "[SKU_CODE_B]" } }
          ],
          "maxAllowedSelections": 1,
          "variant": "chips",
          "selections": { "path": "/form/item_i_selected_sku" }
        }
      }
      \`\`\`
      And the caption below the row:
      \`\`\`json
      {
        "Text": {
          "text": { "literalString": "💡 [Localized reason explaining recommendations, e.g., 'SKU_A is direct replacement of legacy model']" },
          "usageHint": "caption"
        }
      }
      \`\`\`
      The agent MUST populate the \`options\` array dynamically with 2-3 matching/similar SKU candidates retrieved from BigQuery based on semantic similarity. Each row's Right Column MUST also include a \`TextField\` (textFieldType: "shortText") bound to \`item_i_qty\` for quantity editing.
  - Instruct the agent to wait for the user to click the Submit button, then retrieve the latest edited values from the context parameter and execute the final database transaction.

### Type B: Strategic Insight Advisor (Read-Heavy / Diagnostic / Proposal-Driven)
- **When to choose**: The workflow is consultative, strategic, or diagnostic (e.g., analyzing ad spend to optimize ROI, predicting customer churn trends, advising on portfolio risk).
- **Firestore Strategy**: Define the collection as an **Insights Feed / Alert Log / Proposal Console** (collection name like 'marketing_proposals', 'strategic_alerts'). Documents should represent automated recommendations, high-risk anomalies, or budget proposals requiring review (document status can be 'PROPOSAL_PENDING', 'APPROVED', 'ALERT_ACTIVE', 'ARCHIVED'). This allows the Data Viewer to act as a real-time strategic insight feed!
- **Instruction Strategy**: Define the agent as an expert advisor. Instruct it to perform deep SQL queries, cross-source reasoning, and visual reporting. Instruct it to write back strategic proposals or alerts to Firestore to keep the real-time console updated.

- **🚀 THEME: Autonomous Workflow Execution (Agent as an Operator who ACTS)**: 

    - **Focus**: End-to-end business workflows where the agent autonomously DETECTS triggers, PLANS execution steps, EXECUTES actions (DB writes, status updates, escalations), VALIDATES outcomes, and REPORTS completion — not just passive analysis.
    - **Workflow Execution Pattern (MANDATORY for Type A)**:
        1. **DETECT**: Identify actionable conditions (data anomaly, threshold breach, status change, external event)
        2. **PLAN**: Present execution plan as an A2UI workflow card showing all steps, decision points, and approval gates
        3. **EXECUTE**: Carry out each step systematically — query, evaluate business rules, write updates, escalate exceptions
        4. **VALIDATE**: Confirm changes were applied correctly, check post-conditions
        5. **REPORT**: Generate comprehensive execution summary with audit trail
    - **Constraint**: Focus on scenarios where the agent performs writes, updates, or deletes in the database (Firestore) to reflect real-world operational actions. The agent must demonstrate EXECUTION, not just RECOMMENDATION.

## Business Problem
${userGoal}

## Requirements
- Data Profile: **${profile.label}** (${profile.tableCount} tables)
- Table Design & Row Counts (Star Schema Strategy — ${profile.label} Profile):
    - **Master/Dimension Tables** (e.g., products, facilities, users): Target **${profile.masterCols} columns** (ID + descriptive attributes) and **MUST generate AT LEAST ${profile.masterMinRows} rows (Target: ${profile.masterRows} rows)**. Do NOT under-generate. Every master entity must exist to support downstream analytics.
        - **NO TRUNCATION (CRITICAL)**: Do NOT truncate the output. Never use "..." or "etc." to shorten the rows. Generate every row fully and verbatim.
        - **ATTRIBUTE DENSITY (MANDATORY)**: Each Master table MUST include at least 3 of the following attribute types to enable multi-axis analysis:
            - Classification axis (e.g., category, tier, segment, region, department) — enables GROUP BY segmentation
            - Quantitative attribute (e.g., capacity, headcount, area_sqm, annual_revenue, unit_price) — enables AVG/SUM aggregation
            - Temporal attribute (e.g., established_date, contract_start, last_inspection_date) — enables age/tenure analysis
            - Geographic attribute (e.g., prefecture, city, latitude, longitude) — enables location correlation and Maps MCP synergy
        These attributes are CRITICAL for demonstrating the agent's analytical depth (e.g., 'SELECT category, region, AVG(revenue) GROUP BY category, region').
    - **Transaction/Fact Tables** (e.g., sales, access logs, events): Target **${profile.txnCols} columns** (ID, foreign keys, timestamp, metric/dimension columns) and **MUST generate AT LEAST ${profile.txnMinRows} rows (Target: ${maxRows} rows)**. This is the PRIMARY analytical dataset and MUST contain high row density to show temporal trends and anomalies.
        - **NO TRUNCATION (CRITICAL)**: You MUST output every single row up to the target size. Never abbreviate the CSV data. Under-generating or truncating data will make the demo look empty and ineffective.
    - **TOKEN BUDGET STRATEGY**: ${profile.strategy}
${publicDatasetInfo}

## REALISTIC DATA SYNTHESIS (CRITICAL)
Generate data that reflects real-world business complexity. Apply the following domain-agnostic principles, **adapting them to the specific industry/function identified above**:

### 1. Temporal Patterns
Apply cyclical variations appropriate to the business context:
- **Day-of-week effects**: Weekday vs. weekend behavioral differences
- **End-of-period spikes**: Month-end, quarter-end, or fiscal year-end concentrations
- **Holiday/Event impacts**: Peak periods, promotional windows, or seasonal patterns
Infer relevant cycles based on the stated industry and problem.

**TEMPORAL COVERAGE (MANDATORY)**: Transaction/Fact table timestamps MUST span **at least 90 days (3 months)** from the referenceDate backwards. This is essential for:
- Trend analysis (month-over-month comparisons)
- Seasonal pattern detection
- Anomaly identification against historical baselines
Distribute data across the full time range — do NOT concentrate all records in the most recent week.

### 2. Attribute Correlations
Ensure realistic correlations between dimensions:
- **Geography x Behavior**: Regional preferences, local trends, or location-based patterns
- **Segment x Channel**: Customer type affecting preferred interaction methods
- **Tier/Rank x Frequency**: Engagement levels varying by loyalty status or classification
Create statistically plausible distributions — not random noise.

### 3. Business Logic Linkage (Cross-Table Consistency)
Ensure data across tables is logically consistent:
- **Constraint-based value linkage**: Capacity limits affecting downstream transactions (e.g., if a resource is exhausted, related activity stops)
- **Status/State transitions**: Multi-step workflows with valid state progressions
- **Temporal dependencies**: Lead times between related events (e.g., approval -> execution timing)
Infer appropriate business rules based on the stated industry and challenge.

**MASTER RECORD UTILIZATION (MANDATORY)**: Every record in a Master/Dimension table MUST be referenced by at least one record in a Transaction/Fact table. Do NOT generate master records that are "orphaned" (never used in any transaction). This ensures all JOIN queries produce meaningful results.

### 4. Real-World Content (CRITICAL - Avoid Fictional Data)
Use **actual real-world data** wherever possible to maximize authenticity:
- **Products/Brands**: Use real brand names, product lines, and SKUs appropriate to the industry (e.g., "iPhone 15 Pro", "Nike Air Max", "Toyota Camry")
- **Geographic Locations**: Use real city names, regions, and countries. Match locations to the business context (e.g., major retail markets, manufacturing hubs)
- **Person Names**: Use culturally appropriate, realistic names for the stated region/language (e.g., Japanese names for Japan-based scenarios)
- **Numerical Values**: Use realistic price points, quantities, and metrics based on real-world benchmarks (e.g., actual market prices, typical order volumes)
- **Dates**: Use recent, realistic dates anchored to the referenceDate. Ensure that for TIMESTAMP columns, hours are in the range 00-23, minutes 00-59, and seconds 00-59. Never generate invalid hours like 24 or 25. For \`DATE\` columns, use \`YYYY-MM-DD\`. For \`TIMESTAMP\` columns, use \`YYYY-MM-DD HH:MM:SS\` format. Do not use plain dates in timestamp columns.

**DO NOT invent fictional brands, fake product names, or placeholder values like "Product A" or "Company XYZ".**

### 5. Factual Consistency (CRITICAL - Company/Entity Alignment)
If the business problem mentions a **specific company, organization, or brand**, ensure ALL generated data is factually consistent with that entity:
- **Employees/Talents/Staff**: Only use names of people who ACTUALLY belong to that organization. Do NOT mix in people from competing organizations.
- **Products/Services**: Only use products/services that the specified company ACTUALLY offers. Do NOT include competitor products.
- **Locations/Facilities**: Only reference facilities that the company ACTUALLY owns or operates. Do NOT use generic placeholder names.
- **Partnerships/Clients**: Reference realistic business relationships based on publicly known information.

**If you are unsure whether a specific entity belongs to the mentioned company, DO NOT include it. It is better to use fewer but accurate data points than to include factually incorrect associations.**

**If NO specific company/organization is mentioned in the business problem**: Create a COHERENT fictional business context. Choose ONE realistic company profile (industry vertical, size, geography) and generate ALL data as if it belongs to this single hypothetical entity. Ensure internal consistency - all facilities, products, and personnel should belong to the same fictional organization. Do NOT mix data from multiple unrelated real-world companies.

### 5.5 Image File Generation (CRITICAL for Non-structured input goals)
If the Business Problem naturally involves processing non-structured inputs like hand-written papers, faxes, or photos of physical assets:
- You MUST design and include **EXACTLY TWO (2) simulated image files** in the 'externalFiles' array to represent different tasks or business contexts.
- For EACH image, specify a unique 'id' (e.g., 'file2', 'file3'), 'fileName' (e.g., 'handwritten_fax_order_task1.jpg', 'handwritten_fax_order_task2.jpg'), and a 'description' detailing the specific business scenario.
- **MULTI-ROW TABULAR CONTENT (ABSOLUTELY MANDATORY)**:
  - Each generated document image (such as invoices, orders, inspection sheets, or logs) MUST contain a table grid with **AT LEAST TWO (2) OR MORE distinct row items** (e.g., multiple different products, tasks, or errors).
  - **Never generate a document with only a single item row.** A single-row document fails to demonstrate the agent's capability to iterate, decompose, and process multi-line transactions.
  - Even if the scenario describes a specific issue (e.g., a damaged package or a specific error), the document itself should represent a broader context containing multiple rows (e.g., an inspection log of multiple items where one or more are marked as damaged, or a batch error report listing multiple errors).
- **ULTRA-REALISTIC DOCUMENT IMAGE PROMPT STRUCTURE (MANDATORY)**:
  - Each 'imagePrompt' (English only) MUST be a highly detailed, descriptive text designed for DALL-E or Imagen to generate a **highly-realistic, top-down flat-lay photograph of a handwritten document page on a textured sheet of paper**.
  - **ZERO BACKGROUND / COMPLETE ISOLATION (STRICTLY REQUIRED)**:
    - The prompt MUST explicitly state: **"The entire document is isolated, with no background, no desk, no office environment, no hands, no pens, and no keyboards. Just the single sheet of paper document filling the entire frame from a direct top-down 90-degree angle."**
    - The perspective MUST be perfectly flat, sharp contrast, with zero perspective distortion, zero angled shots, and zero depth-of-field blur.
  - **AUTHENTIC HUMAN HANDWRITING EMULATION (STRICTLY REQUIRED)**:
    - The text entries MUST NOT look like clean digital fonts or neat handwriting. The prompt MUST explicitly demand: **"The handwriting features highly realistic, chaotic, and significantly distorted human handwriting written with a cheap ballpoint pen, looking as if it was written in an extreme rush, or written using a non-dominant hand. The strokes are unsteady, highly organic, slightly shaky, with inconsistent character sizes, highly irregular spacing, crooked baselines, and varying character tilts. There are authentic human imperfections like ink clumps, minor pen skips, pen pressure variations, and natural ink smudges. It must look like a genuine, hurried scribble by a worker on a busy job site, making it highly challenging and realistic for OCR testing."**
  - **REAL-WORLD IMPERFECTIONS (STRICTLY REQUIRED)**:
    - The paper itself MUST show natural, subtle imperfections: **"The sheet of paper shows natural imperfections like slight folds, rounded corners, or minor light texture variations suggesting real-world operational handling."**
    - Lighting: **"Natural flat daylight illuminates the scene, highlighting the paper texture and the subtle physical indentation of the pen strokes."**
  - **LANGUAGE LOCALIZATION (STRICTLY REQUIRED)**:
    - Even though the 'imagePrompt' itself MUST be written in English, all text elements intended to be rendered inside the image (such as Title, Recipient, Sender, Column Headers, and handwritten comments) MUST be in the target language matching the 'userGoal'.
    - You MUST explicitly instruct the image generator to write the text in the target language by providing the exact translated string in the English prompt.
    - For example: "The header at the top center reads '[Translated Title]' in bold printed [Target Language] characters.", "The table has column headers written in [Target Language]: [Translated Column Names].", "The handwritten text in the table rows is written in [Target Language] characters representing realistic user feedback."
  - **DYNAMIC DOMAIN ALIGNMENT (MANDATORY)**:
    - The prompt's content MUST be dynamically populated based on the generated demo domain data:
        1. **Title**: Large formal printed header at the top center (e.g., the exact translated equivalent of 'Purchase Order' or 'Invoice' matching the target language of the 'userGoal'). You MUST explicitly include the target language string in the prompt instructions.
        2. **Recipient**: Recipient company details on the top-left (e.g., '[RECIPIENT_COMPANY]' with appropriate localized polite suffix matching the target language culture).
        3. **Sender**: Sender company details on the top-right (matching generated client data, with appropriate localized suffixes if applicable).
        4. **Table Grid**: Neatly printed columns for details. Translate the column headers into the target language. Inside the cells, write the handwritten items corresponding exactly to BQ/Firestore transaction data (translated to the target language if they are text descriptions or comments). **You MUST ensure the table contains AT LEAST TWO (2) OR MORE distinct row items (e.g., multiple different products or services ordered) to represent a realistic multi-line business document. Never generate a document with only a single item row.**
        5. **Footer**: Total amounts, and a designated seal/signature box. If culturally appropriate to the target language (e.g., Japanese domain), include: **"in the designated space, a small, faint red ink corporate seal stamp is printed."** Otherwise, include a formal handwritten signature block.
- **VARIATION & SEED (CRITICAL)**:
  - Image 1 (e.g., Task 1): Depict a standard operational sheet (e.g., handwritten order from Customer A with normal quantities and readable items).
  - Image 2 (e.g., Task 2): Depict a different customer, showing a clear discrepancy (e.g., handwritten order from Customer B specifying an abnormally high quantity, discontinued code, or fuzzy specs matching L1211 audit seeds) using a slightly different handwriting style to trigger the agent's detection.
- DO NOT design generic vectors, cartoon icons, or generic illustrations. It must mimic real-world scanned or photographed flat documents to demonstrate the agent's advanced vision capabilities.


### 6. Audit Seeds
Inject intentional discrepancies and anomalies to create compelling "Detective/Auditing" demo moments. The agent's value is demonstrated when it **discovers** these issues. Apply ALL of the following patterns, adapting to the specific business domain:

#### 6a. Cross-Silo Discrepancies & Ambiguities (External File/Image vs BigQuery Master)
- **FOR DOCUMENT SCAN SCENARIOS (e.g., Handwritten orders)**: 
  - DO NOT inject completely unrelated competitor products as "out-of-scope" errors (e.g., B2B customers do not mix noodle soup or tea inside a soy sauce order sheet).
  - Instead, you MUST inject **highly realistic SKU confusion, fuzzy specifications, or obsolete codes from within the SAME company product line**:
      1. **Capacity/Size mismatch**: The handwritten line specifies a non-existing size or capacity (e.g., a non-offered product volume when only specific sizes are registered in the product master).
      2. **Name Ambiguity / Fuzzy matching**: The handwritten sheet lists a generic brand or product name without capacity or size specifications, requiring the AI to check history to suggest matching SKU candidates.
      3. **Discontinued SKU / Obsolete Code**: The handwritten sheet uses an old product code that has been discontinued or replaced in the master table, requiring a mapping check.
- **FOR TABULAR/EXCEL DATA**:
  - At least **2-3 records** in the external file (PDF/Excel) MUST have values that *slightly* mismatch the corresponding BigQuery records (5-20% deviation in price, quantity, or score) to trigger analytical discrepancies.

#### 6b. Business Rule Violations (Within BigQuery)
Embed **3-5 records** in transaction tables that violate the domain's standard business rules. Adapt to the domain:
- **Any domain**: Transactions processed outside normal business hours, or on holidays
- **Any domain**: Status transitions that skip required intermediate steps (e.g., "Pending" to "Completed" without "Approved")
- **Any domain**: Numeric values that exceed domain-typical thresholds (unusually high amounts, negative quantities, zero-value transactions)
- **Any domain**: Records with missing or inconsistent foreign key references (e.g., an order referencing a facility/location not in the master table)
The violations should be DISCOVERABLE through SQL analysis (JOIN, GROUP BY, WHERE) - do NOT make them obvious from a single-row inspection.

#### 6c. Temporal Anomalies (Time-Series Patterns)
Embed **1-2 statistically anomalous periods** in the transaction data:
- A specific week or date range where one metric (volume, amount, frequency) deviates significantly (2-3x) from the surrounding periods
- The anomaly should correlate with at least one dimension (a specific region, product, customer segment, or category) - NOT a global spike
This creates opportunities for the agent to perform trend analysis and root-cause identification.

### 7. Visual Seeds
Incorporate visual attributes into the database schema ONLY when relevant to the business domain and restricted to appropriate asset-focused tables:
- **Conditional Inclusion**: Only include descriptive visual attributes (e.g., colors, materials, styles) if the business problem involves industries where visual characteristics are key data points (e.g., Fashion, Retail, Product Marketing, Real Estate).
- **Table Restriction**: Restrict these attributes to dedicated tables such as "Product Catalog", "Asset Master", or "Menu Items". Do NOT include them in transactional or unrelated master tables (e.g., Customer Master, Order Details).
- **Analytical Context**: Rely primarily on the agent's system instructions to determine visual output styles (e.g., business slides, infographics) rather than forcing visual columns in the database schema.

### 8. Workflow Definition Pattern (MANDATORY for Type A)
The generated 'businessInstruction' MUST include at least ONE fully-specified workflow that the agent can execute end-to-end. This is CRITICAL for demonstrating the agent as an autonomous operator, not just a data analyst.

Each workflow MUST define:
- **TRIGGER**: What initiates the workflow (user command, data condition matched, scheduled check)
- **STEPS**: Ordered sequence of 3-7 concrete actions the agent will take
- **DECISION POINTS**: Conditional branches based on data values or business rules (e.g., 'if discrepancy < 5%, auto-approve; if >= 5%, escalate')
- **HITL GATES**: Which steps require human approval - mark as [APPROVAL_REQUIRED]. Low-risk actions (status updates, log entries) should be AUTO-EXECUTED without asking.
- **COMPLETION CRITERIA**: How the agent knows the workflow is done
- **ERROR HANDLING**: What to do when a step fails

Example workflow structure (adapt to the specific business domain):
"WORKFLOW: 'Invoice Discrepancy Resolution'
  TRIGGER: User asks to process flagged invoices, OR scheduled daily check
  STEP 1: Query for all records with status='FLAGGED' (last 7 days)
  STEP 2: For each flagged record, cross-reference with vendor data in the operational database
  STEP 3: [DECISION] If discrepancy < 5%: AUTO-EXECUTE - update status to 'AUTO_RESOLVED' with notes
  STEP 4: [DECISION] If discrepancy >= 5%: [APPROVAL_REQUIRED] - present A2UI workflow card showing the issue and proposed action, wait for user approval
  STEP 5: Upon approval, update status to 'RESOLVED' with resolution notes and assigned_to
  STEP 6: Generate execution summary report showing: total processed, auto-resolved, escalated, failed
  COMPLETION: All flagged records processed, summary report displayed (audit trail is logged automatically by the system)"

## Output Format (JSON)
Output in the following JSON format. Output **pure JSON only without code blocks**.

{
  "externalFiles": [
    {
      "id": "file1",
      "fileName": "invoice_reconciliation_audit.pdf",
      "mimeType": "application/pdf",
      "fileContent": "# Invoice Audit Report\\n\\n## Summary...",
      "description": "..."
    },
    {
      "id": "file2",
      "fileName": "handwritten_fax_order_task1.jpg",
      "mimeType": "image/jpeg",
      "description": "Simulated operational document 1 (e.g. handwritten purchase order from Client A with normal quantities)",
      "imagePrompt": "A highly detailed, realistic top-down flat-lay scan of a formal purchase order sheet. The clean white document page fills the entire frame with zero background, completely isolated. At the top center, a bold formal header matching the domain (e.g., 'PURCHASE ORDER') is printed. On the top-left, recipient details and company name are printed in a clean corporate font. On the top-right, sender company details along with localized contact information are printed. In the center, a neatly aligned printed table grid with thin gray lines features standard columns like 'Item No.', 'Product Name', and 'Quantity'. Inside the table cells, highly realistic, messy, and hurried human handwriting in black ballpoint pen ink is neatly filled, showing AT LEAST TWO (2) OR THREE (3) distinct product rows with their respective quantities and codes (showing realistic human imperfections, hurried scribbles, varying character sizes, and slight character misalignment). Natural flat daylight illuminates the scene, showing subtle paper folds and real-world operational handling texture. Sharp contrast, flat perspective, and zero angled shots."
    },
    {
      "id": "file3",
      "fileName": "handwritten_fax_order_task2.jpg",
      "mimeType": "image/jpeg",
      "description": "Simulated operational document 2 (e.g. handwritten purchase order from Client B showcasing a clear quantity or product ID discrepancy for audit verification)",
      "imagePrompt": "A high-quality, top-down flat scan of a different formal transaction document (e.g., 'INVOICE' or 'DELIVERY SLIP') filling the entire frame with no background. Features a bold domain-specific printed header with date and document reference numbers. Recipient and sender corporate details are cleanly aligned at the top. In the center, a printed table grid features AT LEAST TWO (2) OR THREE (3) distinct catalog item rows. Inside the grid cells, highly realistic, hurried, and messy human handwriting in dark blue ink lists these multiple items, with at least one of the rows intentionally showcasing a clear operational discrepancy (such as an abnormally high quantity, discontinued item code, or fuzzy specification to trigger the audit flow) while other rows represent normal transactions. The handwriting is slightly untidy, hurried, and scribble-like, showcasing human imperfection and hasty pen strokes. A designated signature block or faint red ink corporate stamp is present in the designated footer space. Clear flat document view with zero perspective blur."
    }
  ],
  "tables": [
    {
      "tableName": "Table name (English, snake_case)",
      "description": "...",
      "schema": [
        {"name": "column_name", "type": "STRING|INTEGER|FLOAT|DATE|TIMESTAMP", "description": "..."}
      ],
      "csvData": "..."
    }
  ],
  "firestore": {
    "collectionName": "Collection name (snake_case)",
    "dashboardTitle": "Dashboard console title",
    "kpiLabels": ["Label 1", "Label 2", "Label 3"],
    "documents": [
      "MANDATORY: Generate at least 8 documents representing items at different stages of processing.",
      "- If Type A (Operational): Use status 'PENDING', 'IN_PROGRESS', 'RESOLVED', 'ESCALATED' representing a workflow task queue.",
      "- If Type B (Advisory): Use status 'PROPOSAL_PENDING', 'APPROVED', 'ALERT_ACTIVE', 'ARCHIVED' representing an insights feed or strategic proposal board.",
      {
        "id": "Unique ID matching BigQuery data for correlation",
        "data": {
          "status": "E.g., PENDING or PROPOSAL_PENDING",
          "priority": "High/Medium/Low",
          "assigned_to": "Realistic name",
          "notes": "Verbose domain-specific notes detailing the specific alert or task."
        }
      }
    ]
  },
  "businessInstruction": "Specific instruction for the agent (5-8 sentences) defining its persona.
    - If Type A (Operational): Define persona/expertise. Instruct the agent to perform a conceptual workflow pipeline: (a) Scan & Analyze pending items, (b) Classify & Prioritize by applying business rules, (c) Plan & Coordinate by presenting the plan and allowing execution mode selection, (d) Process & Escalate, (e) Notify & Report. Include the FULL workflow definition from Section 8 here.
    - If Type B (Analytical/Strategic): Define the agent as an expert consultant. Instruct it to perform deep multi-hop SQL analysis, cross-source reasoning (correlating BQ with external files), and proactive strategic recommendation. Instruct it to write back strategic alerts, proposed budget modifications, or creative ideas to Firestore. Instruct it to use A2UI Dashboard Cards, Ranking Matrix, and Tabbed Comparisons to present insights, and use image generation for executive summaries.
    - **NO TECHNICAL SPECS (MANDATORY)**: Do NOT include any technical implementation details, specific tool names (e.g., 'generate_image', 'execute_sql'), UI framework terms (e.g., 'A2UI JSON', 'cards', 'chips', 'deleteSurface'), or system-level mechanisms. Focus purely on the business domain, data relationships, and operational rules. The technical/system behavior is managed by the platform's base instructions.",
  "referenceDate": "YYYY-MM-DD",
  "publicDatasetId": "bigquery-public-data.dataset.table",
  "agentShortName": "A concise 2-3 word role-based name for the agent (e.g., 'Supply Chain Analyst', 'Fraud Investigator').",
  "oneSentenceSummary": "A concise, professional one-sentence summary of the business challenge and the generated solution.",
  "appliedFactors": {
    "temporalPatterns": ["List of 2-3 specific temporal patterns applied"],
    "correlations": ["List of 2-3 specific data correlations applied"],
    "businessLogic": ["List of 2-3 specific business logic constraints applied"]
  },
  "metadata": {
    "locale": "The primary language locale of the demo (e.g., 'en', 'ja', 'de', 'fr').",
    "currency": "The 3-letter currency code suitable for the business context (e.g., 'USD', 'JPY', 'EUR', 'GBP').",
    "currencySymbol": "The currency symbol corresponding to the currency code (e.g., '$', '¥', '€', '£')."
  },
  "demoGuide": [
    {
      "title": "...",
      "prompt": "...",
      "requiredFileId": "file1 or empty",
      "tags": [...]
    }
  ]
}

## Critical Notes
- **DEMO PROMPTS (CRITICAL)**: Generate EXACTLY 7 structured demo prompts that showcase the agent's "reasoning" and "operational action" capabilities.
    - **NO PRODUCT NAMES (CRITICAL)**: DO NOT include specific product names like 'Firestore', 'BigQuery', or 'Google Cloud' in the prompt text. Use completely generic business terminology like 'our operational database', 'internal records', or 'the compliance tracker'.
    - **NO FILENAMES (CRITICAL)**: DO NOT include specific file names or extensions (e.g., 'market_report_2024', 'data.tsv') in the prompt text. Use generic phrasing.
    1. **DISTRIBUTION & ADVANCED PROGRESSION (CRITICAL)**: Generate exactly 7 prompts tailored completely to the specific business challenge and industry context:
        - **Prompts 1-2 (Foundation & Discovery)**: Data overview, schema exploration, and initial audit scan. Establish familiarity with the data landscape.
        - **Prompt 3 (CROSS-SOURCE DISCOVERY - WOW MOMENT, MANDATORY)**: This prompt MUST be designed so that the answer REQUIRES the agent to discover a hidden connection between the external file data and BigQuery data that is NOT obvious from either source alone. Phrase it as a high-level strategic question (e.g., 'What is the biggest untracked financial risk across our operations?') so the agent must autonomously decide to cross-reference the uploaded file against internal records. The Audit Seed from Section 6a provides the discrepancy the agent should discover. This prompt creates the most impressive demo moment.
        - **Prompts 4-5 (MULTI-STEP DEPENDENT WORKFLOW - WOW MOMENT)**: These prompts MUST trigger FULL multi-step workflow execution demonstrating INTERDEPENDENT step chains where each step depends on the previous step's output. Prompt 4 MUST be a workflow with 10 items or fewer designed for IMMEDIATE synchronous execution. Each step must depend on the previous step's output (e.g., 'Scan all pending items, classify by severity, auto-process anything within tolerance, and generate an exception report for the remaining items'). The agent should demonstrate the full SCAN-CLASSIFY-PROCESS-ESCALATE-NOTIFY-AUDIT dependency chain in real-time. Prompt 5 MUST be a LARGE-SCOPE workflow implying more than 10 items or long-running processing, where the agent should propose BACKGROUND execution mode. Phrase it as a comprehensive batch operation (e.g., 'Run a full reconciliation across all records from the past quarter - identify discrepancies, auto-correct minor variances, flag major issues, and generate a compliance report'). The agent MUST demonstrate the execution mode selection dialog (immediate vs. background vs. scheduled).
        - **Prompt 6 (SCHEDULED WORKFLOW - Automated Monitoring)**: A prompt that explicitly asks for a RECURRING scheduled workflow. The agent must propose using scheduled task registration with a cron expression and explain the monitoring logic. Example style: 'Set up an automated daily check at 9am - scan for new threshold breaches since yesterday, auto-escalate critical ones, and send me a summary report each morning.' The agent should demonstrate register_scheduled_task and explain what the background agent will do autonomously on each scheduled run.
        - **Prompt 7 (End-to-End Strategic Automation)**: A complex prompt combining cross-source data analysis + conditional workflow execution + notification drafting + audit logging. This MUST require the agent to: (1) analyze data from multiple sources (BigQuery + Firestore + external file), (2) propose a multi-step workflow based on its findings, (3) execute with the appropriate execution mode, (4) draft a notification summary, and (5) create audit entries. This showcases the full spectrum of the agent's capabilities as an autonomous operator.
        - **NO EXPLICIT HITL IN PROMPTS (CRITICAL)**: The generated prompt text MUST NOT contain explicit instructions like 'Please wait for my approval' or 'Propose first'. Present the request as a straightforward business instruction (e.g., 'Register these anomalies as new compliance alerts in the database'). The agent will naturally implement the confirmation step autonomously based on its core system instructions!
    2. **PERSONA ROTATION (CRITICAL)**: Vary the tone and perspective by rotating personas for each prompt (e.g., CFO, Ops Manager, Regional Director, Front-line Lead).
    3. **EXTERNAL DATA NECESSITY & LOGICAL CONSISTENCY (CRITICAL)**: You MUST generate exactly one PDF file AND exactly one Excel file (.xlsx) unless it is completely impossible for the business context. The files generated MUST be external data (not inside the current system) and MUST be unstructured or semi-structured in format.
        - **LOGICAL LINKAGE**: ALL discrepancies or specific transaction IDs (e.g., "INV-7829") mentioned in the external file content MUST correspond to standard records that ACTUALLY EXIST inside the generated BigQuery CSV tables. Do NOT make up transaction IDs in the external file that do not exist in the database tables. This allows the user to find the anomaly by comparing the external file against the database.
        - **CROSS-SOURCE BINDING (MANDATORY)**: The Excel file MUST contain a column whose values are a SUBSET of a BigQuery table's primary key or unique identifier (e.g., order_id, invoice_number). At least 70% of the Excel rows MUST have matching records in the BigQuery tables to enable reliable JOIN-based cross-referencing. The PDF file MUST reference at least 3 specific record identifiers (IDs, invoice numbers, etc.) that exist in the BigQuery tables, enabling the agent to look up those exact records via SQL. This structural binding GUARANTEES that cross-source analysis will succeed during the demo.
    3. **FILE FORMAT & REALISM (CRITICAL)**: 
        - For PDF files, generate **substantial, realistic, and highly structured business document content (at least 1,500 characters)** with clear titles, multiple sections using Markdown headings (e.g., '# Summary', '## Background', '### Details'), and bullet points ('- '). It MUST be unstructured text in a rich report format. 
            - **CHART TRANSLATION**: When including data chart placeholders '[CHART: Title, ... ]', you **MUST translate the Title and Metric Labels into the language of the business problem** (e.g., if the problem is in Japanese, translate 'Metrics' to Japanese).
            - **MARKDOWN LIMITATIONS**: Only use Markdown for structural elements: headings ('#', '##', '###') and lists ('-'). **DO NOT use inline styles like bold ('**bold**') or italics ('*italics*') within running text**, as the simple PDF renderer cannot interpret partial styles inside a single line. Standard running text should be plain sentences.
            - **Rich Visuals**: Include at least one data chart placeholder in the format '[CHART: Title, Metric1=Value1, Metric2=Value2, ...]' to simulate visuals. Do NOT use simple CSV or tiny tables for PDFs!
        - For Excel files, ensure the fileName ends with '.xlsx' and provide **complex, semi-structured datasets in TSV (Tab-separated values) format using \t as a delimiter** that simulate real business spreadsheets (MANDATORY: Generate 40 to 80 rows of detail data. DO NOT summarize or truncate. Replicate a realistic full set of logs/records).
            - **SEPARATORS (CRITICAL)**: **Use \t (Tab) as the column separator**, NOT commas. Commas are reserved for human-friendly currency formatting within fields.
            - **COMPOSITE LAYOUT**: Include a report title and a Summary KPI section at the top, a blank line list separator, and then the Detailed Data table below.
            - **HARDCODED UNITS & FORMATTING**: Include units (e.g., JPY, L, kg, %) inside the data cells itself as strings. Use thousand-comma separators for money values - this is permitted and safe since you are using Tabs as separators! (e.g., "150,000JPY").
            - **RICH QUALITATIVE COMMENTS**: Include a "Remarks/Notes" column with realistic, verbose business comments (e.g., "Delayed due to traffic accident on Route 1").
    4. **NO TABLES/COLUMNS**: Do NOT mention 'production_batches', 'port_id', etc. in the prompt text.
    5. **GEOSPATIAL SYNERGY**: At least one prompt MUST require the agent to use BOTH system data (for historical metrics) and location/map data (for travel times, routes, or place details) to answer. Use generic terms like 'location data' or 'map information' instead of 'Google Maps'.
    5. **PROBLEM-CENTRIC**: Focus on high-level business goals (e.g., "Identify the financial impact of logistics delays in coastal regions and propose an optimized route for the highest-value shipments").
- **DATA STORYTELLING & ANOMALIES (CRITICAL)**: You MUST seed at least one complex business anomaly across the tables. For example, a specific product category having a high return rate only in a specific region during a specific week, which correlates with a delivery carrier listed in the external log file. Do not make it obvious; the agent should need to join at least two tables and analyze trends to find it.
- **FACTOR ADHERENCE (CRITICAL)**: The generated CSV data MUST strictly adhere to the patterns described in \`appliedFactors\` in your JSON response. If you list 'Temporal Pattern: Weekday lunch surge', the timestamped transaction data MUST show higher volumes during those hours.
- **MAXIMUM DATA (CRITICAL)**: You MUST generate data without truncation (do NOT use "etc." or "..."). Follow the ${profile.label} Profile row count strategy: **${profile.masterRows} rows for Master Tables** and **at least ${profile.txnRows} rows (target ${maxRows}) for Transaction Tables**. If you sense output limits approaching, STOP adding columns and PRIORITIZE completing all transaction rows. This is a technical requirement for a simulation.
- **RELATIONAL INTEGRITY & NAMING**: 
    1. **Primary/Foreign Keys MUST follow the format '[entity]_id'** (e.g., 'talent_id', 'theater_id').
    2. **STRICT SYMMETRY (CRITICAL)**: Foreign Keys MUST have the EXACT same column name as the Primary Key they reference in the parent table. Do NOT use prefixes like 'main_' or 'ref_' for ID columns. Do NOT use semantic aliases instead of the canonical FK name.
        - **WRONG**: Master table has PK 'code_id' but fact table uses 'primary_cpt' or 'icd_code' to reference it. These are semantic aliases that break JOIN discoverability.
        - **RIGHT**: If the master table 'medical_codes' has PK 'code_id', then the fact table 'claims' MUST also use a column named 'code_id' (or add 'code_id' as an explicit FK column alongside any domain-specific columns).
        - **VALIDATION RULE**: Before finalizing, scan every fact/transaction table. For every column whose values reference a master table, ensure the column name matches the master table's PK name exactly. If the domain requires multiple references to the same master table (e.g., 'primary_code_id' and 'secondary_code_id'), use the entity_id suffix pattern consistently.
    3. **STAR SCHEMA PREFERENCE**: When generating multiple tables, favor a "Star Schema" approach. Include at least one central "Dimension/Master" table (e.g., 'products', 'locations', 'customers') that other "Fact/Log" tables reference. This ensures better data connectivity and analytical depth.
    4. **NO ISOLATED TABLES (CRITICAL)**: Every table MUST be connected to at least one other table via shared '_id' columns. Isolated tables (islands) are strictly forbidden. Ensure that all tables can be joined together directly or through an intermediary table. After generating all tables, verify: for each table T, there exists at least one other table that shares an '_id' column name with T.
    5. Tables MUST be designed for joining.
- **LANGUAGE CONSISTENCY (CRITICAL)**: Detect the language used in the "Business Problem" above. You MUST use this same language for ALL user-facing fields, including:
    - Table and Column descriptions
    - STRING values in the CSV data (e.g., product names, categories, person names, names of things)
    - systemInstruction
    - appliedFactors descriptions
    - demoGuide titles and prompts
    - externalFiles: fileName, fileContent, and the specific text strings specified for rendering inside 'imagePrompt' (e.g. Title, Recipient, Sender, Table Columns, and handwritten text values must be translated into the target language, while keeping the overall prompt description in English)
- **TECHNICAL NAMES (CRITICAL)**: Table names, column names, and ALL ID fields (primary/foreign keys) MUST use English (snake_case) for technical compatibility and data integrity. Do NOT translate technical identifiers.
- **ABSTRACT INSTRUCTIONS**: Do NOT mention column names in prompts.
- **STRICT CSV FORMATTING**: 
    1. **ALWAYS wrap text-based values** (STRING) in double quotes.
    2. **DO NOT wrap numeric values** (INTEGER, FLOAT) in quotes.
    3. **ALWAYS include the header row (column names) as the very first line of the CSV data. Skipping the header row is strictly forbidden.**
`;
}

// ===========================================
// Step 2: Validation
// ===========================================

function validateGeneratedData(planResult, targetRows, dataProfileId) {
  const profile = getDataProfile_(dataProfileId || 'standard');
  if (!planResult.tables || planResult.tables.length === 0) {
    throw new Error('No table definitions generated');
  }
  
  for (const table of planResult.tables) {
    if (!table.schema || !table.csvData) throw new Error(`Incomplete table data for "${table.tableName}"`);
    
    // Validate and repair CSV/Schema column count mismatch
    const lines = table.csvData.trim().split('\n');
    if (lines.length === 0) throw new Error(`Empty CSV data for "${table.tableName}"`);
    
    const csvHeaders = parseCSVLine(lines[0]);
    const schemaColumnCount = table.schema.length;
    const csvColumnCount = csvHeaders.length;
    
    if (csvColumnCount !== schemaColumnCount) {
      // console.log(`Column mismatch for "${table.tableName}": CSV has ${csvColumnCount} columns, schema has ${schemaColumnCount}. Repairing...`);
      
      // Rebuild schema from CSV headers, inferring types from existing schema or defaulting to STRING
      const schemaMap = {};
      for (const field of table.schema) {
        schemaMap[field.name.toLowerCase()] = field;
      }
      
      const repairedSchema = csvHeaders.map(headerName => {
        const normalizedName = headerName.trim().toLowerCase();
        if (schemaMap[normalizedName]) {
          return schemaMap[normalizedName];
        }
        // Default to STRING for unknown columns
        return { name: headerName.trim(), type: 'STRING', description: 'Auto-generated field' };
      });
      
      table.schema = repairedSchema;
      // console.log(`Repaired schema for "${table.tableName}" to ${repairedSchema.length} columns.`);
    }

    const expectedColumnCount = table.schema.length;
    
    // --- Row count threshold check ---
    const dataRowCount = lines.length - 1; // Exclude header
    const hasTimestamp = table.schema.some(f => ['TIMESTAMP', 'DATE', 'DATETIME'].includes(f.type.toUpperCase()));
    const isMasterTable = !hasTimestamp && table.schema.length <= 8;
    const minExpectedRows = isMasterTable ? profile.masterMinRows : profile.txnMinRows;
    
    if (dataRowCount < minExpectedRows) {
      console.warn(`[CSV QUALITY] Table "${table.tableName}" has only ${dataRowCount} rows (expected at least ${minExpectedRows}). Data may be sparse.`);
    }

    // --- Per-row column validation and repair ---
    const repairedLines = [];
    let repairCount = 0;
    
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      let parts = parseCSVLine(line);
      
      // Repair rows with wrong column count
      if (parts.length !== expectedColumnCount) {
        if (lineIdx === 0) {
          // Header row mismatch - this shouldn't happen after schema repair, but handle it
          console.warn(`[CSV REPAIR] Header row has ${parts.length} columns, expected ${expectedColumnCount}. Skipping repair.`);
        } else {
          // Data row mismatch - repair by padding or truncating
          if (parts.length < expectedColumnCount) {
            // Pad with empty values
            while (parts.length < expectedColumnCount) {
              parts.push('');
            }
          } else {
            // Truncate excess columns
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


    // --- Row Count Validation ---
    // Note: We intentionally do NOT pad with generated placeholder data.
    // It's better to have fewer realistic rows than many fake placeholder values
    // like "theater_name_13" or "location_prefecture_14".
    const currentDataRows = repairedLines.length - 1; // Exclude header
    if (currentDataRows < targetRows) {
      console.warn(`[ROW COUNT] Table "${table.tableName}" has ${currentDataRows} rows (target: ${targetRows}). AI did not generate enough rows.`);
    }

    // --- Robust Data Cleaning & Type Validation ---
    let typeRepairCount = 0;
    const cleanedLines = repairedLines.map((parts, lineIdx) => {
      // Skip header row for type validation
      if (lineIdx === 0) {
        return parts.map(v => v.replace(/^"|"$/g, '')).map((v, colIdx) => {
          const field = table.schema[colIdx];
          const type = field ? field.type.toUpperCase() : 'STRING';
          if (['INTEGER', 'FLOAT', 'DOUBLE', 'NUMBER', 'INT64', 'FLOAT64'].includes(type)) {
            return v;
          }
          return `"${v.replace(/"/g, '""')}"`;
        }).join(',');
      }
      
      // Data rows: validate and repair each cell
      return parts.map((val, colIdx) => {
        const field = table.schema[colIdx];
        const type = field ? field.type.toUpperCase() : 'STRING';
        const columnName = field ? field.name : `col${colIdx}`;
        
        // Use the new validation helper
        const result = validateAndRepairValue(val, type, columnName, lineIdx - 1);
        if (result.repaired) {
          typeRepairCount++;
        }
        return result.value;
      }).map((v, colIdx) => {
        // Final Re-quoting as per BigQuery requirements
        const field = table.schema[colIdx];
        const type = field ? field.type.toUpperCase() : 'STRING';
        
        if (['INTEGER', 'FLOAT', 'DOUBLE', 'NUMBER', 'INT64', 'FLOAT64'].includes(type)) {
          return v; // Numbers stay unquoted
        }
        // Strings, Dates, etc. get strictly quoted
        return `"${v.replace(/"/g, '""')}"`;
      }).join(',');
    });
    
    if (typeRepairCount > 0) {
      console.warn(`[TYPE REPAIR] Fixed ${typeRepairCount} type violations in "${table.tableName}".`);
    }
    
    table.csvData = cleanedLines.join('\n');
  }
}

/**
 * Validates and repairs a cell value based on its declared type.
 * Returns the repaired value and whether repair was needed.
 * @param {string} value - The raw value
 * @param {string} type - The column type (INTEGER, FLOAT, DATE, STRING, etc.)
 * @param {string} columnName - Column name for context-aware defaults
 * @param {number} rowIndex - Row index for generating sequential defaults
 * @returns {{value: string, repaired: boolean}}
 */
function validateAndRepairValue(value, type, columnName, rowIndex) {
  const upperType = type.toUpperCase();
  const trimmedVal = value.trim();
  
  // Empty values are allowed (NULL)
  if (trimmedVal === '') {
    return { value: '', repaired: false };
  }
  
  switch(upperType) {
    case 'INT64':
    case 'INTEGER':
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
      
    case 'FLOAT64':
    case 'FLOAT':
    case 'DOUBLE':
    case 'NUMBER':
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
      
    case 'DATE':
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
      
    case 'TIMESTAMP':
    case 'DATETIME':
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
      
    default:
      // STRING type - accept as-is
      return { value: trimmedVal, repaired: false };
  }
}

/**
 * Generates a sensible default value for a given type and column.
 * @param {string} type - The column type
 * @param {string} columnName - Column name for context-aware generation
 * @param {number} rowIndex - Row index for sequential IDs
 * @returns {string} A valid default value
 */
function generateDefaultValue(type, columnName, rowIndex) {
  const upperType = type.toUpperCase();
  const lowerColName = columnName.toLowerCase();
  
  switch(upperType) {
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
      
    case 'DATE':
      // Generate a date within the past year
      const d = new Date();
      d.setDate(d.getDate() - Math.floor(Math.random() * 365));
      return d.toISOString().split('T')[0];
      
    case 'TIMESTAMP':
    case 'DATETIME':
      const dt = new Date();
      dt.setDate(dt.getDate() - Math.floor(Math.random() * 365));
      return dt.toISOString();
      
    default:
      // STRING type
      return `${columnName}_${rowIndex + 1}`;
  }
}

function parseCSVLine(line) {
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

function repairTruncatedJson(jsonStr) {
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

// ===========================================
// Step 4: Setup Script Generation (Portable version)
// ===========================================

/**
 * Generates a short, filesystem-safe base name from the user's goal.
 * @param {string} userGoal - The user's business problem description
 * @param {string} suffix - Unique suffix for collision avoidance
 * @returns {string} A short, descriptive base name (e.g. retail-inventory-abcd1234)
 */
function generateBaseName(userGoal, suffix) {
  // Use AI to generate a short English identifier
  const prompt = `Generate a short, filesystem-safe identifier (2-3 words, lowercase, hyphens only) that describes this business problem:

"${userGoal}"

Rules:
- Use ONLY lowercase letters and hyphens (no numbers, no special characters)
- Maximum 20 characters
- Must be descriptive of the business domain
- Examples: "retail-inventory", "bakery-sales", "hotel-booking", "logistics-fleet"

Return ONLY the name, nothing else.`;

  try {
    const result = callVertexAI(prompt);
    let cleanName = result.trim().toLowerCase()
      .replace(/[^a-z-]/g, '-')     // Replace non-alphabet/non-hyphen with hyphen
      .replace(/-+/g, '-')           // Collapse multiple hyphens
      .replace(/^-|-$/g, '')         // Remove leading/trailing hyphens
      .substring(0, 15)              // Limit length to 15 to stay under 26 total with suffix
      .replace(/-+$/g, '');          // Remove trailing hyphens after truncation
    
    if (cleanName.length < 3) cleanName = 'demo-env';
    return `${cleanName}-${suffix}`;
  } catch (e) {
    return `env-${suffix}`;
  }
}

function generateSetupScript(params) {
  const { datasetId, systemInstruction, referenceDate, publicDatasetId, suffix, tables, firestore, userGoal, dirName, agentShortName, oneSentenceSummary, enableWorkspaceMcp, metadata } = params;

  // ── Deduplicate importedMcpList by github_url ──
  // When the same MCP repo appears multiple times (e.g. from catalog + URL import),
  // merge their required_env_vars (deduped by key) into a single entry to avoid
  // creating duplicate Secret Manager versions.
  if (params.importedMcpList && params.importedMcpList.length > 0) {
    const seen = new Map();
    params.importedMcpList.forEach(mcp => {
      const url = mcp.type === 'remote' ? mcp.endpoint_url : mcp.github_url;
      if (seen.has(url)) {
        // Merge env vars (add any new keys from the duplicate)
        const existing = seen.get(url);
        const existingKeys = new Set(existing.required_env_vars.map(v => v.key));
        (mcp.required_env_vars || []).forEach(v => {
          if (!existingKeys.has(v.key)) {
            existing.required_env_vars.push(v);
          }
        });
        // Merge capabilities
        if (mcp.capabilities) {
          const existingCaps = new Set(existing.capabilities || []);
          mcp.capabilities.forEach(c => existingCaps.add(c));
          existing.capabilities = [...existingCaps];
        }
      } else {
        seen.set(url, JSON.parse(JSON.stringify(mcp))); // deep clone
      }
    });
    params.importedMcpList = [...seen.values()];
  }

  const fsCollection = `${dirName}-data`;
  const currencySymbol = (metadata && metadata.currencySymbol) || '$';
  
  const bashEscape = (str) => str ? str.replace(/'/g, "'\\''") : '';
  const safeShortName = bashEscape(agentShortName) || 'Agent';
  const safeSummary = bashEscape(oneSentenceSummary) || 'A2A Agent';

  // == Pinned Dependency Versions ==
  // All dependency versions are managed here. Update this block when upgrading.
  // See AGENTS.md Section 13 for the update checklist.
  const PINNED_DEPS = {
    // Critical: A2UI SDK -- MUST use git+commit (PyPI 0.2.1 lacks version param)
    //   Tested: HEAD ade478f with version='0.8' -> application/json+a2ui (GE compatible)
    //   Constraint: a2ui@ade478f requires google-genai>=1.27.0, google-adk>=1.28.1
    a2ui: 'a2ui-agent-sdk @ git+https://github.com/google/A2UI.git@ade478faf8dcad611b5efb6b864dcbfbc4a51f68#subdirectory=agent_sdks/python',

    // Python SDKs -- floor-only (>=) to avoid pip resolution conflicts
    // Upper bounds are NOT set unless a package has caused a breaking change.
    adk: 'google-adk[a2a]>=1.31.1',
    mcp: 'mcp>=1.24.0',
    genai: 'google-genai>=1.27.0',
    a2a: 'a2a-sdk>=0.2.0,<1.0.0',

    // GCP SDKs -- stable, floor-only
    aiplatform: 'google-cloud-aiplatform[agent_engines]>=1.112.0',
    storage: 'google-cloud-storage>=2.14.0',
    scheduler: 'google-cloud-scheduler>=2.0.0',
    pubsub: 'google-cloud-pubsub>=2.0.0',
    firestore: 'google-cloud-firestore>=2.16.0',
    logging: 'google-cloud-logging>=3.0.0',

    // Utilities -- floor-only
    dotenv: 'python-dotenv>=1.0.0',
    dbDtypes: 'db-dtypes>=1.0.0',
    otel: 'opentelemetry-api>=1.20.0',

    // Build tools -- exact pin (infrastructure, not pip-resolved)
    pythonImage: 'python:3.11.12-slim',
    uvImage: 'ghcr.io/astral-sh/uv:0.11.17',
    uvVersion: '0.11.17',
    supergateway: 'supergateway@3.4.3',

    // Viewer app -- floor-only
    viewerFunctionsFramework: 'functions-framework>=3.5.0',
    viewerFlask: 'flask>=3.0.3',
    viewerFirestore: 'google-cloud-firestore>=2.16.0',
  };

  
  const escapedInstruction = systemInstruction
    .replace(/\\/g, '\\\\\\\\')
    .replace(/'/g, "'\\''")
    .replace(/\{/g, '{{')
    .replace(/\}/g, '}}')
    .replace(/\n/g, '\\n');

  // Build local BQ creation commands
  let bqCommands = `echo "🗄 Creating BigQuery Dataset: ${datasetId}..."\n`;
  bqCommands += `bq mk --dataset --location=US ${datasetId} 2>/dev/null || echo "    ✅ Dataset already exists."\n\n`;
  // Generate helper script
  bqCommands += `cat << 'EOF' > load_table.sh\n`;
  bqCommands += `#!/bin/bash\n`;
  bqCommands += `TABLE=\$1\n`;
  bqCommands += `CSV=\$2\n`;
  bqCommands += `SCHEMA=\$3\n`;
  bqCommands += `DATASET=\$4\n`;
  bqCommands += `echo "📥 Loading \$TABLE..."\n`;
  bqCommands += `if bq load --source_format=CSV --skip_leading_rows=1 --allow_quoted_newlines --null_marker="" --quote='"' --encoding=UTF-8 --max_bad_records=5 --location=US "\$DATASET.\$TABLE" "\$CSV" "\$SCHEMA"; then\n`;
  bqCommands += `  echo "    ✅ Loaded table: \$TABLE"\n`;
  bqCommands += `else\n`;
  bqCommands += `  echo "    ⚠️  ERROR: Failed to load table: \$TABLE"\n`;
  bqCommands += `  exit 1\n`;
  bqCommands += `fi\n`;
  bqCommands += `EOF\n`;
  bqCommands += `chmod +x load_table.sh\n\n`;

  // Write CSV files first
  for (const table of tables) {
    bqCommands += `cat <<'__CSV_EOF__' > ${table.tableName}.csv\n${table.csvData}\n__CSV_EOF__\n`;
  }

  bqCommands += `bq_fail=0\n`;
  bqCommands += `echo "📊 Loading tables in parallel..."\n`;
  bqCommands += `cat << 'EOF' | xargs -P 5 -n 4 ./load_table.sh\n`;
  for (const table of tables) {
    const schemaStr = table.schema.map(f => `${f.name}:${f.type}`).join(',');
    bqCommands += `${table.tableName} ${table.tableName}.csv ${schemaStr} ${datasetId}\n`;
  }
  bqCommands += `EOF\n`;
  bqCommands += `if [ \$? -ne 0 ]; then\n`;
  bqCommands += `  bq_fail=1\n`;
  bqCommands += `fi\n\n`;

  // Clean up helper script and CSV files
  bqCommands += `rm -f load_table.sh\n`;
  for (const table of tables) {
    bqCommands += `rm -f ${table.tableName}.csv\n`;
  }

  bqCommands += `if [ \$bq_fail -ne 0 ]; then\n`;
  bqCommands += `  echo "⚠️ Some BigQuery table loads failed. Please check above logs."\n`;
  bqCommands += `fi\n\n`;

  let firestoreCommands = '';
  if (firestore && firestore.collectionName && firestore.documents) {
    const fsDocsStr = JSON.stringify(firestore.documents).replace(/'/g, "\\'");

    firestoreCommands += `echo "🔥 Setting up Firestore database and collection: ${fsCollection}..."\n`;
    firestoreCommands += `gcloud firestore databases create --location=us-central1 2>/dev/null || echo "    ✅ Firestore Database already exists or initialized."\n\n`;
    
    firestoreCommands += `echo "    📥 Populating initial operational data via Python script..."\n`;
    firestoreCommands += `cat <<'__PY_EOF__' > setup_fs.py
import json
import os
from google.cloud import firestore

def init_data():
    db = firestore.Client()
    collection_name = "${fsCollection}"
    docs = json.loads('${fsDocsStr}')
    
    for doc in docs:
        doc_id = doc.get('id')
        data = doc.get('data', {})
        if doc_id:
            db.collection(collection_name).document(doc_id).set(data)
            print(f"      ✅ Inserted doc: {doc_id}")

if __name__ == '__main__':
    init_data()
__PY_EOF__\n`;

    firestoreCommands += `uv run --with google-cloud-firestore python setup_fs.py\n`;
    firestoreCommands += `rm setup_fs.py\n\n`;

    firestoreCommands += `echo "🌐 Deploying Real-time Data Viewer Web App (Cloud Run Functions)..."\n`;
    firestoreCommands += `mkdir -p ${dirName}/viewer_app\n`;
    // Generate system description dynamically based on the user's business goal.
    const systemDescPrompt = `You are an expert demo scenario writer.
Based on the provided business problem, generate a summary description (concise, 2-3 sentences) for an internal enterprise application that simulates a customer's operational console.

Business Problem: "${userGoal}"

Requirements:
1. Define what kind of system this is (e.g., "Enterprise Logistics Control Console").
2. Explain the business purpose of this system.
3. The output MUST be in the SAME LANGUAGE as the business problem provided above (e.g., Japanese if the problem is in Japanese).
4. Return ONLY the description text. Do not include greetings, explanations, or code blocks.`;

    let systemDescription = "";
    try {
      systemDescription = callVertexAI(systemDescPrompt).trim();
    } catch (e) {
      systemDescription = userGoal; // Fallback
    }

    const dashboardTitle = firestore.dashboardTitle || "Enterprise Operations Console";
    const kpi1Label = "Total Records";
    const kpi2Label = "Requires Action";
    const kpi3Label = "Resolved Actions";
    
    const btnAddText = "➕ Add Test Record";
    const btnUpdateText = "Update Status";
    const btnDeleteText = "Delete";
    
    const lblPolling = "Polling operational queue...";
    const lblTrail = "📜 Audit & Activity Trail";
    const lblChart = "📊 Status Distribution Summary";

    firestoreCommands += `cat <<'__VIEWER_MAIN__' > ${dirName}/viewer_app/main.py
import os
import time
import uuid
from flask import Flask, render_template_string, jsonify, request
from google.cloud import firestore

app = Flask(__name__)
db = firestore.Client()
COLLECTION = "${fsCollection}"

HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${dashboardTitle}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://unpkg.com/lucide@0.460.0"></script>
    <style>
        *, *::before, *::after { box-sizing: border-box; }
        :root {
            --bg: #f5f5f7; --surface: #ffffff; --border: #e5e7eb; --border-hover: #d1d5db;
            --primary: #4F46E5; --primary-hover: #4338CA; --primary-light: #EEF2FF;
            --success: #059669; --success-light: #D1FAE5;
            --warning: #D97706; --warning-light: #FEF3C7;
            --danger: #DC2626; --danger-light: #FEE2E2;
            --text-1: #111827; --text-2: #4B5563; --text-3: #6B7280;
            --radius: 16px; --radius-sm: 10px;
            --shadow-sm: 0 1px 2px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.03);
            --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -2px rgba(0,0,0,0.04);
            --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.06), 0 4px 6px -4px rgba(0,0,0,0.04);
            --ease: 200ms cubic-bezier(0.4, 0, 0.2, 1);
        }
        body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif; background: var(--bg); color: var(--text-1); margin: 0; padding: 24px; min-height: 100dvh; }
        body::before { content: ''; position: fixed; top: -200px; right: -200px; width: 600px; height: 600px; background: radial-gradient(circle, rgba(79,70,229,0.04) 0%, transparent 70%); pointer-events: none; }
        body::after { content: ''; position: fixed; bottom: -200px; left: -100px; width: 500px; height: 500px; background: radial-gradient(circle, rgba(124,58,237,0.03) 0%, transparent 70%); pointer-events: none; }

        .grid { position: relative; z-index: 1; display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; max-width: 1400px; margin: 0 auto; }
        .panel { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; box-shadow: var(--shadow-sm); transition: box-shadow var(--ease), transform var(--ease); animation: fadeUp 0.4s ease-out both; }
        .panel:hover { box-shadow: var(--shadow-md); }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

        .hdr { grid-column: span 4; display: flex; justify-content: space-between; align-items: center; padding: 20px 24px; }
        .hdr h1 { font-size: 22px; font-weight: 700; margin: 0; display: flex; align-items: center; gap: 10px; }
        .hdr h1 i { color: var(--primary); }
        .hdr-desc { font-size: 13px; color: var(--text-3); margin-top: 6px; line-height: 1.5; max-width: 600px; }
        .hdr-actions { display: flex; gap: 12px; align-items: center; }

        .btn-add { background: var(--primary); color: #fff; border: none; padding: 10px 18px; border-radius: var(--radius-sm); font-size: 13px; font-weight: 600; font-family: inherit; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: all var(--ease); box-shadow: 0 1px 2px rgba(79,70,229,0.2); }
        .btn-add:hover { background: var(--primary-hover); box-shadow: 0 4px 12px rgba(79,70,229,0.25); transform: translateY(-1px); }
        .btn-add:active { transform: translateY(0); }
        .btn-add:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
        .btn-add:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        .btn-add .spinner { display: none; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 0.6s linear infinite; }
        .btn-add.loading .spinner { display: block; }
        .btn-add.loading .btn-text { display: none; }
        @keyframes spin { to { transform: rotate(360deg); } }

        .live { display: inline-flex; align-items: center; gap: 6px; background: var(--success-light); color: var(--success); padding: 6px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
        .live-dot { width: 7px; height: 7px; background: var(--success); border-radius: 50%; position: relative; }
        .live-dot::after { content: ''; position: absolute; inset: 0; border-radius: 50%; background: inherit; animation: ping 2s cubic-bezier(0,0,0.2,1) infinite; }
        @keyframes ping { 0% { transform: scale(1); opacity: 0.8; } 75%, 100% { transform: scale(2.5); opacity: 0; } }

        .kpi { text-align: center; padding: 0; overflow: hidden; }
        .kpi-bar { height: 3px; background: linear-gradient(90deg, var(--primary), #7C3AED); }
        .kpi-inner { padding: 16px 20px 20px; }
        .kpi-lbl { font-size: 11px; color: var(--text-3); text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px; }
        .kpi-val { font-size: 36px; font-weight: 700; color: var(--text-1); margin-top: 6px; font-variant-numeric: tabular-nums; line-height: 1.1; }

        .main { grid-column: span 3; grid-row: span 2; }
        .sec-title { font-size: 15px; font-weight: 600; margin: 0 0 16px 0; display: flex; align-items: center; gap: 8px; color: var(--text-1); }
        .sec-title i { color: var(--primary); width: 18px; height: 18px; }
        .chart-area { grid-column: span 1; }


        .records { display: flex; flex-direction: column; gap: 12px; }
        .empty-state { text-align: center; padding: 40px 20px; color: var(--text-3); }
        .empty-state i { width: 40px; height: 40px; margin-bottom: 12px; opacity: 0.4; }
        .empty-state p { font-size: 14px; margin: 0; }

        .card { 
            border: 1px solid var(--border); 
            border-radius: var(--radius-sm); 
            padding: 16px 20px; 
            transition: all var(--ease); 
            border-left: 4px solid var(--border); 
            position: relative; 
            display: flex; 
            flex-direction: row; 
            align-items: center; 
            justify-content: space-between; 
            gap: 24px; 
            background: var(--bg-1);
            cursor: pointer;
        }
        .card:hover { box-shadow: var(--shadow-md); transform: translateY(-1px); border-color: var(--border-hover); }
        .card-col-meta { width: 20%; display: flex; flex-direction: column; gap: 6px; }
        .card-col-main { width: 60%; display: flex; flex-direction: column; gap: 6px; }
        .card-col-actions { width: 20%; display: flex; flex-direction: column; align-items: flex-end; justify-content: space-between; gap: 10px; min-height: 75px; }
        .card.s-resolved { border-left-color: var(--success); }
        .card.s-pending { border-left-color: var(--warning); }
        .card.s-flagged { border-left-color: var(--danger); }
        .card-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
        .card-id { font-size: 12px; font-family: 'SF Mono', 'Fira Code', monospace; color: var(--text-3); display: flex; align-items: center; gap: 4px; }
        .card-id i { width: 12px; height: 12px; }
        .badge { font-size: 10px; font-weight: 600; padding: 3px 8px; border-radius: 6px; text-transform: uppercase; letter-spacing: 0.3px; }
        .badge.resolved { background: var(--success-light); color: var(--success); }
        .badge.pending { background: var(--warning-light); color: var(--warning); }
        .badge.flagged { background: var(--danger-light); color: var(--danger); }

        .field { font-size: 13px; margin-bottom: 5px; display: flex; justify-content: space-between; gap: 8px; }
        .field-k { color: var(--text-3); font-size: 12px; flex-shrink: 0; }
        .field-v { font-weight: 500; color: var(--text-1); font-size: 13px; text-align: right; max-width: 65%; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.4; word-break: break-word; }
        .card { cursor: pointer; }
        .card-expand { text-align: center; font-size: 11px; color: var(--primary); padding: 6px 0 0; opacity: 0; transition: opacity var(--ease); }
        .card:hover .card-expand { opacity: 1; }
        .card-expand i { width: 12px; height: 12px; vertical-align: -2px; }
        /* Record detail modal reuses .modal-overlay / .modal from task modal */
        .detail-field { display: flex; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border); }
        .detail-field:last-child { border-bottom: none; }
        .detail-field-k { font-size: 12px; font-weight: 600; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.3px; min-width: 100px; flex-shrink: 0; padding-top: 2px; }
        .detail-field-v { font-size: 13px; color: var(--text-1); line-height: 1.6; word-break: break-word; white-space: pre-wrap; flex: 1; }

        .card-actions { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); width: 100%; }
        .card-actions select { 
            font-size: 11px; 
            font-weight: 600;
            padding: 5px 24px 5px 10px; 
            border-radius: 12px; 
            border: 1px solid transparent; 
            font-family: inherit; 
            cursor: pointer; 
            transition: all var(--ease); 
            -webkit-appearance: none; 
            appearance: none;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236B7280' stroke-width='2.5'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19.5 8.25l-7.5 7.5-7.5-7.5'/%3E%3C/svg%3E");
            background-size: 11px;
            background-position: right 8px center;
            background-repeat: no-repeat;
        }
        .card-actions select.sel-pending { background-color: var(--warning-light); color: var(--warning); border-color: rgba(217, 119, 6, 0.15); }
        .card-actions select.sel-resolved { background-color: var(--success-light); color: var(--success); border-color: rgba(5, 150, 105, 0.15); }
        .card-actions select.sel-flagged { background-color: var(--danger-light); color: var(--danger); border-color: rgba(220, 38, 38, 0.15); }
        .card-actions select:hover { opacity: 0.9; box-shadow: var(--shadow-sm); }
        .card-actions select:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
        .btn-del { background: none; color: var(--text-3); border: 1px solid var(--border); padding: 6px 8px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all var(--ease); min-width: 32px; min-height: 32px; }
        .btn-del:hover { color: var(--danger); border-color: var(--danger); background: var(--danger-light); }
        .btn-del:focus-visible { outline: 2px solid var(--danger); outline-offset: 1px; }
        .btn-del i { width: 14px; height: 14px; }

        .chart-wrap { height: 200px; }


        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

        @keyframes pulse { 0% { background: var(--primary-light); } 100% { background: var(--surface); } }
        .updated-card { animation: pulse 1.5s ease-out; }

        @media (prefers-reduced-motion: reduce) {
            *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
        }
        @media (max-width: 1024px) { .grid { grid-template-columns: repeat(2, 1fr); } .hdr, .main, .chart-area { grid-column: span 2; } .kpi { grid-column: span 1; } }
        @media (max-width: 640px) { body { padding: 12px; } .grid { grid-template-columns: 1fr; gap: 12px; } .hdr, .main, .chart-area, .kpi { grid-column: span 1; } .hdr { flex-direction: column; align-items: flex-start; gap: 12px; } .records { grid-template-columns: 1fr; } }

        /* --- Tab Navigation --- */
        .tab-bar { display: flex; gap: 4px; max-width: 1400px; margin: 0 auto 16px; background: rgba(255,255,255,0.85); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid var(--border); border-radius: var(--radius); padding: 4px; box-shadow: var(--shadow-sm); position: sticky; top: 12px; z-index: 50; }
        .tab-btn { flex: 1; padding: 10px 20px; border: none; background: none; font-family: inherit; font-size: 13px; font-weight: 600; color: var(--text-3); cursor: pointer; border-radius: 12px; transition: all var(--ease); display: flex; align-items: center; justify-content: center; gap: 8px; }
        .tab-btn:hover { color: var(--text-1); background: var(--bg); }
        .tab-btn.active { background: var(--primary); color: #fff; box-shadow: 0 2px 8px rgba(79,70,229,0.25); }
        .tab-btn i { width: 16px; height: 16px; }
        .tab-view { display: none; }
        .tab-view.active { display: block; }
        .task-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 14px; }
        .tcard { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px; box-shadow: var(--shadow-sm); transition: all var(--ease); border-left: 4px solid var(--border); animation: fadeUp 0.3s ease-out both; }
        .tcard:hover { box-shadow: var(--shadow-md); transform: translateY(-2px); }
        .tcard.ts-completed { border-left-color: var(--success); }
        .tcard.ts-working { border-left-color: var(--primary); }
        .tcard.ts-submitted { border-left-color: var(--warning); }
        .tcard.ts-failed { border-left-color: var(--danger); }
        .tcard.ts-cancelled { border-left-color: var(--text-3); }
        .tcard-hdr { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
        .tcard-name { font-size: 14px; font-weight: 600; color: var(--text-1); display: flex; align-items: center; gap: 6px; }
        .tcard-name i { width: 14px; height: 14px; color: var(--primary); }
        .tcard-type { font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 6px; text-transform: uppercase; background: var(--primary-light); color: var(--primary); }
        .tcard-desc { font-size: 12px; color: var(--text-3); margin-bottom: 10px; line-height: 1.5; white-space: pre-wrap; }
        .tcard-meta { font-size: 11px; color: var(--text-3); display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 10px; }
        .tcard-meta span { display: flex; align-items: center; gap: 4px; }
        .tcard-meta i { width: 12px; height: 12px; }
        .tbadge { font-size: 10px; font-weight: 700; padding: 3px 10px; border-radius: 6px; text-transform: uppercase; }
        .tbadge.completed { background: var(--success-light); color: var(--success); }
        .tbadge.working { background: var(--primary-light); color: var(--primary); animation: pulse 2s infinite; }
        .tbadge.submitted { background: var(--warning-light); color: var(--warning); }
        .tbadge.failed { background: var(--danger-light); color: var(--danger); }
        .tbadge.cancelled, .tbadge.unknown { background: #f3f4f6; color: var(--text-3); }
        .tprogress { height: 4px; background: var(--border); border-radius: 2px; margin-bottom: 10px; overflow: hidden; }
        .tprogress-bar { height: 100%; background: linear-gradient(90deg, var(--primary), #7C3AED); border-radius: 2px; transition: width 0.5s ease; }
        .tcard-result { font-size: 12px; color: var(--text-2); background: var(--bg); border-radius: var(--radius-sm); padding: 10px 12px; margin-bottom: 10px; max-height: 80px; overflow: hidden; line-height: 1.5; cursor: pointer; position: relative; }
        .tcard-result::after { content: 'Click to expand'; position: absolute; bottom: 0; left: 0; right: 0; text-align: center; font-size: 10px; color: var(--primary); background: linear-gradient(transparent, var(--bg)); padding: 8px 0 4px; }
        .tcard-actions { display: flex; gap: 8px; justify-content: flex-end; padding-top: 10px; border-top: 1px solid var(--border); }
        .tbtn { font-size: 11px; font-weight: 600; font-family: inherit; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); color: var(--text-2); cursor: pointer; transition: all var(--ease); display: flex; align-items: center; gap: 4px; }
        .tbtn:hover { border-color: var(--border-hover); background: var(--bg); }
        .tbtn.danger:hover { color: var(--danger); border-color: var(--danger); background: var(--danger-light); }
        .tbtn i { width: 12px; height: 12px; }
        .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 100; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
        .modal-overlay.open { display: flex; }
        .modal { background: var(--surface); border-radius: var(--radius); padding: 24px; max-width: 700px; width: 90%; max-height: 80vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.15); animation: fadeUp 0.2s ease-out; }
        .modal h3 { margin: 0 0 16px; font-size: 18px; display: flex; align-items: center; gap: 8px; }
        .modal pre { background: var(--bg); border-radius: var(--radius-sm); padding: 16px; font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; max-height: 50vh; overflow-y: auto; }
        .modal-close { position: absolute; top: 16px; right: 16px; background: none; border: none; cursor: pointer; color: var(--text-3); }
        .wf-progress { height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; margin: 6px 0; }
        .wf-progress-bar { height: 100%; background: linear-gradient(90deg, var(--primary), #7C3AED); border-radius: 3px; transition: width 0.3s ease; }
        .timeline-entry { display: flex; gap: 8px; padding: 6px 0; border-left: 2px solid var(--border); padding-left: 12px; margin-left: 4px; }
        .timeline-ts { font-size: 11px; color: var(--text-3); min-width: 80px; flex-shrink: 0; }
        .timeline-by { font-size: 11px; color: var(--primary); font-weight: 500; }
    </style>
</head>
<body>
    <div class="tab-bar">
        <button class="tab-btn active" onclick="switchTab('data')" id="tab-data"><i data-lucide="database"></i> Data</button>
        <button class="tab-btn" onclick="switchTab('tasks')" id="tab-tasks"><i data-lucide="zap"></i> Tasks <span id="task-count-badge" style="background:var(--warning-light);color:var(--warning);font-size:10px;padding:1px 6px;border-radius:8px;display:none;">0</span></button>
        <button class="tab-btn" onclick="switchTab('activity')" id="tab-activity"><i data-lucide="scroll-text"></i> Activity <span id="activity-count-badge" style="background:var(--bg);color:var(--text-3);font-size:10px;padding:1px 6px;border-radius:8px;display:none;">0</span></button>
    </div>

    <div id="data-view" class="tab-view active">
    <div class="grid">
        <div class="panel hdr" style="animation-delay:0ms">
            <div>
                <h1><i data-lucide="activity"></i> ${dashboardTitle}</h1>
                <div class="hdr-desc">${systemDescription.replace(/"/g, '&quot;').replace(/\\n/g, ' ')}</div>
            </div>
            <div class="hdr-actions">
                <button class="btn-add" id="addBtn" onclick="addMockRecord()"><span class="btn-text"><i data-lucide="plus" style="width:14px;height:14px;"></i> Add Record</span><span class="spinner"></span></button>
                <div class="live"><span class="live-dot"></span>Live Sync</div>
            </div>
        </div>

        <div class="panel kpi" style="animation-delay:50ms"><div class="kpi-bar"></div><div class="kpi-inner"><div class="kpi-lbl">Total Records</div><div class="kpi-val" id="kpi-1">0</div></div></div>
        <div class="panel kpi" style="animation-delay:100ms"><div class="kpi-bar"></div><div class="kpi-inner"><div class="kpi-lbl">Requires Action</div><div class="kpi-val" id="kpi-2">0</div></div></div>
        <div class="panel kpi" style="animation-delay:150ms"><div class="kpi-bar"></div><div class="kpi-inner"><div class="kpi-lbl">Resolved</div><div class="kpi-val" id="kpi-3">0</div></div></div>
        <div class="panel kpi" style="animation-delay:200ms"><div class="kpi-bar"></div><div class="kpi-inner"><div class="kpi-lbl">Status</div><div class="kpi-val" style="font-size:16px;color:var(--success);margin-top:10px;">Operational</div></div></div>

        <div class="panel main" style="animation-delay:250ms">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                <h2 class="sec-title" style="margin:0;"><i data-lucide="database"></i> Records</h2>
                <div style="display:flex;align-items:center;gap:6px;background:var(--bg-2);border:1px solid var(--border);padding:4px 8px;border-radius:8px;">
                    <i data-lucide="sliders-horizontal" style="width:12px;height:12px;color:var(--text-3);"></i>
                    <select id="recordSortSelect" onchange="window.handleRecordSort(this.value)" style="background:transparent;border:none;color:var(--text-2);font-size:10.5px;font-weight:600;outline:none;cursor:pointer;padding-right:4px;">
                        <option value="updated">🔄 Recent Updates</option>
                        <option value="priority">⚠️ Priority</option>
                        <option value="status">🚦 Status</option>
                    </select>
                </div>
            </div>
            <div id="records" class="records">
                <div class="empty-state"><i data-lucide="inbox"></i><p>Loading records...</p></div>
            </div>
        </div>

        <div class="panel chart-area" style="animation-delay:300ms">
            <h2 class="sec-title"><i data-lucide="pie-chart"></i> Status Distribution</h2>
            <div class="chart-wrap"><canvas id="chart1"></canvas></div>
        </div>
        <div class="panel chart-area" style="animation-delay:350ms">
            <h2 class="sec-title"><i data-lucide="bar-chart-3"></i> Priority Distribution</h2>
            <div class="chart-wrap"><canvas id="chart2"></canvas></div>
        </div>


    </div>
    </div>

    <div id="tasks-view" class="tab-view">
        <div class="grid">
            <div class="panel kpi" style="animation-delay:50ms"><div class="kpi-bar"></div><div class="kpi-inner"><div class="kpi-lbl">Total Tasks</div><div class="kpi-val" id="tkpi-total">0</div></div></div>
            <div class="panel kpi" style="animation-delay:100ms"><div class="kpi-bar"></div><div class="kpi-inner"><div class="kpi-lbl">Running</div><div class="kpi-val" id="tkpi-running" style="color:var(--primary)">0</div></div></div>
            <div class="panel kpi" style="animation-delay:150ms"><div class="kpi-bar"></div><div class="kpi-inner"><div class="kpi-lbl">Completed</div><div class="kpi-val" id="tkpi-completed" style="color:var(--success)">0</div></div></div>
            <div class="panel kpi" style="animation-delay:200ms"><div class="kpi-bar"></div><div class="kpi-inner"><div class="kpi-lbl">Failed</div><div class="kpi-val" id="tkpi-failed" style="color:var(--danger)">0</div></div></div>
            <div class="panel" style="grid-column:span 4;animation-delay:250ms">
                <h2 class="sec-title"><i data-lucide="zap"></i> Background Tasks</h2>
                <div id="task-list" class="task-grid">
                    <div class="empty-state"><i data-lucide="inbox"></i><p>No tasks registered yet.</p></div>
                </div>
            </div>
        </div>
    </div>

    <div id="activity-view" class="tab-view">
        <div class="grid">
            <div class="panel" style="grid-column:span 4;animation-delay:50ms">
                <h2 class="sec-title"><i data-lucide="scroll-text"></i> Unified Activity Log</h2>
                <div class="hdr-desc" style="margin-bottom:16px;">Firestore document changes and BigQuery DML operations are displayed here.</div>
                <div id="activity-feed" class="task-grid">
                    <div class="empty-state"><i data-lucide="inbox"></i><p>No activity recorded yet.</p></div>
                </div>
            </div>
        </div>
    </div>

    <div class="modal-overlay" id="task-modal" onclick="if(event.target===this)closeModal()">
        <div class="modal" style="position:relative;">
            <button class="modal-close" onclick="closeModal()"><i data-lucide="x" style="width:20px;height:20px;"></i></button>
            <h3 id="modal-title"><i data-lucide="file-text"></i> Task Detail</h3>
            <div id="modal-meta" class="tcard-meta" style="margin-bottom:16px;"></div>
            <pre id="modal-body">Loading...</pre>
        </div>
    </div>

    <div class="modal-overlay" id="record-modal" onclick="if(event.target===this)closeModal()">
        <div class="modal" style="position:relative;">
            <button class="modal-close" onclick="closeModal()"><i data-lucide="x" style="width:20px;height:20px;"></i></button>
            <h3 id="rec-modal-title"><i data-lucide="database"></i> Record Detail</h3>
            <div id="rec-modal-meta" class="tcard-meta" style="margin-bottom:16px;"></div>
            <div id="rec-modal-body">Loading...</div>
        </div>
    </div>

    <script>
        lucide.createIcons();
        let docStates = {};
        let chart1, chart2;
        let isFirstLoad = true;

        function initCharts() {
            const sharedFont = { family: "'Inter', sans-serif" };
            chart1 = new Chart(document.getElementById('chart1'), {
                type: 'doughnut',
                data: { labels: ['Flagged', 'Resolved', 'Pending'], datasets: [{ data: [0, 0, 0], backgroundColor: ['#EA580C', '#2563EB', '#D97706'], borderWidth: 0, borderRadius: 3 }] },
                options: { maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 16, font: { size: 12, ...sharedFont } } }, tooltip: { callbacks: { label: function(c) { let t = c.dataset.data.reduce((a,b) => a+b, 0); let p = t > 0 ? Math.round(c.raw / t * 100) : 0; return c.label + ': ' + c.raw + ' (' + p + '%)'; } } } } }
            });
            chart2 = new Chart(document.getElementById('chart2'), {
                type: 'bar',
                data: { labels: ['High', 'Medium', 'Low'], datasets: [{ label: 'Records', data: [0, 0, 0], backgroundColor: ['#7C3AED', '#4F46E5', '#818CF8'], borderRadius: 6, borderSkipped: false }] },
                options: { maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(c) { return c.raw + ' records'; } } } }, scales: { x: { grid: { display: false }, ticks: { precision: 0, font: sharedFont } }, y: { grid: { display: false }, ticks: { font: { ...sharedFont, weight: 500 } } } } }
            });
        }

        function getStatusClass(s) {
            s = s ? s.toLowerCase() : '';
            if (s.includes('resolve') || s.includes('success') || s.includes('clear')) return 'resolved';
            if (s.includes('flag') || s.includes('error') || s.includes('high')) return 'flagged';
            return 'pending';
        }

        let currentSort = 'updated';
        let lastFetchedData = [];

        window.handleRecordSort = function(val) {
            currentSort = val;
            if (lastFetchedData && lastFetchedData.length > 0) {
                renderSortedRecords();
            }
        };

        function renderSortedRecords() {
            const grid = document.getElementById('records');
            if (!lastFetchedData || lastFetchedData.length === 0) return;
            
            let sorted = [...lastFetchedData];
            
            if (currentSort === 'updated') {
                sorted.sort((a, b) => {
                    let ta = a.data.updated_at || a.data.created_at || a.id || '';
                    let tb = b.data.updated_at || b.data.created_at || b.id || '';
                    return tb.localeCompare(ta);
                });
            } else if (currentSort === 'priority') {
                const weight = { 'high': 3, 'medium': 2, 'low': 1 };
                sorted.sort((a, b) => {
                    let pa = (a.data.priority || a.data.Priority || 'medium').toLowerCase();
                    let pb = (b.data.priority || b.data.Priority || 'medium').toLowerCase();
                    return (weight[pb] || 0) - (weight[pa] || 0);
                });
            } else if (currentSort === 'status') {
                const weight = { 'flagged': 3, 'pending': 2, 'resolved': 1 };
                sorted.sort((a, b) => {
                    let sa = getStatusClass(a.data.status || a.data.Status);
                    let sb = getStatusClass(b.data.status || b.data.Status);
                    return (weight[sb] || 0) - (weight[sa] || 0);
                });
            }
            
            const existingCards = {};
            grid.querySelectorAll('.card').forEach(c => {
                existingCards[c.getAttribute('data-id')] = c;
            });
            
            sorted.forEach(doc => {
                let card = existingCards[doc.id];
                if (card) {
                    grid.appendChild(card);
                }
            });
        }

        async function fetchData() {
            try {
                const res = await fetch('/api/data');
                const data = await res.json();
                lastFetchedData = data;
                const grid = document.getElementById('records');

                if (data.length === 0) {
                    grid.innerHTML = '<div class="empty-state"><i data-lucide="inbox"></i><p>No records yet. Click "Add Record" to get started.</p></div>';
                    lucide.createIcons();
                    document.getElementById('kpi-1').textContent = '0';
                    document.getElementById('kpi-2').textContent = '0';
                    document.getElementById('kpi-3').textContent = '0';
                    if (chart1) { chart1.data.datasets[0].data = [0, 0, 0]; chart1.update(); }
                    if (chart2) { chart2.data.datasets[0].data = [0, 0, 0]; chart2.update(); }
                    isFirstLoad = false;
                    return;
                }

                if (isFirstLoad || grid.querySelector('.empty-state')) grid.innerHTML = '';

                let currentIds = new Set();
                let counts = { flagged: 0, resolved: 0, pending: 0 };
                let priorityCounts = { High: 0, Medium: 0, Low: 0 };

                data.forEach(doc => {
                    currentIds.add(doc.id);
                    let statusStr = doc.data.status || doc.data.Status || 'Pending';
                    let bClass = getStatusClass(statusStr);
                    counts[bClass]++;
                    let priority = doc.data.priority || doc.data.Priority || 'Medium';
                    if (priorityCounts.hasOwnProperty(priority)) priorityCounts[priority]++;

                    let docFingerprint = JSON.stringify(doc.data);
                    let isNew = !docStates[doc.id];
                    let isUpdated = !isNew && docStates[doc.id].fp !== docFingerprint;
                    if (isNew || isUpdated) {
                        docStates[doc.id] = { status: statusStr, fp: docFingerprint };
                    }

                    let card = document.querySelector(\`[data-id="\${doc.id}"]\`);
                    let fieldsHtml = '';
                    let fieldCount = 0;
                    for (const [key, val] of Object.entries(doc.data)) {
                        if (key === 'status' || key === 'Status') continue;
                        let displayVal = val;
                        if (key === 'workflow_state' && val && typeof val === 'object') {
                            let step = val.current_step || '';
                            let total = val.total_steps || '';
                            let approval = val.pending_approval ? '⏳ Pending' : '✅ OK';
                            let isNumericStep = step && !isNaN(step);
                            if (isNumericStep && total) {
                                displayVal = 'Step ' + step + '/' + total + ' • ' + approval;
                            } else {
                                displayVal = 'Step: ' + (step || 'unknown') + ' • ' + approval;
                            }
                        } else if (key === 'activity_log' && Array.isArray(val)) {
                            let latest = val[val.length - 1];
                            displayVal = val.length + ' entries';
                            if (latest && latest.action) displayVal += ' • ' + latest.action;
                        } else if (val && typeof val === 'object') {
                            if (Array.isArray(val)) {
                                displayVal = val.map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(', ');
                            } else {
                                displayVal = Object.entries(val).map(([k,v]) => k + ': ' + v).join(', ');
                            }
                        }
                        displayVal = String(displayVal);
                        fieldsHtml += \`<div class="field"><span class="field-k">\${key}</span><span class="field-v" title="\${displayVal.replace(/"/g, '&quot;')}">\${displayVal}</span></div>\`;
                        fieldCount++;
                    }
                    if (!card) {
                        card = document.createElement('div');
                        card.className = 'card';
                        card.setAttribute('data-id', doc.id);
                        grid.appendChild(card);
                    }
                    if ((isNew && !isFirstLoad) || isUpdated) {
                        card.classList.add('updated-card');
                        setTimeout(() => card.classList.remove('updated-card'), 1500);
                    }
                    card.className = \`card s-\${bClass}\`;
                    card.setAttribute('data-id', doc.id);
                    card.innerHTML = \`
                        <div class="card-top" onclick="openRecordDetail('\${doc.id}')">
                            <div class="card-id"><i data-lucide="hash"></i>\${doc.id}</div>
                            <span class="badge \${bClass}">\${statusStr}</span>
                        </div>
                        <div onclick="openRecordDetail('\${doc.id}')">\${fieldsHtml}</div>
                        <div class="card-expand" onclick="openRecordDetail('\${doc.id}')"><i data-lucide="chevrons-up-down"></i> View all \${fieldCount} fields</div>
                        <div class="card-actions">
                            <select aria-label="Change status for \${doc.id}" onchange="event.stopPropagation(); updateStatus('\${doc.id}', this.value)">
                                <option value="Pending" \${statusStr==='Pending'?'selected':''}>Pending</option>
                                <option value="Resolved" \${statusStr==='Resolved'?'selected':''}>Resolved</option>
                                <option value="Flagged" \${statusStr==='Flagged'?'selected':''}>Flagged</option>
                            </select>
                            <button class="btn-del" onclick="event.stopPropagation(); deleteRecord('\${doc.id}')" aria-label="Delete record \${doc.id}"><i data-lucide="trash-2"></i></button>
                        </div>
                    \`;
                });

                // Dynamic Notion-style Row Card Transformer (Flicker-free)
                grid.querySelectorAll('.card').forEach(card => {
                    if (card.querySelector('.card-col-meta')) return;

                    const docId = card.getAttribute('data-id');
                    const badge = card.querySelector('.badge');
                    const statusStr = badge ? badge.textContent : 'Pending';
                    const bClass = getStatusClass(statusStr);
                    
                    const fields = {};
                    card.querySelectorAll('.field').forEach(f => {
                        const k = f.querySelector('.field-k').textContent.trim();
                        const v = f.querySelector('.field-v').textContent.trim();
                        fields[k] = v;
                    });

                    const assignedTo = fields.assigned_to || fields.AssignedTo || 'Unassigned';
                    const customerName = fields.customer_name || fields.CustomerName || '';
                    const productName = fields.product_name || fields.ProductName || '';
                    const qty = fields.requested_qty || fields.RequestedQty || fields.qty || fields.Quantity || '';
                    const notes = fields.notes || fields.Notes || fields.message || '';
                    const wfStateStr = fields.workflow_state || '';

                    let colMeta = '<div class="card-col-meta">';
                    colMeta += '  <div class="card-top" style="margin-bottom:6px;justify-content:flex-start;gap:8px;align-items:center;">';
                    colMeta += '    <div class="card-id" style="font-size:13px;font-weight:700;color:var(--text-1);"><i data-lucide="hash" style="width:12px;height:12px;"></i>' + docId + '</div>';
                    colMeta += '    <span class="badge ' + bClass + '" style="font-size:9px;padding:2px 6px;">' + statusStr + '</span>';
                    colMeta += '  </div>';
                    colMeta += '  <div style="font-size:11px;color:var(--text-3);display:flex;flex-direction:column;gap:2px;">';
                    colMeta += '    <span>👤 ' + assignedTo + '</span>';
                    if (customerName) colMeta += '    <span style="font-weight:600;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px;" title="' + customerName.replace(/"/g, '&quot;') + '">🏢 ' + customerName + '</span>';
                    colMeta += '  </div>';
                    colMeta += '</div>';

                    let colMain = '<div class="card-col-main">';
                    if (productName) {
                        let qtyText = qty ? ' (' + qty + ' units)' : '';
                        colMain += '  <div style="font-size:13px;font-weight:600;color:var(--text-1);margin-bottom:4px;">📦 ' + productName + qtyText + '</div>';
                    }
                    if (notes) {
                        colMain += '  <div style="font-size:12.5px;color:var(--text-2);line-height:1.5;background:var(--bg-2);padding:10px 14px;border-radius:8px;border-left:4px solid var(--primary-light);display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;" title="' + notes.replace(/"/g, '&quot;') + '">📝 ' + notes + '</div>';
                    } else {
                        colMain += '  <div style="font-size:11px;color:var(--text-4);font-style:italic;">No additional notes recorded.</div>';
                    }
                    colMain += '</div>';

                    let colActions = '<div class="card-col-actions">';
                    if (wfStateStr) {
                        colActions += '  <div style="font-size:10px;font-weight:600;color:var(--text-3);background:var(--bg-2);padding:3px 8px;border-radius:20px;border:1px solid var(--border);display:inline-flex;align-items:center;gap:4px;"><i data-lucide="git-pull-request" style="width:10px;height:10px;color:var(--primary);"></i> ' + wfStateStr + '</div>';
                    }
                    colActions += '  <div style="display:flex;align-items:center;gap:8px;width:100%;justify-content:flex-end;">';
                    
                    const existingActions = card.querySelector('.card-actions');
                    if (existingActions) {
                        let selectHtml = existingActions.querySelector('select').outerHTML;
                        selectHtml = selectHtml.replace('<select', '<select class="sel-' + bClass + '"');
                        colActions += '    <div style="display:flex;align-items:center;gap:8px;">' + selectHtml + existingActions.querySelector('button').outerHTML + '</div>';
                    }
                    colActions += '  </div>';
                    colActions += '</div>';

                    card.innerHTML = colMeta + colMain + colActions;
                    
                    card.querySelectorAll('.card-col-meta, .card-col-main').forEach(col => {
                        col.addEventListener('click', () => openRecordDetail(docId));
                    });
                });

                renderSortedRecords();
                lucide.createIcons();
                isFirstLoad = false;

                Array.from(grid.children).forEach(child => {
                    const id = child.getAttribute('data-id');
                    if (id && !currentIds.has(id)) {
                        child.remove();
                        delete docStates[id];
                    }
                });

                document.getElementById('kpi-1').textContent = data.length;
                document.getElementById('kpi-2').textContent = counts.flagged + counts.pending;
                document.getElementById('kpi-3').textContent = counts.resolved;
                if (chart1) { chart1.data.datasets[0].data = [counts.flagged, counts.resolved, counts.pending]; chart1.update(); }
                if (chart2) { chart2.data.datasets[0].data = [priorityCounts.High, priorityCounts.Medium, priorityCounts.Low]; chart2.update(); }
            } catch (e) { console.error('Fetch error:', e); }
        }

        async function addMockRecord() {
            const btn = document.getElementById('addBtn');
            btn.classList.add('loading');
            btn.disabled = true;
            try {
                const id = "REC-" + Math.floor(100 + Math.random() * 900);
                await fetch('/api/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id, data: { status: "Pending", priority: "Medium", assigned_to: "Ops Gen" } }) });
                await fetchData();
            } finally {
                btn.classList.remove('loading');
                btn.disabled = false;
            }
        }

        async function updateStatus(id, status) {
            await fetch('/api/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id, status: status }) });
            fetchData();
        }

        async function deleteRecord(id) {
            if (!confirm('Delete record ' + id + '?')) return;
            await fetch('/api/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) });
            fetchData();
        }


        // --- Tab & Task Management ---
        let activeTab = 'data';

        function switchTab(tab) {
            activeTab = tab;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-view').forEach(v => v.classList.remove('active'));
            document.getElementById('tab-' + tab).classList.add('active');
            document.getElementById(tab + '-view').classList.add('active');
            lucide.createIcons();
        }

        // Cache of task data hashes to detect changes for incremental DOM updates
        const _taskHashCache = {};

        function _buildTaskCard(t) {
            const typeIcon = t.task_type === 'scheduled' ? 'calendar-clock' : 'zap';
            const typeLabel = t.task_type === 'scheduled' ? 'SCHEDULED' : 'IMMEDIATE';
            let meta = '';
            if (t.schedule_cron) meta += \`<span><i data-lucide="clock"></i>\${t.schedule_cron}</span>\`;
            if (t.started_at) meta += \`<span><i data-lucide="play"></i>\${new Date(t.started_at).toLocaleString()}</span>\`;
            if (t.completed_at) meta += \`<span><i data-lucide="check-circle"></i>\${new Date(t.completed_at).toLocaleString()}</span>\`;
            let progress = '';
            if (t.status === 'working') progress = \`<div class="tprogress"><div class="tprogress-bar" style="width:\${t.progress_pct}%"></div></div>\`;
            let result = '';
            if (t.result_summary) result = \`<div class="tcard-result" onclick="openTaskDetail('\${t.task_id}')">\${t.result_summary.substring(0, 200)}</div>\`;
            let actions = '';
            if (t.status === 'working' || t.status === 'submitted') {
                actions += \`<button class="tbtn" onclick="cancelTask('\${t.task_id}')"><i data-lucide="x-circle"></i> Cancel</button>\`;
            }
            actions += \`<button class="tbtn" onclick="openTaskDetail('\${t.task_id}')"><i data-lucide="eye"></i> Detail</button>\`;
            actions += \`<button class="tbtn danger" onclick="deleteTask('\${t.task_id}')"><i data-lucide="trash-2"></i></button>\`;
            return \`<div class="tcard-hdr">
                <div class="tcard-name"><i data-lucide="\${typeIcon}"></i>\${t.task_name || t.task_id}</div>
                <span class="tbadge \${t.status}">\${t.status}</span>
            </div>
            <div class="tcard-desc">\${t.task_description || ''}</div>
            \${progress}
            <div class="tcard-meta">\${meta}<span class="tcard-type">\${typeLabel}</span></div>
            \${result}
            <div class="tcard-actions">\${actions}</div>\`;
        }

        function _taskHash(t) {
            return [t.task_id, t.status, t.progress_pct, t.result_summary||'', t.started_at||'', t.completed_at||''].join('|');
        }

        async function fetchTasks() {
            try {
                const res = await fetch('/api/tasks');
                const data = await res.json();
                const tasks = data.tasks || [];
                const grid = document.getElementById('task-list');

                // KPIs
                const running = tasks.filter(t => t.status === 'working' || t.status === 'submitted').length;
                const completed = tasks.filter(t => t.status === 'completed').length;
                const failed = tasks.filter(t => t.status === 'failed').length;
                document.getElementById('tkpi-total').textContent = tasks.length;
                document.getElementById('tkpi-running').textContent = running;
                document.getElementById('tkpi-completed').textContent = completed;
                document.getElementById('tkpi-failed').textContent = failed;

                // Badge on tab — show total task count always
                const badge = document.getElementById('task-count-badge');
                if (tasks.length > 0) {
                    badge.textContent = tasks.length;
                    badge.style.display = 'inline';
                    if (running > 0) { badge.style.background = 'var(--primary-light)'; badge.style.color = 'var(--primary)'; badge.style.animation = 'pulse 2s infinite'; }
                    else { badge.style.background = 'var(--bg)'; badge.style.color = 'var(--text-3)'; badge.style.animation = 'none'; }
                } else { badge.style.display = 'none'; }

                if (tasks.length === 0) {
                    if (!grid.querySelector('.empty-state')) {
                        grid.innerHTML = '<div class="empty-state"><i data-lucide="inbox"></i><p>No tasks registered yet.</p></div>';
                        lucide.createIcons();
                    }
                    // Clear stale hash cache
                    Object.keys(_taskHashCache).forEach(k => delete _taskHashCache[k]);
                    return;
                }

                // Incremental DOM update: only touch cards that changed
                const incomingIds = new Set(tasks.map(t => t.task_id));
                let needsIconRefresh = false;

                // Remove cards no longer in data
                grid.querySelectorAll('.tcard[data-task-id]').forEach(el => {
                    const tid = el.getAttribute('data-task-id');
                    if (!incomingIds.has(tid)) {
                        el.remove();
                        delete _taskHashCache[tid];
                    }
                });

                // Remove empty-state placeholder if present
                const emptyEl = grid.querySelector('.empty-state');
                if (emptyEl) emptyEl.remove();

                // Update or insert each task card
                tasks.forEach(t => {
                    const hash = _taskHash(t);
                    const existing = grid.querySelector('.tcard[data-task-id="' + t.task_id + '"]');
                    if (existing) {
                        if (_taskHashCache[t.task_id] === hash) return; // No change — skip
                        // Update in-place
                        existing.className = 'tcard ts-' + t.status;
                        existing.innerHTML = _buildTaskCard(t);
                        needsIconRefresh = true;
                    } else {
                        // New card
                        const div = document.createElement('div');
                        div.className = 'tcard ts-' + t.status;
                        div.setAttribute('data-task-id', t.task_id);
                        div.innerHTML = _buildTaskCard(t);
                        grid.appendChild(div);
                        needsIconRefresh = true;
                    }
                    _taskHashCache[t.task_id] = hash;
                });

                if (needsIconRefresh) lucide.createIcons();
            } catch (e) { console.error('Task fetch error:', e); }
        }

        async function cancelTask(id) {
            if (!confirm('Cancel task ' + id + '?')) return;
            await fetch('/api/tasks/' + id + '/cancel', { method: 'POST' });
            fetchTasks();
        }

        async function deleteTask(id) {
            if (!confirm('Delete task ' + id + '? This cannot be undone.')) return;
            await fetch('/api/tasks/' + id, { method: 'DELETE' });
            fetchTasks();
        }

        const activeFeedStates = new Set();

        async function fetchActivity() {
            try {
                const res = await fetch('/api/activity');
                const data = await res.json();
                const activities = data.activities || [];
                const feed = document.getElementById('activity-feed');
                const aBadge = document.getElementById('activity-count-badge');
                if (activities.length > 0) { aBadge.textContent = activities.length; aBadge.style.display = 'inline'; }
                else { aBadge.style.display = 'none'; }
                if (activities.length === 0) {
                    if (!feed.querySelector('.empty-state')) {
                        feed.innerHTML = '<div class="empty-state"><i data-lucide="inbox"></i><p>No activity recorded yet.</p></div>';
                        lucide.createIcons();
                    }
                    return;
                }
                
                const emptyEl = feed.querySelector('.empty-state');
                if (emptyEl) emptyEl.remove();

                let hasNewLog = false;
                const reversedData = [...activities].reverse();

                reversedData.forEach(a => {
                    const fp = (a.id || '') + '_' + (a.timestamp || '') + '_' + (a.target || '') + '_' + (a.operation || '');
                    if (!activeFeedStates.has(fp)) {
                        activeFeedStates.add(fp);
                        hasNewLog = true;

                        const card = document.createElement('div');
                        const statusCls = a.status === 'error' ? 'failed' : 'completed';
                        card.className = 'tcard ts-' + statusCls;
                        card.style.padding = '14px 18px';
                        card.style.opacity = '0';
                        card.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
                        card.style.transform = 'translateY(-10px)';

                        const srcIcon = a.source === 'bigquery' ? 'database' : 'file-text';
                        const srcLabel = a.source === 'bigquery' ? 'BigQuery' : 'Firestore';
                        const srcColor = a.source === 'bigquery' ? 'var(--primary)' : 'var(--success)';
                        const ts = a.timestamp ? new Date(a.timestamp).toLocaleString() : '';

                        let html = '<div class="tcard-head"><span class="tbadge ' + statusCls + '" style="background:' + srcColor + ';color:#fff;font-weight:600;">' + srcLabel + '</span>';
                        html += '<span class="tbadge ' + statusCls + '">' + (a.operation || 'unknown') + '</span></div>';
                        html += '<div class="tcard-name" style="font-size:13px;margin:6px 0;">' + (a.target || '') + '</div>';
                        if (a.detail) html += '<div class="tcard-desc" style="font-size:12px;color:var(--text-3);max-height:120px;overflow:hidden;">' + a.detail.substring(0, 200) + '</div>';
                        html += '<div class="tcard-meta"><span><i data-lucide="clock"></i>' + ts + '</span>';
                        if (a.rows_affected) html += '<span><i data-lucide="rows-3"></i>' + a.rows_affected + ' rows</span>';
                        html += '</div>';

                        card.innerHTML = html;

                        if (feed.firstChild) {
                            feed.insertBefore(card, feed.firstChild);
                        } else {
                            feed.appendChild(card);
                        }

                        setTimeout(() => {
                            card.style.opacity = '1';
                            card.style.transform = 'translateY(0)';
                        }, 20);
                    }
                });

                if (hasNewLog) {
                    lucide.createIcons();
                }
            } catch (e) { console.error('Activity fetch error:', e); }
        }

        async function openTaskDetail(id) {
            const modal = document.getElementById('task-modal');
            modal.classList.add('open');
            document.getElementById('modal-body').textContent = 'Loading...';
            try {
                const res = await fetch('/api/tasks/' + id);
                const t = await res.json();
                document.getElementById('modal-title').innerHTML = '<i data-lucide="file-text"></i> ' + (t.task_name || t.task_id);
                let metaHtml = \`<span class="tbadge \${t.status}">\${t.status}</span>\`;
                if (t.schedule_cron) metaHtml += \`<span><i data-lucide="clock"></i> \${t.schedule_cron}</span>\`;
                if (t.started_at) metaHtml += \`<span>Started: \${new Date(t.started_at).toLocaleString()}</span>\`;
                if (t.completed_at) metaHtml += \`<span>Completed: \${new Date(t.completed_at).toLocaleString()}</span>\`;
                document.getElementById('modal-meta').innerHTML = metaHtml;
                let body = '';
                if (t.task_description) body += '--- Description ---\\\\n' + t.task_description + '\\\\n\\\\n';
                if (t.task_prompt) body += '--- Prompt ---\\\\n' + t.task_prompt + '\\\\n\\\\n';
                if (t.result_summary) body += '--- Result ---\\\\n' + t.result_summary + '\\\\n\\\\n';
                if (t.log_tail) body += '--- Log ---\\\\n' + t.log_tail;
                document.getElementById('modal-body').textContent = body || 'No details available.';
                lucide.createIcons();
            } catch (e) { document.getElementById('modal-body').textContent = 'Error: ' + e.message; }
        }

        function openRecordDetail(docId) {
            const modal = document.getElementById('record-modal');
            modal.classList.add('open');
            document.getElementById('rec-modal-body').innerHTML = '<div style="color:var(--text-3)">Loading...</div>';
            document.getElementById('rec-modal-title').innerHTML = '<i data-lucide="database"></i> ' + docId;
            document.getElementById('rec-modal-meta').innerHTML = '';
            try {
                const card = document.querySelector('[data-id="' + docId + '"]');
                if (!card) return;
                const badge = card.querySelector('.badge');
                if (badge) {
                    document.getElementById('rec-modal-meta').innerHTML = '<span class="' + badge.className + '">' + badge.textContent + '</span>';
                }
                fetch('/api/data').then(r => r.json()).then(data => {
                    const doc = data.find(d => d.id === docId);
                    if (!doc) { document.getElementById('rec-modal-body').innerHTML = '<div style="color:var(--text-3)">Record not found.</div>'; return; }
                    let html = '';
                    for (const [key, val] of Object.entries(doc.data)) {
                        if (key === 'workflow_state' && val && typeof val === 'object') {
                            let step = val.current_step || 0;
                            let total = val.total_steps || 1;
                            let pct = Math.round(step / total * 100);
                            let actions = (val.auto_actions_taken || []);
                            html += '<div class="detail-field"><div class="detail-field-k">WORKFLOW</div>';
                            html += '<div class="detail-field-v">';
                            html += '<div class="wf-progress"><div class="wf-progress-bar" style="width:' + pct + '%"></div></div>';
                            html += '<div style="margin-bottom:8px">Step ' + step + ' of ' + total + '</div>';
                            if (val.pending_approval) html += '<span class="badge pending">Pending Approval</span>';
                            if (actions.length) {
                                html += '<div style="margin-top:8px; font-weight: 500;">Actions taken:</div>';
                                html += '<ul style="margin: 4px 0; padding-left: 16px; font-size: 13px; color: var(--text-2);">' + actions.map(a => '<li>' + a + '</li>').join('') + '</ul>';
                            }
                            html += '</div></div>';
                            continue;
                        } else if (key === 'activity_log' && Array.isArray(val)) {
                            html += '<div class="detail-field"><div class="detail-field-k">ACTIVITY</div>';
                            html += '<div class="detail-field-v">';
                            val.forEach(entry => {
                                let ts = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '';
                                html += '<div class="timeline-entry">';
                                html += '<span class="timeline-ts">' + ts + '</span>';
                                html += '<span>' + (entry.action || '') + '</span>';
                                if (entry.by) html += '<span class="timeline-by">' + entry.by + '</span>';
                                html += '</div>';
                            });
                            html += '</div></div>';
                            continue;
                        }
                        let displayVal = val;
                        if (val && typeof val === 'object') {
                            displayVal = JSON.stringify(val, null, 2);
                        }
                        displayVal = String(displayVal);
                        html += '<div class="detail-field"><div class="detail-field-k">' + key + '</div><div class="detail-field-v">' + displayVal.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div></div>';
                    }
                    document.getElementById('rec-modal-body').innerHTML = html || '<div style="color:var(--text-3)">No fields.</div>';
                    lucide.createIcons();
                });
            } catch (e) { document.getElementById('rec-modal-body').innerHTML = '<div style="color:var(--danger)">Error: ' + e.message + '</div>'; }
        }

        function closeModal() { document.getElementById('task-modal').classList.remove('open'); document.getElementById('record-modal').classList.remove('open'); }

        initCharts();
        setInterval(fetchData, 2000);
        setInterval(fetchTasks, 3000);
        setInterval(fetchActivity, 5000);
        fetchData();
        fetchTasks();
        fetchActivity();
    </script>
</body>
</html>

"""

@app.route('/')
def index():
    return HTML_TEMPLATE

@app.route('/api/data')
def get_data():
    docs = db.collection(COLLECTION).stream()
    data = []
    for doc in docs:
        doc_dict = doc.to_dict()
        if "updated_at" not in doc_dict or not doc_dict["updated_at"]:
            try:
                doc_dict["updated_at"] = doc.update_time.isoformat()
            except Exception:
                if hasattr(doc, 'create_time') and doc.create_time:
                    doc_dict["updated_at"] = doc.create_time.isoformat()
                else:
                    doc_dict["updated_at"] = ""
        data.append({"id": doc.id, "data": doc_dict})
    return jsonify(data)

@app.route('/api/create', methods=['POST'])
def create_data():
    req = request.json
    doc_id = req.get('id')
    doc_data = req.get('data', {})
    if doc_id:
        db.collection(COLLECTION).document(doc_id).set(doc_data)
    return jsonify({"success": True})

@app.route('/api/update', methods=['POST'])
def update_data():
    req = request.json
    doc_id = req.get('id')
    new_status = req.get('status')
    if doc_id and new_status:
        db.collection(COLLECTION).document(doc_id).update({"status": new_status})
    return jsonify({"success": True})

@app.route('/api/delete', methods=['POST'])
def delete_data():
    req = request.json
    doc_id = req.get('id')
    if doc_id:
        db.collection(COLLECTION).document(doc_id).delete()
    return jsonify({"success": True})

# --- Task Management API ---
DEMO_ID = os.environ.get("DEMO_ID", "")

@app.route('/api/tasks')
def list_tasks():
    if not DEMO_ID:
        return jsonify({"tasks": [], "error": "DEMO_ID not set"})
    defs_col = DEMO_ID + "_task_definitions"
    execs_col = DEMO_ID + "_task_executions"
    defs = {d.id: d.to_dict() for d in db.collection(defs_col).stream()}
    execs = {d.id: d.to_dict() for d in db.collection(execs_col).stream()}
    tasks = []
    for tid, defn in defs.items():
        ex = execs.get(tid, {})
        tasks.append({
            "task_id": tid,
            "task_name": defn.get("task_name", ""),
            "task_description": defn.get("task_description", ""),
            "task_type": defn.get("task_type", "immediate"),
            "schedule_cron": defn.get("schedule_cron", ""),
            "created_at": defn.get("created_at", ""),
            "status": ex.get("status") or ("scheduled" if defn.get("task_type") == "scheduled" else "unknown"),
            "progress_pct": ex.get("progress_pct", 0),
            "result_summary": ex.get("result_summary", "")[:300],
            "log_tail": ex.get("log_tail", "")[:200],
            "started_at": ex.get("started_at", ""),
            "completed_at": ex.get("completed_at", ""),
        })
    tasks.sort(key=lambda t: t.get("created_at", ""), reverse=True)
    return jsonify({"tasks": tasks})

@app.route('/api/tasks/<task_id>')
def get_task(task_id):
    if not DEMO_ID:
        return jsonify({"error": "DEMO_ID not set"}), 400
    defn = db.collection(DEMO_ID + "_task_definitions").document(task_id).get()
    ex = db.collection(DEMO_ID + "_task_executions").document(task_id).get()
    if not defn.exists:
        return jsonify({"error": "Task not found"}), 404
    d = defn.to_dict()
    e = ex.to_dict() if ex.exists else {}
    return jsonify({
        "task_id": task_id,
        "task_name": d.get("task_name", ""),
        "task_description": d.get("task_description", ""),
        "task_prompt": d.get("task_prompt", ""),
        "task_type": d.get("task_type", "immediate"),
        "schedule_cron": d.get("schedule_cron", ""),
        "created_at": d.get("created_at", ""),
        "status": e.get("status", "unknown"),
        "progress_pct": e.get("progress_pct", 0),
        "result_summary": e.get("result_summary", ""),
        "log_tail": e.get("log_tail", ""),
        "started_at": e.get("started_at", ""),
        "completed_at": e.get("completed_at", ""),
    })

@app.route('/api/tasks/<task_id>/cancel', methods=['POST'])
def cancel_task(task_id):
    if not DEMO_ID:
        return jsonify({"error": "DEMO_ID not set"}), 400
    ref = db.collection(DEMO_ID + "_task_executions").document(task_id)
    doc = ref.get()
    if not doc.exists:
        return jsonify({"error": "Task not found"}), 404
    s = doc.to_dict().get("status", "")
    if s in ("completed", "failed", "cancelled"):
        return jsonify({"error": "Task already in terminal state: " + s}), 400
    ref.update({"status": "cancelled"})
    return jsonify({"success": True, "task_id": task_id})

@app.route('/api/tasks/<task_id>', methods=['DELETE'])
def delete_task(task_id):
    if not DEMO_ID:
        return jsonify({"error": "DEMO_ID not set"}), 400
    # Check if this is a scheduled task — if so, delete Cloud Scheduler job too
    defn_ref = db.collection(DEMO_ID + "_task_definitions").document(task_id)
    defn_doc = defn_ref.get()
    if defn_doc.exists:
        defn_data = defn_doc.to_dict()
        if defn_data.get("task_type") == "scheduled":
            try:
                from google.cloud import scheduler_v1
                _sc = scheduler_v1.CloudSchedulerClient()
                _pid = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
                _reg = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")
                if _reg == "global":
                    _reg = "us-central1"
                _jn = "projects/" + _pid + "/locations/" + _reg + "/jobs/" + DEMO_ID + "-sched-" + task_id
                _sc.delete_job(name=_jn)
            except Exception:
                pass  # Job may not exist
    defn_ref.delete()
    db.collection(DEMO_ID + "_task_executions").document(task_id).delete()
    return jsonify({"success": True, "task_id": task_id})

@app.route('/api/activity')
def list_activity():
    if not DEMO_ID:
        return jsonify({"activities": [], "error": "DEMO_ID not set"})
    col_name = DEMO_ID + "_activity_log"
    try:
        docs = db.collection(col_name).order_by("timestamp", direction=firestore.Query.DESCENDING).limit(50).stream()
        activities = []
        for doc in docs:
            d = doc.to_dict()
            activities.append({
                "id": doc.id,
                "source": d.get("source", "unknown"),
                "operation": d.get("operation", ""),
                "target": d.get("target", ""),
                "detail": d.get("detail", ""),
                "rows_affected": d.get("rows_affected", 0),
                "timestamp": d.get("timestamp", ""),
                "status": d.get("status", "success"),
            })
        return jsonify({"activities": activities})
    except Exception as _e:
        return jsonify({"activities": [], "error": str(_e)})

def main(request):
    with app.request_context(request.environ):
        try:
            return app.full_dispatch_request()
        except Exception as e:
            return str(e), 500

__VIEWER_MAIN__\n`;

    firestoreCommands += `cat <<'__VIEWER_REQ__' > ${dirName}/viewer_app/requirements.txt
${PINNED_DEPS.viewerFunctionsFramework}
${PINNED_DEPS.viewerFlask}
${PINNED_DEPS.viewerFirestore}
__VIEWER_REQ__\n`;

    firestoreCommands += `echo "🌐 Checking/Deploying Real-time Data Viewer Web App..."\n`;
    firestoreCommands += `if gcloud functions describe ${dirName}-viewer --gen2 --region=us-central1 --project="$PROJECT_ID" >/dev/null 2>&1; then\n`;
    firestoreCommands += `  echo "    ✅ Cloud Run Function already exists."\n`;
    firestoreCommands += `else\n`;
    firestoreCommands += `  VIEWER_LOG=\$(mktemp /tmp/viewer-deploy-XXXXXX.log)\n`;
    firestoreCommands += `  gcloud functions deploy ${dirName}-viewer --gen2 --runtime=python311 --region=us-central1 --source=${dirName}/viewer_app --entry-point=main --trigger-http --allow-unauthenticated --set-env-vars=DEMO_ID=${dirName} --project="$PROJECT_ID" > "\$VIEWER_LOG" 2>&1 &\n`;
    firestoreCommands += `  VIEWER_PID=\$!\n`;
    firestoreCommands += `  printf "    ⏳ Deploying Data Viewer"\n`;
    firestoreCommands += `  while kill -0 \$VIEWER_PID 2>/dev/null; do\n`;
    firestoreCommands += `    printf "."\n`;
    firestoreCommands += `    sleep 5\n`;
    firestoreCommands += `  done\n`;
    firestoreCommands += `  echo ""\n`;
    firestoreCommands += `  wait \$VIEWER_PID\n`;
    firestoreCommands += `  VIEWER_EXIT=\$?\n`;
    firestoreCommands += `  if [ \$VIEWER_EXIT -eq 0 ]; then\n`;
    firestoreCommands += `    echo "    ✅ Cloud Run Function deployed."\n`;
    firestoreCommands += `  else\n`;
    firestoreCommands += `    echo "    ⚠️ WARNING: Failed to deploy Firestore Data Viewer. Build log:"\n`;
    firestoreCommands += `    cat "\$VIEWER_LOG"\n`;
    firestoreCommands += `    echo "    ℹ️  This is an optional component and does NOT affect the agent's functionality."\n`;
    firestoreCommands += `    echo "    ℹ️  The agent will work normally without the Data Viewer."\n`;
    firestoreCommands += `  fi\n`;
    firestoreCommands += `  rm -f "\$VIEWER_LOG"\n`;
    firestoreCommands += `fi\n`;
    // Capture viewer deployment result (needed for DATA_VIEWER_URL in .env)
    firestoreCommands += `if gcloud functions describe ${dirName}-viewer --gen2 --region=us-central1 --project="$PROJECT_ID" >/dev/null 2>&1; then\n`;
    firestoreCommands += `  VIEWER_DEPLOYED=true\n`;
    firestoreCommands += `  VIEWER_URL=$(gcloud functions describe ${dirName}-viewer --gen2 --region=us-central1 --format="value(serviceConfig.uri)" --project="$PROJECT_ID")\n`;
    firestoreCommands += `else\n`;
    firestoreCommands += `  VIEWER_DEPLOYED=false\n`;
    firestoreCommands += `fi\n\n`;
  }

  // Robustly escape instruction for an unquoted bash heredoc
  const rawInstruction = systemInstruction.replace(/[\\$`]/g, match => '\\' + match);

  let mcpBanner = "";
  let mcpReads = "";
  let mcpCredentialSetup = "";
  if (params.importedMcpList && params.importedMcpList.length > 0) {
    params.importedMcpList.forEach((mcp, mcpIdx) => {
      // ── Remote Managed MCP (e.g. Slack): OAuth flow instead of env var prompts ──
      if (mcp.type === 'remote') {
        mcpBanner += `echo "🌐 Managed MCP: ${mcp.name || 'Remote'} (${mcp.endpoint_url})"\n`;
        if (mcp.auth_type === 'oauth2_slack') {
          mcpReads += `
echo ""
echo "════════════════════════════════════════════════════════════"
echo "  🔐 Slack MCP Server — Automated OAuth Setup"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "  This will automatically create a Slack App and complete"
echo "  the OAuth authorization flow to obtain a User Token."
echo ""

SLACK_TOKEN_SECRET="${dirName}-slack-token"
SKIP_SLACK_OAUTH=false

# Check if token already stored in Secret Manager
EXISTING_SLACK_TOKEN=""
if gcloud secrets describe $SLACK_TOKEN_SECRET --project="$PROJECT_ID" >/dev/null 2>&1; then
  EXISTING_SLACK_TOKEN=$(gcloud secrets versions access latest --secret="$SLACK_TOKEN_SECRET" --project="$PROJECT_ID" 2>/dev/null || echo "")
fi
if [ -n "$EXISTING_SLACK_TOKEN" ]; then
  echo "  ✅ Found existing Slack token in Secret Manager."
  read -p "  ▶ Use existing token? (Y/n): " USE_EXISTING
  if [[ ! "$USE_EXISTING" =~ ^[Nn]$ ]]; then
    SKIP_SLACK_OAUTH=true
    echo "  ✅ Using existing token."
  fi
fi

if [ "$SKIP_SLACK_OAUTH" = "false" ]; then

  SLACK_USER_SCOPES="search:read,channels:read,channels:history,groups:read,groups:history,im:read,im:history,mpim:read,mpim:history,chat:write,reactions:read,users:read,users:read.email,team:read,files:read,canvases:read,canvases:write"
  SLACK_REDIRECT_URL="https://localhost"

  # ── Step 1: Create Slack App via Manifest URL ──
  SLACK_MANIFEST='{"display_information":{"name":"${(`GE-${dirName}`).substring(0, 35)}"},"features":{},"oauth_config":{"redirect_urls":["'"$SLACK_REDIRECT_URL"'"],"scopes":{"user":["search:read","channels:read","channels:history","groups:read","groups:history","im:read","im:history","mpim:read","mpim:history","chat:write","reactions:read","users:read","users:read.email","team:read","files:read","canvases:read","canvases:write"]}},"settings":{"org_deploy_enabled":false,"socket_mode_enabled":false,"token_rotation_enabled":false}}'
  ENCODED_MANIFEST=$(python3 -c "import urllib.parse; print(urllib.parse.quote('''$SLACK_MANIFEST'''))")
  CREATE_URL="https://api.slack.com/apps?new_app=1&manifest_json=$ENCODED_MANIFEST"

  echo "  📦 Step 1: Create Slack App"
  echo ""
  echo "  Open the following URL to create a pre-configured Slack App:"
  echo ""
  echo "  $CREATE_URL"
  echo ""

  # Try to open browser automatically
  xdg-open "$CREATE_URL" 2>/dev/null || open "$CREATE_URL" 2>/dev/null || true

  echo "  After creating the app:"
  echo "    1. Select your workspace and click 'Next' → 'Create'"
  echo "    2. On the 'Basic Information' page, scroll to 'App Credentials'"
  echo "    3. Copy the Client ID and Client Secret below"
  echo ""

  while true; do
    read -p "▶ Paste Client ID: " SLACK_CLIENT_ID
    if [ -n "$SLACK_CLIENT_ID" ]; then break; fi
    echo "  ⚠️  Client ID is required."
  done
  while true; do
    read -s -p "▶ Paste Client Secret: " SLACK_CLIENT_SECRET
    echo ""
    if [ -n "$SLACK_CLIENT_SECRET" ]; then break; fi
    echo "  ⚠️  Client Secret is required."
  done
  echo "  ✅ Slack App credentials received!"

  # ── Step 2: Enable MCP (cannot be set via manifest) ──
  echo ""
  echo "  📦 Step 2: Enable Model Context Protocol (MCP)"
  echo ""
  echo "  ⚠️  This step is REQUIRED — MCP cannot be set automatically."
  echo ""
  echo "  In the Slack App settings page (should already be open):"
  echo "    1. Click 'Agents & AI Apps' in the left sidebar under Features"
  echo "    2. Toggle ON 'Model Context Protocol'"
  echo "    3. Click 'Save Changes' if prompted"
  echo ""
  read -p "▶ Press Enter once MCP is enabled... "
  echo "  ✅ MCP enabled!"

  # ── Step 3: OAuth Authorization Flow ──
  AUTH_URL="https://slack.com/oauth/v2/authorize?client_id=$SLACK_CLIENT_ID&user_scope=$SLACK_USER_SCOPES&redirect_uri=$SLACK_REDIRECT_URL"

  echo ""
  echo "  📦 Step 3: Authorize the Slack App"
  echo ""
  echo "  1. Open this URL in your browser:"
  echo ""
  echo "     $AUTH_URL"
  echo ""
  echo "  2. Click 'Allow' to authorize the app."
  echo ""
  echo "  3. Your browser will redirect to a page that says"
  echo "     'This site can't be reached' — this is expected!"
  echo ""
  echo "  4. Copy the FULL URL from the browser's address bar."
  echo "     It looks like: https://localhost/?code=XXXX..."
  echo ""

  while true; do
    read -p "▶ Paste the URL from your browser's address bar: " PASTE_INPUT
    SLACK_AUTH_CODE=$(echo "$PASTE_INPUT" | sed -n 's/.*code=\\([^&]*\\).*/\\1/p')
    if [ -n "$SLACK_AUTH_CODE" ]; then
      echo "  ✅ Authorization code extracted!"
      break
    fi
    echo "  ⚠️  Could not find 'code=' in the URL. Please paste the full URL."
  done

  # ── Step 3: Exchange code for tokens ──
  echo "🔑 Exchanging authorization code for tokens..."
  TOKEN_RESPONSE=$(curl -s -X POST https://slack.com/api/oauth.v2.access \
    -d "client_id=$SLACK_CLIENT_ID" \
    -d "client_secret=$SLACK_CLIENT_SECRET" \
    -d "code=$SLACK_AUTH_CODE" \
    -d "redirect_uri=$SLACK_REDIRECT_URL")

  TOKEN_OK=$(echo "$TOKEN_RESPONSE" | jq -r '.ok')
  if [ "$TOKEN_OK" = "true" ]; then
    SLACK_ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.authed_user.access_token // empty')
    if [ -z "$SLACK_ACCESS_TOKEN" ]; then
      SLACK_ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.access_token // empty')
      echo "  ⚠️  User token not available, using bot token."
    fi
    echo "  ✅ Token obtained!"
  else
    echo "  ❌ Token exchange failed."
    exit 1
  fi

  # ── Step 4: Store in Secret Manager ──
  echo "💾 Saving Slack token to Secret Manager..."
  if gcloud secrets describe $SLACK_TOKEN_SECRET --project="$PROJECT_ID" >/dev/null 2>&1; then
    echo -n "$SLACK_ACCESS_TOKEN" | gcloud secrets versions add $SLACK_TOKEN_SECRET --data-file=- --project="$PROJECT_ID"
  else
    echo -n "$SLACK_ACCESS_TOKEN" | gcloud secrets create $SLACK_TOKEN_SECRET --data-file=- --replication-policy="automatic" --project="$PROJECT_ID"
  fi
fi

echo "  ✅ Slack MCP OAuth configured!"
`;
        } else {
          // Generic remote MCP: prompt for env vars normally
          mcp.required_env_vars.forEach(v => {
            if (v.is_required) {
              if (v.is_secret) {
                mcpReads += `while true; do\n  read -s -p "▶ Enter ${v.key} (${v.description}): " ${v.key}\n  echo ""\n  if [ -n "$${v.key}" ]; then break; fi\n  echo "  ⚠️  ${v.key} is required. Please enter a value."\ndone\n`;
              } else {
                mcpReads += `while true; do\n  read -p "▶ Enter ${v.key} (${v.description}): " ${v.key}\n  if [ -n "$${v.key}" ]; then break; fi\n  echo "  ⚠️  ${v.key} is required. Please enter a value."\ndone\n`;
              }
            }
          });
        }
        return; // skip sidecar-specific credential_file handling
      }

      // ── Sidecar MCP: existing env var + credential file flow ──
      const repoName = mcp.github_url.split('/').pop().replace(/\.git$/, "");
      mcpBanner += `echo "🔌 Imported MCP #${mcpIdx + 1}:  ${repoName}"\n`;
      mcp.required_env_vars.forEach(v => {
        if (v.is_required) {
          // Required: loop until non-empty value is provided
          if (v.is_secret) {
            mcpReads += `while true; do\n  read -s -p "▶ Enter ${v.key} (${v.description}): " ${v.key}\n  echo ""\n  if [ -n "$${v.key}" ]; then break; fi\n  echo "  ⚠️  ${v.key} is required. Please enter a value."\ndone\n`;
          } else {
            mcpReads += `while true; do\n  read -p "▶ Enter ${v.key} (${v.description}): " ${v.key}\n  if [ -n "$${v.key}" ]; then break; fi\n  echo "  ⚠️  ${v.key} is required. Please enter a value."\ndone\n`;
          }
        } else {
          // Optional: single prompt, blank is fine
          const reqLabel = ' [OPTIONAL - press Enter to skip]';
          if (v.is_secret) {
             mcpReads += `read -s -p "▶ Enter ${v.key} (${v.description})${reqLabel}: " ${v.key}\necho ""\n`;
          } else {
               mcpReads += `read -p "▶ Enter ${v.key} (${v.description})${reqLabel}: " ${v.key}\n`;
          }
        }
      });

      // Credential file wizard
      if (mcp.credential_file) {
        const cf = mcp.credential_file;
        const escapedDesc = cf.file_description.replace(/"/g, '\\"');
        const credSecretSuffix = params.importedMcpList.length > 1 ? `-${mcpIdx}` : '';
        mcpCredentialSetup += `
echo ""
echo "════════════════════════════════════════════════════════════"
echo "  📄 Credential File Required (MCP #${mcpIdx + 1}: ${repoName})"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "  ${escapedDesc}"
echo ""
echo "  After completing the steps above, copy the generated"
echo "  JSON file contents to your clipboard."
echo ""
read -p "  Press [Enter] when ready to paste the JSON content... " _WAIT_
echo ""
echo "  Paste the JSON below, then press Ctrl+D on a new line:"
echo "  ────────────────────────────────────────────────────────"
MCP_CRED_CONTENT_${mcpIdx}=$(cat)
echo ""
echo "  ────────────────────────────────────────────────────────"
echo "  ✅ Credential content captured."
echo ""

# Store credential in Secret Manager
MCP_CRED_SECRET_NAME="${dirName}-mcp-adc-json${credSecretSuffix}"
echo "  Storing credential in Secret Manager as $MCP_CRED_SECRET_NAME..."
if gcloud secrets describe $MCP_CRED_SECRET_NAME >/dev/null 2>&1; then
  echo -n "$MCP_CRED_CONTENT_${mcpIdx}" | gcloud secrets versions add $MCP_CRED_SECRET_NAME --data-file=-
else
  echo -n "$MCP_CRED_CONTENT_${mcpIdx}" | gcloud secrets create $MCP_CRED_SECRET_NAME --data-file=- --replication-policy="automatic"
fi
echo "  ✅ Credential stored in Secret Manager."
echo ""
`;
      }
    });
  }

  let apisToEnable = [
    "aiplatform.googleapis.com",
    "bigquery.googleapis.com",
    "apikeys.googleapis.com",
    "mapstools.googleapis.com",
    "discoveryengine.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "serviceusage.googleapis.com",
    "iam.googleapis.com",
    "cloudbilling.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "clouderrorreporting.googleapis.com",
    "telemetry.googleapis.com",
    "firestore.googleapis.com",
    "cloudfunctions.googleapis.com"
  ];
  if (enableWorkspaceMcp) {
    apisToEnable.push(
      "gmail.googleapis.com",
      "drive.googleapis.com",
      "calendar-json.googleapis.com",
      "chat.googleapis.com",
      "people.googleapis.com"
    );
  }
  if (enableWorkspaceMcp || (params.importedMcpList && params.importedMcpList.length > 0)) {
    apisToEnable.push("secretmanager.googleapis.com");
  }
  // Secret Manager for Slack MCP token (already enabled above if importedMcpList exists)
  let apisChunks = [];
  for (let i = 0; i < apisToEnable.length; i += 20) {
    apisChunks.push(apisToEnable.slice(i, i + 20));
  }
  
  let enableCommands = "";
  apisChunks.forEach(chunk => {
    enableCommands += `echo "📡 Enabling APIs (batch)..."\n`;
    enableCommands += `gcloud services enable \\\n  ${chunk.join(" \\\n  ")} \\\n  --project="$PROJECT_ID"\n`;
  });

  let mcpServicesToEnable = "";
  if (enableWorkspaceMcp) {
    mcpServicesToEnable = `
gcloud services enable gmailmcp.googleapis.com --project="$PROJECT_ID"
gcloud services enable drivemcp.googleapis.com --project="$PROJECT_ID"
gcloud services enable calendarmcp.googleapis.com --project="$PROJECT_ID"
gcloud services enable chatmcp.googleapis.com --project="$PROJECT_ID"
gcloud services enable people.googleapis.com --project="$PROJECT_ID"
`;
  }

  let wsmcpInstructions = "";
  if (enableWorkspaceMcp) {
    wsmcpInstructions = `
echo ""
echo "========================================================="
echo "🛠️  GOOGLE WORKSPACE MCP SETUP REQUIRED"
echo "========================================================="




TOKEN=\$(gcloud auth print-access-token)

CLIENT_ID_SECRET="ge-demo-oauth-client-id"
CLIENT_SECRET_SECRET="ge-demo-oauth-client-secret"

OAUTH_CLIENT_ID=""
OAUTH_CLIENT_SECRET=""

echo "🔍 Checking Secret Manager for stored OAuth credentials..."

if gcloud secrets describe \$CLIENT_ID_SECRET --project="\$PROJECT_ID" >/dev/null 2>&1; then
  OAUTH_CLIENT_ID=\$(gcloud secrets versions access latest --secret="\$CLIENT_ID_SECRET" --project="\$PROJECT_ID" 2>/dev/null || echo "")
fi

if gcloud secrets describe \$CLIENT_SECRET_SECRET --project="\$PROJECT_ID" >/dev/null 2>&1; then
  OAUTH_CLIENT_SECRET=\$(gcloud secrets versions access latest --secret="\$CLIENT_SECRET_SECRET" --project="\$PROJECT_ID" 2>/dev/null || echo "")
fi

if [ -z "\$OAUTH_CLIENT_ID" ] || [ -z "\$OAUTH_CLIENT_SECRET" ]; then
  echo "Stored credentials not found or incomplete."


echo "The following steps require manual interaction in the Google Cloud Console."
  echo "Please complete them before continuing."
  echo ""
  echo "1. Set up the OAuth consent screen:"
  echo "   URL: https://console.cloud.google.com/auth/branding?project=\$PROJECT_ID"
  echo "   Instructions: Set App name to 'Workspace MCP Servers', select Audience, add scopes."
  echo "   Copy and paste the following scopes all at once:"
  echo "https://www.googleapis.com/auth/gmail.readonly"
  echo "https://www.googleapis.com/auth/gmail.compose"
  echo "https://www.googleapis.com/auth/drive.readonly"
  echo "https://www.googleapis.com/auth/drive.file"
  echo "https://www.googleapis.com/auth/calendar.calendarlist.readonly"
  echo "https://www.googleapis.com/auth/calendar.events.freebusy"
  echo "https://www.googleapis.com/auth/calendar.events.readonly"
  echo "https://www.googleapis.com/auth/chat.spaces.readonly"
  echo "https://www.googleapis.com/auth/chat.memberships.readonly"
  echo "https://www.googleapis.com/auth/chat.messages.readonly"
  echo "https://www.googleapis.com/auth/chat.users.readstate.readonly"
  echo "https://www.googleapis.com/auth/directory.readonly"
  echo "https://www.googleapis.com/auth/userinfo.profile"
  echo "https://www.googleapis.com/auth/contacts.readonly"
  echo ""
  echo "2. Create an OAuth 2.0 Client ID (Web application):"
  echo "   URL: https://console.cloud.google.com/auth/clients/create?project=\$PROJECT_ID"
  echo "   Select 'Web application'."
  echo "   Add the following Authorized Redirect URIs:"
  echo "     - https://vertexaisearch.cloud.google.com/oauth-redirect"
  echo "     - https://vertexaisearch.cloud.google.com/static/oauth/oauth.html"
  echo "   Enter a name, and copy the Client ID and Client Secret."
  echo ""
  echo "3. Configure the Chat app (if you want to use Chat MCP):"
  echo "   URL: https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat?project=\$PROJECT_ID"
  echo "   Follow these steps in the console:"
  echo "     - Click 'Manage' -> 'Configuration'."
  echo "     - Clear 'Build this Chat app as a Google Workspace add-on'."
  echo "     - App name: 'Chat MCP'"
  echo "     - Avatar URL: https://developers.google.com/chat/images/quickstart-app-avatar.png"
  echo "     - Description: 'Chat MCP server'"
  echo "     - Turn off 'Enable interactive features'."
  echo "     - Select 'Make this Chat app available to specific people and groups in your domain' and enter your email."
  echo "     - Select 'Log errors to Logging'."
  echo "     - Click 'Save'."
  echo ""
  read -p "Press [Enter] after you have completed these steps and copied your Client ID/Secret..."
  echo ""
  read -p "Enter your OAuth Client ID: " OAUTH_CLIENT_ID
  read -s -p "Enter your OAuth Client Secret: " OAUTH_CLIENT_SECRET
  echo ""
  
  echo "💾 Saving credentials to Secret Manager for future reuse..."
  gcloud secrets create \$CLIENT_ID_SECRET --project="\$PROJECT_ID" --replication-policy="automatic" 2>/dev/null || true
  gcloud secrets create \$CLIENT_SECRET_SECRET --project="\$PROJECT_ID" --replication-policy="automatic" 2>/dev/null || true
  
  echo -n "\$OAUTH_CLIENT_ID" | gcloud secrets versions add \$CLIENT_ID_SECRET --data-file=- --project="\$PROJECT_ID"
  echo -n "\$OAUTH_CLIENT_SECRET" | gcloud secrets versions add \$CLIENT_SECRET_SECRET --data-file=- --project="\$PROJECT_ID"
fi

# Create authorization resource in Gemini Enterprise
AUTH_ID="${dirName}-auth"
echo "🔐 Creating authorization resource in Gemini Enterprise..."
curl -X POST \
  -H "Authorization: Bearer \$TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Goog-User-Project: \$PROJECT_ID" \
  "https://discoveryengine.googleapis.com/v1alpha/projects/\$PROJECT_ID/locations/global/authorizations?authorizationId=\$AUTH_ID" \
  -d '{ "name": "projects/'"\$PROJECT_ID"'/locations/global/authorizations/'"\$AUTH_ID"'", "serverSideOauth2": { "clientId": "'"\$OAUTH_CLIENT_ID"'", "clientSecret": "'"\$OAUTH_CLIENT_SECRET"'", "authorizationUri": "https://accounts.google.com/o/oauth2/v2/auth?access_type=offline&prompt=consent&response_type=code&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgmail.readonly%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgmail.compose%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.readonly%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.file%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar.calendarlist.readonly%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar.events.freebusy%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar.events.readonly%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fchat.spaces.readonly%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fchat.memberships.readonly%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fchat.messages.readonly%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fchat.users.readstate.readonly%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdirectory.readonly%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fuserinfo.profile%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcontacts.readonly&client_id='"\$OAUTH_CLIENT_ID"'&redirect_uri=https%3A%2F%2Fvertexaisearch.cloud.google.com%2Foauth-redirect", "tokenUri": "https://oauth2.googleapis.com/token" } }'

`;
  }

  let fullScript = `#!/bin/bash
# ===========================================
# GE Demo Generator - Setup Script (${CONFIG.APP_VERSION})
# Generated: ${new Date().toISOString()}
# Demo: ${dirName}
# ===========================================

set -e

# --- Usage / Help ---
show_usage() {
  echo ""
  echo "Usage: bash $0 [OPTIONS]"
  echo ""
  echo "Options:"
  echo "  --model-analysis-agent, -m <MODEL>  Set the deep analysis agent model"
  echo "                                      (default: gemini-3.5-flash)"
  echo "  --model-root-agent <MODEL>          Set the root orchestration agent model"
  echo "                                      (default: gemini-3.5-flash)"
  echo "  --cleanup, -c                       Delete all provisioned demo resources"
  echo "  --help, -h                          Show this help message and exit"
  echo ""
  echo "Examples:"
  echo "  bash $0                                  # Deploy with default models"
  echo "  bash $0 --model-analysis-agent gemini-3.1-pro-preview       # Use a different analysis model"
  echo "  bash $0 --model-root-agent gemini-3.1-flash-lite            # Use a different root model"
  echo "  bash $0 --cleanup                         # Remove all demo resources"
  echo ""
}


# --- Argument Parsing ---
AGENT_MODEL="gemini-3.5-flash"
AGENT_MODEL_LITE="gemini-3.5-flash"
ROOT_MODEL_CLI_OVERRIDE=false
CLEANUP_MODE=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      show_usage
      exit 0
      ;;
    --model-analysis-agent|-m)
      if [ -n "$2" ]; then
        AGENT_MODEL="$2"
        shift 2
      else
        echo "❌ Error: --model-analysis-agent requires a model name (e.g., --model-analysis-agent gemini-flash-latest)."
        exit 1
      fi
      ;;
    --model-root-agent)
      if [ -n "$2" ]; then
        AGENT_MODEL_LITE="$2"
        ROOT_MODEL_CLI_OVERRIDE=true
        shift 2
      else
        echo "❌ Error: --model-root-agent requires a model name (e.g., --model-root-agent gemini-flash-latest)."
        exit 1
      fi
      ;;
    --cleanup|-c)
      CLEANUP_MODE=true
      shift
      ;;
    *)
      echo "⚠️  Unknown option: $1 (ignored)"
      shift
      ;;
  esac
done

# Disable gcloud prompts for full automation
gcloud config set core/disable_prompts True

# --- Check for required tools ---
echo "⚙️  Checking for required tools..."
for tool in jq curl gcloud make uv git python3; do
  if ! command -v \$tool >/dev/null 2>&1; then
    echo "❌ Error: \$tool is not installed. Please install it and try again."
    exit 1
  fi
done

# --- Network resiliency for package installation ---
echo "⚙️  Configuring robust network timeouts for package resolution..."
export UV_HTTP_TIMEOUT=600
export UV_RETRIES=10

# --- Detect Project ID early ---
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT_ID" ]; then
  echo "❌ Error: No default project found in your environment."
  echo "Please run 'gcloud config set project [PROJECT_ID]' first."
  exit 1
fi

# --- Authentication & Permissions Check ---
echo "🔐 Checking authentication..."
if ! gcloud auth application-default print-access-token >/dev/null 2>&1 || ! gcloud auth print-access-token >/dev/null 2>&1; then
  echo "❌ Error: Google Cloud credentials have expired or are missing."
  echo "💡 Please run the following commands to re-authenticate:"
  echo "    gcloud auth login"
  echo "    gcloud auth application-default login"
  echo "Then re-run this setup script."
  exit 1
fi

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)" 2>/dev/null || echo "")
if [ -z "$PROJECT_NUMBER" ]; then
  echo "❌ Error: Could not retrieve project details. The project ID might be invalid or you lack permissions."
  exit 1
fi

# --- Disk Space Check (Skip if in cleanup mode) ---
if [ "$CLEANUP_MODE" != "true" ]; then
  echo "💾 Checking disk space..."
  FREE_SPACE=$(df -k . | awk 'NR==2 {print $4}')
  if [ "$FREE_SPACE" -lt 1048576 ]; then
    echo "⚠️  CRITICAL: Low disk space detected ($((FREE_SPACE/1024)) MB left)."
    echo "    Deployment will likely fail (needs ~1GB free)."
    echo "    Use the cleanup command to free up space:"
    echo "    cd ~ && bash \$0 --cleanup"
    echo ""
    read -p "Attempt to continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then exit 1; fi
  fi
fi

# --- Cleanup Mode Handler ---
  if [ "$CLEANUP_MODE" = "true" ]; then
    echo ""
    echo "========================================================="
    echo "🧹 DEMO CLEANUP MODE"
    echo "========================================================="
    echo ""
    echo "This will delete the following resources:"
    echo "  • BigQuery Dataset: ${datasetId}"
    echo "  • Maps API Key: MCP-Demo-Key-${suffix}"
    echo "  • Cloud Run Main Service: ${dirName} (if deployed)"
    echo "  • Cloud Run Live Viewer Function: ${dirName}-viewer"
    echo "  • Firestore Collection: ${fsCollection}"
    echo "  • Gemini Enterprise registration (App): ${dirName}"
    echo "  • Custom MCP Secrets in Secret Manager (if exist)"
    echo "  • Agent Engine (Sandbox): ${dirName}-sandbox"
    echo "  • Pub/Sub Topics: ${dirName}-sched-tasks, ${dirName}-task-results"
    echo "  • Pub/Sub Subscriptions: ${dirName}-sched-tasks-push, ${dirName}-task-results-push"
    echo "  • Cloud Scheduler Jobs: ${dirName}-sched-* (if any)"
    echo "  • Firestore Task Collections: ${dirName}_task_definitions, ${dirName}_task_executions"
    echo "  • Local Directory: ~/${dirName}"
    echo ""
    _HAS_SLACK=\$(gcloud secrets describe "${dirName}-slack-token" --project="\$PROJECT_ID" 2>/dev/null && echo "yes" || echo "no")
    if [ "\$_HAS_SLACK" = "yes" ]; then
      echo "⚠️  Manual cleanup required after deletion:"
      echo "  • Slack App: GE-${dirName}"
      echo "    → Delete manually at https://api.slack.com/apps"
      echo ""
    fi

    read -p "Are you sure you want to proceed? (y/n) " -n 1 -r
    echo
    if [[ ! \$REPLY =~ ^[Yy]$ ]]; then
      echo "Cleanup cancelled."
      exit 0
    fi
    
    TOKEN=$(gcloud auth print-access-token 2>/dev/null)
    
    echo ""
    echo "🗑️  Deleting BigQuery Dataset: ${datasetId}..."
    bq rm -r -f -d \$PROJECT_ID:${datasetId} 2>/dev/null && echo "   ✅ Dataset deleted." || echo "   ⚠️  Dataset not found or already deleted."
    
    echo ""
    echo "🔑 Deleting Maps API Key: MCP-Demo-Key-${suffix}..."
    KEY_NAME=$(gcloud alpha services api-keys list --filter="displayName:MCP-Demo-Key-${suffix}" --format="value(name)" 2>/dev/null || echo "")
    if [ ! -z "\$KEY_NAME" ]; then
      DELETED_ALL=true
      for KN in \$KEY_NAME; do
        gcloud alpha services api-keys delete "\$KN" --quiet 2>/dev/null || DELETED_ALL=false
      done
      if \$DELETED_ALL; then
        echo "   ✅ API Key deleted."
      else
        echo "   ⚠️  Failed to delete one or more API Keys."
      fi
    else
      echo "   ⚠️  API Key not found or already deleted."
    fi

    echo ""
    echo "🚀 Deleting Cloud Run services and functions..."
    
    # Find region for main service
    MAIN_REGION=\$(gcloud run services list --filter="metadata.name:${dirName}" --format="value(region)" 2>/dev/null | head -n 1)
    if [ ! -z "\$MAIN_REGION" ]; then
      gcloud run services delete ${dirName} --region="\$MAIN_REGION" --quiet 2>/dev/null && echo "   ✅ Cloud Run main service deleted." || echo "   ⚠️  Failed to delete Main service."
    else
      echo "   ⚠️  Main service not found or already deleted."
    fi

    # Find region for viewer function (which is a Cloud Run service under the hood in Gen2)
    VIEWER_REGION=\$(gcloud run services list --filter="metadata.name:${dirName}-viewer" --format="value(region)" 2>/dev/null | head -n 1)
    if [ ! -z "\$VIEWER_REGION" ]; then
      gcloud functions delete ${dirName}-viewer --gen2 --region="\$VIEWER_REGION" --quiet 2>/dev/null && echo "   ✅ Live Viewer Cloud Run Function deleted." || echo "   ⚠️  Failed to delete Live Viewer Function."
    else
      echo "   ⚠️  Live Viewer Function not found or already deleted."
    fi
    





    echo ""
    echo "🔥 Deleting Firestore Collection: ${fsCollection}..."
    if command -v uv >/dev/null 2>&1; then
      GOOGLE_API_USE_CLIENT_CERTIFICATE=false uv run --with google-cloud-firestore python3 -c "from google.cloud import firestore; db=firestore.Client(); [d.reference.delete() for d in db.collection('${fsCollection}').stream()]" 2>/dev/null && echo "   ✅ Firestore documents in collection deleted." || echo "   ⚠️  Could not clear Firestore collection automatically."
    fi

    echo ""
    echo "🌍 Deleting Gemini Enterprise registration (App/Agent)..."
    UNREGISTERED=false
    # Search all common locations
    for LOC in "global" "us" "eu"; do
      if [ "\$LOC" = "global" ]; then
        ENDPOINT="discoveryengine.googleapis.com"
      else
        ENDPOINT="\${LOC}-discoveryengine.googleapis.com"
      fi
      
      ENGINES_JSON=$(curl -s -H "Authorization: Bearer \$TOKEN" -H "X-Goog-User-Project: \$PROJECT_ID" \
        "https://\$ENDPOINT/v1alpha/projects/\$PROJECT_ID/locations/\$LOC/collections/default_collection/engines")
      
      # 2. If no engine match, scan for individual agents within EXISTING engines in this location
      for E_NAME in $(echo "\$ENGINES_JSON" | jq -r '.engines[]? | .name'); do
        ASSISTANTS=$(curl -s -H "Authorization: Bearer \$TOKEN" -H "X-Goog-User-Project: \$PROJECT_ID" "https://\$ENDPOINT/v1alpha/\${E_NAME}/assistants")
        for A_NAME in $(echo "\$ASSISTANTS" | jq -r '.assistants[]? | .name'); do
          AGENTS_JSON=$(curl -s -H "Authorization: Bearer \$TOKEN" -H "X-Goog-User-Project: \$PROJECT_ID" "https://\$ENDPOINT/v1alpha/\${A_NAME}/agents?pageSize=100")
          TARGET_AGENT_NAME=$(echo "\$AGENTS_JSON" | jq -r --arg dir "${dirName}" '.agents[]? | select(.a2aAgentDefinition.jsonAgentCard != null) | select((.a2aAgentDefinition.jsonAgentCard | fromjson | .name) == $dir) | .name' 2>/dev/null | head -n 1)
          
          if [ ! -z "\$TARGET_AGENT_NAME" ] && [ "\$TARGET_AGENT_NAME" != "null" ]; then
            echo "   🗑 Unregistering Gemini Enterprise Agent: \${TARGET_AGENT_NAME} (Location: \$LOC)..."
            curl -s --fail -X DELETE -H "Authorization: Bearer \$TOKEN" -H "X-Goog-User-Project: \$PROJECT_ID" \
              "https://\$ENDPOINT/v1alpha/\$TARGET_AGENT_NAME" > /dev/null && echo "   ✅ Gemini Enterprise Agent unlisted." || echo "   ⚠️  Failed to unlist Gemini Enterprise Agent."
            UNREGISTERED=true
            break 3
          fi
        done
      done
    done
    
    if [ "\$UNREGISTERED" = "false" ]; then
      echo "   ⚠️  Gemini Enterprise Agent not found or already unlisted."
    fi
    


    # Authorization resource only exists when Google Workspace MCP was configured
    AUTH_PATH="projects/\$PROJECT_ID/locations/global/authorizations/${dirName}-auth"
    _AUTH_EXISTS=\$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer \$TOKEN" -H "X-Goog-User-Project: \$PROJECT_ID" "https://discoveryengine.googleapis.com/v1alpha/\$AUTH_PATH")
    if [ "\$_AUTH_EXISTS" = "200" ]; then
      echo ""
      echo "🔐 Deleting Gemini Enterprise Authorization Resource: ${dirName}-auth..."
      if curl -s --fail -X DELETE \
        -H "Authorization: Bearer \$TOKEN" \
        -H "X-Goog-User-Project: \$PROJECT_ID" \
        "https://discoveryengine.googleapis.com/v1alpha/\$AUTH_PATH" > /dev/null; then
        echo "   ✅ Authorization resource deleted."
      else
        echo "   ⚠️  Failed to delete Authorization resource."
      fi
    fi

    echo ""
    echo "🗑️  Deleting any custom MCP secrets from Secret Manager..."
    # Search for all secrets containing the suffix (includes Slack token secret)
    MCP_SECRETS=\$(gcloud secrets list --format="value(name)" 2>/dev/null | grep "${suffix}" || true)
    if [ ! -z "\$MCP_SECRETS" ]; then
      for SEC in \$MCP_SECRETS; do
         gcloud secrets delete "\$SEC" --quiet 2>/dev/null && echo "      ✅ Secret deleted: \$SEC" || echo "      ⚠️  Failed to delete Secret: \$SEC"
      done
    else
      echo "   ✅ No custom MCP secrets found."
    fi


    echo ""
    echo "🧪 Deleting Agent Engine (Sandbox)..."
    _AE_NAME=""
    if [ -f ~/${dirName}/.env ]; then
      _AE_NAME=\$(grep '^AGENT_ENGINE_NAME=' ~/${dirName}/.env | sed 's/^AGENT_ENGINE_NAME=//' | sed 's/^"//;s/"$//')
    fi
    if [ -n "\$_AE_NAME" ]; then
      echo "   🔍 Found Agent Engine: \$_AE_NAME"
      GOOGLE_API_USE_CLIENT_CERTIFICATE=false uv run --no-project --with "google-cloud-aiplatform[agent_engines]>=1.112.0" python3 -c "
import vertexai, sys
try:
    client = vertexai.Client(project='\$PROJECT_ID', location='us-central1')
    op = client.agent_engines.delete(name='\$_AE_NAME', force=True)
    print('   ✅ Agent Engine and sandboxes deleted.')
except Exception as e:
    print('   ⚠️  Failed to delete Agent Engine: ' + str(e), file=sys.stderr)
    sys.exit(1)
" || echo "   ⚠️  Agent Engine deletion failed. You may need to delete it manually from the console."
    else
      echo "   ⚠️  Agent Engine name not found in .env, skipping."
    fi

    echo ""
    echo "📨 Deleting Pub/Sub topics and subscriptions..."
    for SUB in "${dirName}-sched-tasks-push" "${dirName}-task-results-push"; do
      gcloud pubsub subscriptions delete "$SUB" --project="$PROJECT_ID" --quiet 2>/dev/null \\
        && echo "   ✅ Subscription deleted: $SUB" \\
        || echo "   ⚠️  Subscription not found: $SUB"
    done
    for TOP in "${dirName}-sched-tasks" "${dirName}-task-results"; do
      gcloud pubsub topics delete "$TOP" --project="$PROJECT_ID" --quiet 2>/dev/null \\
        && echo "   ✅ Topic deleted: $TOP" \\
        || echo "   ⚠️  Topic not found: $TOP"
    done

    echo ""
    echo "⏰ Deleting Cloud Scheduler jobs..."
    SCHED_JOBS=$(gcloud scheduler jobs list --location=us-central1 --project="$PROJECT_ID" \\
      --format="value(name)" 2>/dev/null | grep "${dirName}-sched-" || true)
    if [ -n "$SCHED_JOBS" ]; then
      for JOB in $SCHED_JOBS; do
        gcloud scheduler jobs delete "$JOB" --location=us-central1 \\
          --project="$PROJECT_ID" --quiet 2>/dev/null \\
          && echo "   ✅ Scheduler job deleted: $JOB" \\
          || echo "   ⚠️  Failed to delete: $JOB"
      done
    else
      echo "   ✅ No Cloud Scheduler jobs found."
    fi

    echo ""
    echo "📁 Deleting Firestore task collections..."
    GOOGLE_API_USE_CLIENT_CERTIFICATE=false uv run --no-project --with google-cloud-firestore python3 -c "
from google.cloud import firestore
db = firestore.Client()
for coll_name in ['${dirName}_task_definitions', '${dirName}_task_executions', '${dirName}_task_push_configs']:
    docs = list(db.collection(coll_name).stream())
    for doc in docs:
        doc.reference.delete()
    print('   ✅ Deleted ' + str(len(docs)) + ' docs from ' + coll_name)
" 2>/dev/null || echo "   ⚠️  Could not clear Firestore task collections."

    echo ""
    echo "📂 Deleting local directories and caches..."
    cd ~
    rm -rf ~/${dirName}
    rm -rf ~/.cache/uv
    echo "   ✅ Local workspace directory, viewer code, and caches deleted."

    # Only show Slack cleanup if the Slack MCP server was configured
    if gcloud secrets describe "${dirName}-slack-token" --project="\$PROJECT_ID" >/dev/null 2>&1; then
      echo ""
      echo "📱 Slack App (manual cleanup required):"
      echo "   ⚠️  Please delete the Slack App manually at: https://api.slack.com/apps"
      echo "   Look for an app named 'GE-${dirName}' and delete it."
    fi

    echo ""
    echo "========================================================="
    echo "✅ CLEANUP COMPLETE"
    echo "========================================================="
    exit 0
  fi

# --- 1. Project Detection & Confirmation Loop ---
while true; do
  echo "========================================================="
  echo "⚡ GE Demo Generator - Setup Script"
  echo "   Version:      ${CONFIG.APP_VERSION}"
  echo "   Generated At: ${new Date().toISOString()}"
  echo "   Options:      --help | --cleanup | --model-analysis-agent | --model-root-agent"
  echo "========================================================="
  echo "🚀 Target Project: \$PROJECT_ID"
  echo '🤖 Agent Name:    ${safeShortName} (${dirName})'
  echo '📝 Description:   ${safeSummary}'
  echo "📂 Demo Asset Directory: ~/${dirName}"
  echo "🧠 Agent Models:   root_agent: \$AGENT_MODEL_LITE / deep_analysis_agent: \$AGENT_MODEL"
  echo "🧪 Code Sandbox:   ✅ Enabled (Agent Runtime)"
  ${ enableWorkspaceMcp ? `echo "🔌 Google Workspace MCP: Enabled"\n` : ''}${mcpBanner}echo "========================================================="
  
  echo "Choose an option:"
  echo "  [Y] Yes, proceed with this project (Default)"
  echo "  [N] No, cancel deployment"
  echo "  [M] Modify the root agent model (Change to gemini-3.1-flash-lite)"
  echo ""
  read -p "▶ Enter choice [Y/n/m]: " REPLY
  echo
  
  # Clean up input
  REPLY=\$(echo "\$REPLY" | tr -d '\\r\\n\\t ')
  
  # Default to 'y' if user pressed enter
  if [ -z "\$REPLY" ]; then
    REPLY="y"
  fi
  
  if [[ "\$REPLY" =~ ^[Yy]$ ]]; then
    break
  elif [[ "\$REPLY" =~ ^[Nn]$ ]]; then
    echo "❌ Deployment cancelled by user."
    exit 1
  elif [[ "\$REPLY" =~ ^[Mm]$ ]]; then
    # --- Model Selection Flow ---
    echo ""
    echo "🧠 Configure Chat & Orchestration Model (root_agent):"
    echo "   - root_agent (Chat/UI): Uses 'gemini-3.5-flash' by default."
    echo "   - deep_analysis_agent (Reasoning): Uses 'gemini-3.5-flash'."
    echo ""
    echo "   You can choose 'gemini-3.1-flash-lite' for the root_agent."
    echo "   While it yields simpler and more concise responses, it provides"
    echo "   much faster and snappier interactions for routine chat."
    echo "   For complex tasks requiring deep analysis, the root_agent can"
    echo "   still delegate the work to the deep_analysis_agent (3.5-flash)."
    echo ""
    read -p "▶ Use lightweight gemini-3.1-flash-lite for root_agent? (Y/n): " CHOOSE_LITE
    CHOOSE_LITE=\$(echo "\$CHOOSE_LITE" | tr -d '\\r\\n\\t ')
    
    # Default to 'y' since they specifically selected 'M' to configure
    if [ -z "\$CHOOSE_LITE" ]; then
      CHOOSE_LITE="y"
    fi
    
    if [[ "\$CHOOSE_LITE" =~ ^[Yy]$ ]]; then
      AGENT_MODEL_LITE="gemini-3.1-flash-lite"
      echo "   ✅ Configured root_agent to use: gemini-3.1-flash-lite"
    else
      AGENT_MODEL_LITE="gemini-3.5-flash"
      echo "   ℹ️  Keeping default root_agent: gemini-3.5-flash"
    fi
    echo ""
    # Directly proceed to deployment steps after configuration is complete
    break
  else
    echo "⚠️  Invalid choice. Please enter Y, N, or M."
    echo ""
  fi
done



# --- 1.2 Gemini Enterprise Pre-Deployment Check ---
echo ""
echo "========================================================="
echo "🤖 GEMINI ENTERPRISE PRE-DEPLOYMENT CHECK"
echo "========================================================="
echo "This setup script will automatically deploy to Cloud Run and"
echo "register it to Gemini Enterprise."
echo ""
echo "⚠️  IMPORTANT: You MUST have a Gemini Enterprise instance"
echo "   already created in this project."
echo ""
echo "If you haven't, please create one here first:"
echo "https://console.cloud.google.com/gemini-enterprise/products?project=$PROJECT_ID"
echo ""
read -p "Have you confirmed the instance exists? (y/n) " -n 1 -r
echo
if [[ ! \$REPLY =~ ^[Yy]$ ]]; then
    echo "Exiting. Please create the instance and run the script again."
    exit 1
fi

${wsmcpInstructions}

# --- 1.3 IAM Permission Check ---
echo "🔐 Checking for IAM permissions..."
if ! gcloud projects get-iam-policy "$PROJECT_ID" >/dev/null 2>&1; then
  echo "⚠️  WARNING: Cannot read IAM policy. You might not have permission to grant roles."
  echo "    If the deployment fails later, please check your permissions."
  echo "    (Needs Project IAM Admin or Owner role)"
fi

${mcpReads}
${mcpCredentialSetup}

# --- 2. IAM & API Checks ---
${enableCommands}

echo "📡 Enabling Cloud Run specific APIs..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  --project="$PROJECT_ID"

# Fast IAM role granting: pre-checks existing roles, skips already-granted, no verification delay
grant_roles_fast() {
  local project=$1
  local member_prefix=$2
  local member=$3
  shift 3
  local roles_to_grant=("$@")

  echo "  📋 Fetching existing IAM bindings for $member..."
  local existing_roles
  existing_roles=$(gcloud projects get-iam-policy "$project" \
    --flatten="bindings[].members" \
    --format="value(bindings.role)" \
    --filter="bindings.members:$member_prefix:$member" 2>/dev/null || echo "")

  local skipped=0
  local granted=0

  for role in "\${roles_to_grant[@]}"; do
    if echo "$existing_roles" | grep -q "$role"; then
      echo "    ⏭ Already granted: $role"
      skipped=$((skipped + 1))
    else
      if gcloud projects add-iam-policy-binding "$project" \
        --member="$member_prefix:$member" \
        --role="$role" --condition=None >/dev/null 2>&1; then
        echo "    ✅ Granted: $role"
        granted=$((granted + 1))
      else
        echo "    ⚠️  WARNING: Failed to grant $role. Grant manually:"
        echo "       gcloud projects add-iam-policy-binding \"$project\" --member=\"$member_prefix:$member\" --role=\"$role\" --condition=None"
      fi
    fi
  done

  echo "  📊 IAM Summary: $granted newly granted, $skipped already existed"
}

# Ensure the default compute service account has required permissions
echo "🔐 Configuring IAM permissions for Cloud Run Service Account..."
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
COMPUTE_SA="\${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
grant_roles_fast "$PROJECT_ID" "serviceAccount" "\$COMPUTE_SA" \
  "roles/mcp.toolUser" "roles/bigquery.jobUser" "roles/bigquery.dataEditor" \
  "roles/serviceusage.serviceUsageConsumer" "roles/aiplatform.user" "roles/logging.logWriter" \
  "roles/datastore.user" "roles/storage.objectViewer" "roles/artifactregistry.admin" "roles/run.invoker" \
  "roles/pubsub.publisher" "roles/cloudscheduler.admin"

# Background task infra: Cloud Scheduler SA needs pubsub.publisher
echo "🔐 Configuring IAM for Cloud Scheduler Service Agent..."
SCHED_SA="service-\${PROJECT_NUMBER}@gcp-sa-cloudscheduler.iam.gserviceaccount.com"
grant_roles_fast "$PROJECT_ID" "serviceAccount" "\$SCHED_SA" "roles/pubsub.publisher"

echo "🔐 Configuring IAM permissions for Discovery Engine Service Agent..."
DISCOVERY_ENGINE_SA="service-\${PROJECT_NUMBER}@gcp-sa-discoveryengine.iam.gserviceaccount.com"
grant_roles_fast "$PROJECT_ID" "serviceAccount" "\$DISCOVERY_ENGINE_SA" "roles/run.invoker"

# Enable MCP services (parallel for speed)
echo "🔧 Enabling MCP services (parallel)..."
gcloud beta services mcp enable bigquery.googleapis.com --project="$PROJECT_ID" 2>/dev/null &
gcloud beta services mcp enable mapstools.googleapis.com --project="$PROJECT_ID" 2>/dev/null &
gcloud beta services mcp enable firestore.googleapis.com --project="$PROJECT_ID" 2>/dev/null &
gcloud services enable aiplatform.googleapis.com --project="$PROJECT_ID" 2>/dev/null &
gcloud services enable cloudscheduler.googleapis.com --project="$PROJECT_ID" 2>/dev/null &
gcloud services enable pubsub.googleapis.com --project="$PROJECT_ID" 2>/dev/null &
wait
echo "  ✅ MCP services enabled"
${mcpServicesToEnable}

# --- 2.2 User-level IAM Configuration ---
  echo "🔐 Configuring user permissions..."
  USER_ACCOUNT=$(gcloud config get-value account 2>/dev/null)
  grant_roles_fast "$PROJECT_ID" "user" "\$USER_ACCOUNT" \
    "roles/mcp.toolUser" "roles/serviceusage.serviceUsageConsumer" "roles/storage.admin" \
    "roles/datastore.user" "roles/iam.serviceAccountUser" "roles/bigquery.jobUser" "roles/bigquery.dataEditor"

# Check for BQ permissions (with timeout to prevent hanging on new projects)
echo "🛡 Checking BigQuery permissions..."
CAN_MK_BQ=$(timeout 30 bq ls --project_id="$PROJECT_ID" 2>&1 || echo "timeout_or_error")
if [[ $CAN_MK_BQ == *"Access Denied"* ]]; then
  echo "❌ Error: Your account doesn't have BigQuery access in this project."
  exit 1
fi
echo "✅ BigQuery Permissions OK"


# --- 4. Project Setup (Flat Structure) ---
if [ -d "${dirName}" ]; then
  echo "📂 Removing existing directory ${dirName} for a clean setup..."
  rm -rf "${dirName}"
fi

# --- 3. Data Provisioning ---
${bqCommands}
${firestoreCommands}

echo "📦 Setting up project directory..."
mkdir -p ${dirName}/adk_agent/app
cd ${dirName}

# Generate requirements.txt
cat <<'__REQ_EOF__' > requirements.txt
${PINNED_DEPS.adk}
${PINNED_DEPS.mcp}
${PINNED_DEPS.genai}
${PINNED_DEPS.dotenv}
${PINNED_DEPS.aiplatform}
${PINNED_DEPS.dbDtypes}
${PINNED_DEPS.storage}
${PINNED_DEPS.a2ui}
${PINNED_DEPS.a2a}
${PINNED_DEPS.scheduler}
${PINNED_DEPS.pubsub}
${PINNED_DEPS.firestore}
${PINNED_DEPS.logging}
${PINNED_DEPS.otel}
__REQ_EOF__

# Generate pyproject.toml required for adk project type
cat <<'__PYPROJ_EOF__' > pyproject.toml
[project]
name = "mcp-agent"
version = "0.1.0"
dependencies = ["${PINNED_DEPS.adk}", "${PINNED_DEPS.mcp}", "${PINNED_DEPS.genai}", "${PINNED_DEPS.storage}"]
requires-python = ">=3.10,<3.13"
[tool.adk]
project_type = "agent"
__PYPROJ_EOF__

# Generate .dockerignore to prevent copying local .venv
cat <<'__DOCKERIGNORE_EOF__' > .dockerignore
.venv
__DOCKERIGNORE_EOF__

# Generate .python-version for Buildpacks
cat <<'__PYTHON_VERSION_EOF__' > .python-version
3.11
__PYTHON_VERSION_EOF__

# Generate Dockerfile using uv for performance (PoC v9 style)
cat <<'__DOCKER_EOF__' > Dockerfile
FROM ${PINNED_DEPS.pythonImage}
COPY --from=${PINNED_DEPS.uvImage} /uv /uvx /bin/
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt pyproject.toml ./
RUN uv pip install --system -r requirements.txt
__DOCKER_EOF__

${ (params.importedMcpList && params.importedMcpList.filter(m => m.type !== 'remote').length > 0) ? `
# ── Custom MCP servers: language-aware Dockerfile layers ──
cat <<'__DOCKER_MCP_EOF__' >> Dockerfile
# Install Node.js (required for supergateway stdio→HTTP bridge and Node.js MCP servers)
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*
# Pre-install supergateway globally (stdio→StreamableHTTP bridge, works with any language)
RUN npm install -g ${PINNED_DEPS.supergateway}
__DOCKER_MCP_EOF__

${(() => {
  let dockerSteps = '';
  // --- Docker build layers for custom MCP servers ---
  params.importedMcpList.filter(m => m.type !== 'remote').forEach((mcp, idx) => {
    const mcpDir = `/app/custom_mcp_${idx}`;
    const lang = (mcp.language || '').toLowerCase();
    const isNodejs = (lang === 'nodejs');
    dockerSteps += `
cat <<'__DOCKER_MCP_CLONE_${idx}_EOF__' >> Dockerfile
RUN git clone ${mcp.github_url} ${mcpDir}
__DOCKER_MCP_CLONE_${idx}_EOF__
`;
    let installStep;
    const pipCmd = `(if [ -f pyproject.toml ] || [ -f setup.py ]; then uv pip install --system . 2>/dev/null || true; elif [ -f requirements.txt ]; then uv pip install --system -r requirements.txt; fi)`;
    const npmCmd = `(npm install && npm run build 2>/dev/null || true)`;
    const ign = mcp.npm_ignore_scripts ? 'ENV NPM_CONFIG_IGNORE_SCRIPTS=true\n' : '';
    if (isNodejs) {
      // Primary: Node.js install. Fallback: Python install if npm fails.
      installStep = `${ign}RUN cd ${mcpDir} && ${npmCmd} && ${pipCmd}`;
    } else {
      // Primary: Python install. Fallback: Node.js install if pip fails.
      installStep = `RUN cd ${mcpDir} && ${pipCmd} || ${npmCmd}`;
    }
    dockerSteps += `
cat <<'__DOCKER_MCP_INSTALL_${idx}_EOF__' >> Dockerfile
${installStep}
__DOCKER_MCP_INSTALL_${idx}_EOF__
`;
  });

  // --- Parallel sidecar startup strategy ---
  // Phase 1: Launch ALL sidecars as background processes (no waiting)
  // Phase 2: Single unified health-check loop polls all ports concurrently
  // Result: Total startup = max(individual) ~15-30s instead of sum ~270s
  const localMcps = params.importedMcpList.filter(m => m.type !== 'remote');
  let startScript = '#!/bin/bash\n\n';
  startScript += `TOTAL_SIDECARS=${localMcps.length}\n`;
  startScript += 'echo "🔌 Starting $TOTAL_SIDECARS MCP sidecars in parallel..."\n\n';

  // Phase 1: Generate launcher scripts for FastMCP servers, then launch all sidecars
  // CRITICAL: We generate _run.py files instead of python -c "..." because
  // bash double-quotes do NOT interpret \n as newlines, causing SyntaxError.
  startScript += '# Phase 1: Launch all sidecars in parallel\n';
  localMcps.forEach((mcp, idx) => {
    const ep = mcp.entrypoint || '';
    const isFastMcp = ep.includes(':') && !ep.includes(' ');
    const mcpDir = `/app/custom_mcp_${idx}`;
    const port = 9090 + idx;
    let stdioCmd;
    if (isFastMcp) {
      const [mp, on] = ep.split(':');
      // Generate _run.py locally in build context, then COPY into Docker image.
      // Previous printf approach broke: multi-layer escaping turned newlines into literal chars.
      dockerSteps += `
cat <<'__RUN_PY_${idx}_EOF__' > _run_${idx}.py
import asyncio
import sys
import logging
logging.basicConfig(level=logging.INFO, stream=sys.stderr)
from ${mp} import ${on}
try:
    ${on}.run(transport="stdio")
except TypeError:
    from mcp.server.stdio import stdio_server
    async def _r():
        async with stdio_server() as (r, w):
            await ${on}.run(r, w, ${on}.create_initialization_options())
    asyncio.run(_r())
__RUN_PY_${idx}_EOF__

cat <<'__DOCKER_COPY_RUN_PY_${idx}_EOF__' >> Dockerfile
COPY _run_${idx}.py ${mcpDir}/_run.py
__DOCKER_COPY_RUN_PY_${idx}_EOF__
`;
      stdioCmd = `python _run.py`;
    } else { stdioCmd = ep; }
    startScript += `cd ${mcpDir} && supergateway --stdio "${stdioCmd}" --outputTransport streamableHttp --port ${port} --sessionStateless &\n`;
    startScript += `PID_${idx}=$!\n`;
  });

  // Phase 2: Build port list and do a single batch health-check
  const portList = localMcps.map((_, idx) => 9090 + idx).join(' ');
  startScript += '\n# Phase 2: Unified health-check (max 30s for ALL sidecars)\n';
  startScript += `PORTS="${portList}"\n`;
  startScript += 'READY=""\n';
  startScript += 'for _attempt in $(seq 1 30); do\n';
  startScript += '  ALL_READY=true\n';
  startScript += '  for P in $PORTS; do\n';
  startScript += '    case " $READY " in *" $P "*) continue ;; esac\n';
  startScript += '    if curl -s -m 2 -o /dev/null -w \"\" http://127.0.0.1:$P/mcp 2>/dev/null; then\n';
  startScript += '      echo "  ✅ Port $P ready (${_attempt}s)"\n';
  startScript += '      READY="$READY $P"\n';
  startScript += '    else\n';
  startScript += '      ALL_READY=false\n';
  startScript += '    fi\n';
  startScript += '  done\n';
  startScript += '  if $ALL_READY; then break; fi\n';
  startScript += '  sleep 1\n';
  startScript += 'done\n';
  startScript += '\n# Report results\n';
  startScript += 'READY_COUNT=$(echo $READY | wc -w | tr -d " ")\n';
  startScript += 'echo "✅ $READY_COUNT/$TOTAL_SIDECARS MCP sidecars ready"\n';
  startScript += 'for P in $PORTS; do\n';
  startScript += '  case " $READY " in *" $P "*) ;; *) echo "  ⚠️ Port $P did not become ready in time" ;; esac\n';
  startScript += 'done\n';
  startScript += '\necho "🚀 Starting ADK agent..."\n';
  startScript += 'cd /app\n';
  startScript += 'exec uvicorn adk_agent.app.fast_api_app:app --host 0.0.0.0 --port 8080\n';

  return dockerSteps + `
cat <<'__START_SH_EOF__' > start_mcp.sh
${startScript}__START_SH_EOF__
chmod +x start_mcp.sh
cat <<'__DOCKER_START_EOF__' >> Dockerfile
COPY start_mcp.sh /app/start_mcp.sh
__DOCKER_START_EOF__`;
})()}
` : '' }

cat <<'__DOCKER_TAIL_EOF__' >> Dockerfile
COPY . .
# Dependency smoke test: fail build if critical interface missing
RUN python -c "from a2ui.a2a.parts import create_a2ui_part; import inspect; assert 'version' in inspect.signature(create_a2ui_part).parameters, 'FAIL: a2ui version param missing'; print('Dep smoke test OK')"
# Record installed versions for debugging
RUN uv pip freeze | grep -iE "^(google-adk|a2ui|mcp|google-genai|a2a-sdk)" | tee /app/.dep-versions
ENV PORT 8080
ENV GOOGLE_GENAI_USE_VERTEXAI=1
ENV PYTHONUNBUFFERED=1
ENV ADK_ENABLE_MCP_GRACEFUL_ERROR_HANDLING=1
ENV OTEL_SDK_DISABLED=true
__DOCKER_TAIL_EOF__
${ (params.importedMcpList && params.importedMcpList.filter(m => m.type !== 'remote').length > 0) ? `echo 'CMD ["/bin/bash", "/app/start_mcp.sh"]' >> Dockerfile` : `echo 'CMD ["uvicorn", "adk_agent.app.fast_api_app:app", "--host", "0.0.0.0", "--port", "8080"]' >> Dockerfile` }

# --- 5. Environment Setup ---
if ! command -v uv >/dev/null 2>&1; then
    echo "    installing uv via astral.sh..."
    curl -LsSf https://astral.sh/uv/${PINNED_DEPS.uvVersion}/install.sh | sh >/dev/null 2>&1 || true
    # Add to current PATH for the rest of the script
    export PATH="\$HOME/.cargo/bin:\$PATH"
fi
# Set UV to copy mode to prevent cross-filesystem hardlink failures (os error 28)
export UV_LINK_MODE=copy

echo "📦 Dependencies will be installed in Docker build..."

# --- 6. Generate Maps API Key ---
echo "🔑 Generating Maps API key..."
API_KEY_JSON=$(gcloud alpha services api-keys create --display-name="MCP-Demo-Key-${suffix}" \
    --api-target=service=mapstools.googleapis.com \
    --format=json 2>/dev/null || echo "")

if [ ! -z "$API_KEY_JSON" ]; then
    API_KEY=$(echo "$API_KEY_JSON" | grep -oP '"keyString": "\K[^"]+' 2>/dev/null || echo "$API_KEY_JSON" | grep '"keyString":' | cut -d '"' -f 4)
else
    API_KEY=$(gcloud alpha services api-keys list --filter="displayName:MCP-Demo-Key-${suffix}" --format="value(keyString)" 2>/dev/null || echo "")
fi

if [ -z "$API_KEY" ]; then
    echo "⚠️ Failed to auto-generate API key. Set it manually in .env."
    API_KEY="REPLACE_ME"
fi

# --- Sandbox Provisioning for Code Execution ---
echo "🧪 Provisioning Agent Sandbox for Code Execution..."
export SANDBOX_OUT="/tmp/sandbox_result_$$.txt"
# CRITICAL: Run from a clean temp directory, NOT the project directory.
# agent_engines.create(config=...) packages the CWD for container build.
# If Dockerfile/MCP files exist in CWD, the SDK tries to build them → hang.
SANDBOX_TMPDIR=$(mktemp -d)
pushd "$SANDBOX_TMPDIR" > /dev/null
GOOGLE_API_USE_CLIENT_CERTIFICATE=false uv run --no-project --with "google-cloud-aiplatform[agent_engines]>=1.112.0" python3 << '__SANDBOX_PROVISION_EOF__'
import sys, os, warnings, time, vertexai
from vertexai import types

# Suppress harmless "STATE_RUNNING is not a valid State" warning from google-genai SDK
warnings.filterwarnings('ignore', message='STATE_RUNNING is not a valid', category=UserWarning, module='google.genai')

_MAX_RETRIES = 5

print('  📦 Step 1/3: Initializing Vertex AI client (us-central1)...')
sys.stdout.flush()
client = vertexai.Client(project=os.environ.get('PROJECT_ID', ''), location='us-central1')

print('  📦 Step 2/3: Creating Agent Engine...')
sys.stdout.flush()
agent_engine = None
for _attempt in range(_MAX_RETRIES):
    try:
        agent_engine = client.agent_engines.create(
            config={'display_name': '${dirName}-sandbox'},
        )
        break
    except Exception as _e:
        if _attempt < _MAX_RETRIES - 1:
            _wait = 15 * (_attempt + 1)
            print('  ⚠️  Attempt ' + str(_attempt + 1) + '/' + str(_MAX_RETRIES) + ' failed: ' + str(_e)[:200])
            print('  ⏳ Retrying in ' + str(_wait) + 's...')
            sys.stdout.flush()
            time.sleep(_wait)
        else:
            raise
agent_engine_name = agent_engine.api_resource.name
print('  ✅ Agent Engine: ' + agent_engine_name)
sys.stdout.flush()

print('  📦 Step 3/3: Creating Sandbox (this may take a few minutes)...')
sys.stdout.flush()
sandbox_operation = None
for _attempt in range(_MAX_RETRIES):
    try:
        sandbox_operation = client.agent_engines.sandboxes.create(
            name=agent_engine_name,
            config=types.CreateAgentEngineSandboxConfig(display_name='code-sandbox'),
            spec={'code_execution_environment': {}},
        )
        break
    except Exception as _e:
        if _attempt < _MAX_RETRIES - 1:
            _wait = 15 * (_attempt + 1)
            print('  ⚠️  Attempt ' + str(_attempt + 1) + '/' + str(_MAX_RETRIES) + ' failed: ' + str(_e)[:200])
            print('  ⏳ Retrying in ' + str(_wait) + 's...')
            sys.stdout.flush()
            time.sleep(_wait)
        else:
            raise
sandbox_resource_name = sandbox_operation.response.name
print('  ✅ Sandbox: ' + sandbox_resource_name)

with open(os.environ.get('SANDBOX_OUT', '/tmp/sandbox_result.txt'), 'w') as f:
    f.write(agent_engine_name + '|' + sandbox_resource_name)
__SANDBOX_PROVISION_EOF__
popd > /dev/null
rm -rf "$SANDBOX_TMPDIR"

if [ -f "$SANDBOX_OUT" ]; then
    SANDBOX_RESULT=$(cat "$SANDBOX_OUT")
    rm -f "$SANDBOX_OUT"
    AGENT_ENGINE_NAME=$(echo "$SANDBOX_RESULT" | cut -d'|' -f1)
    SANDBOX_RESOURCE_NAME=$(echo "$SANDBOX_RESULT" | cut -d'|' -f2)
else
    echo "  ❌ Sandbox provisioning failed. See error output above."
    echo "     Ensure aiplatform.googleapis.com is enabled and roles/aiplatform.user is granted."
    exit 1
fi

# Create .env in the root
cat <<__ENV_EOF__ > .env
GOOGLE_GENAI_USE_VERTEXAI=1
GOOGLE_CLOUD_PROJECT="$PROJECT_ID"
GOOGLE_API_USE_CLIENT_CERTIFICATE=false
GOOGLE_CLOUD_LOCATION="global"
DEMO_DATASET="${datasetId}"
MAPS_API_KEY="$API_KEY"
PYTHONUNBUFFERED=1
GRPC_ENABLE_FORK_SUPPORT=1
ADK_ENABLE_MCP_GRACEFUL_ERROR_HANDLING=1
AGENT_MODEL="$AGENT_MODEL"
AGENT_MODEL_LITE="$AGENT_MODEL_LITE"
__ENV_EOF__

# Conditionally add Data Viewer URL if deployed
if [ "$VIEWER_DEPLOYED" = "true" ]; then
  echo "DATA_VIEWER_URL=\"$VIEWER_URL\"" >> .env
fi

# Add Sandbox resource name for code execution (always present at this point)
echo "SANDBOX_RESOURCE_NAME=\"$SANDBOX_RESOURCE_NAME\"" >> .env
echo "AGENT_ENGINE_NAME=\"$AGENT_ENGINE_NAME\"" >> .env

# Symlink .env to packages for visibility
ln -sf ../.env adk_agent/.env
ln -sf ../../.env adk_agent/app/.env

# Ignore large directories to prevent Reason Engine payload bloating
cat <<'__GITIGNORE_EOF__' > adk_agent/.gitignore
.venv/
.venv
__pycache__/
*.pyc
*.pyo
.pytest_cache/
__GITIGNORE_EOF__

# Create __init__.py files for proper Python package structure
touch adk_agent/__init__.py
cat <<'__INIT_EOF__' > adk_agent/app/__init__.py
from . import agent
__INIT_EOF__


# --- 7. Customizing Agent ---
echo "🔧 Configuring agent..."



cat <<'__TOOLS_EOF__' > adk_agent/app/tools.py
import os
from typing import Union, Any
import asyncio
from google.adk.agents.readonly_context import ReadonlyContext
import dotenv
import google.auth
import google.auth.transport.requests
from google.adk.tools.mcp_tool.mcp_toolset import McpToolset
from google.adk.tools.mcp_tool.mcp_tool import MCPTool
from google.adk.tools.mcp_tool.mcp_session_manager import StreamableHTTPConnectionParams
import httpx
from google.adk.auth import AuthCredential, AuthCredentialTypes, OAuth2Auth
import anyio
import time
import uuid
from google.adk.tools import ToolContext
from google.genai import client as genai_client, types as genai_types
import json
from fastapi.openapi.models import OAuth2, OAuthFlows, OAuthFlowAuthorizationCode

_orig_default = json.JSONEncoder.default
def _patched_default(self, obj):
    if isinstance(obj, genai_types.Part):
        return obj.model_dump(exclude_none=True)
    return _orig_default(self, obj)
json.JSONEncoder.default = _patched_default





def get_project_id():
    """Robustly retrieves the project ID from env, .env, or credentials."""
    # 1. Direct env
    pid = os.getenv("GOOGLE_CLOUD_PROJECT")
    if pid: return pid
    
    # 2. Try loading .env from root or package
    dotenv.load_dotenv()
    pid = os.getenv("GOOGLE_CLOUD_PROJECT")
    if pid: return pid
    
    # 3. Fallback to auth default
    try:
        _, pid = google.auth.default()
        if pid: return pid
    except: pass
    return "UNKNOWN"

# =============================================================================
# 🛡️ Stability Patches for Reasoning Engine (Mandatory)
# =============================================================================

_orig_client_init = httpx.AsyncClient.__init__
def _patched_client_init(self, *args, **kwargs):
    kwargs['http2'] = False 
    # Use long timeouts for stable MCP sessions (300s)
    kwargs['timeout'] = httpx.Timeout(300.0, connect=60.0)
    return _orig_client_init(self, *args, **kwargs)

_token_cache = {"token": None, "expiry": 0, "credentials": None}
_token_lock = asyncio.Lock()

async def _get_fresh_mcp_token():
    """Retrieves a fresh access token with async-safe caching."""
    global _token_cache
    async with _token_lock:
        now = time.time()
        if _token_cache["token"] and now < _token_cache["expiry"]:
            return _token_cache["token"]
        try:
            if _token_cache["credentials"] is None:
                # google.auth.default() makes blocking network calls. We run it in a thread
                # to prevent it from deadlocking the main asyncio event loop if the metadata server hangs.
                def _get_creds():
                    scopes = ["https://www.googleapis.com/auth/cloud-platform", "https://www.googleapis.com/auth/bigquery"]
                    creds, _ = google.auth.default(scopes=scopes)
                    return creds
                _token_cache["credentials"] = await anyio.to_thread.run_sync(_get_creds)
            
            credentials = _token_cache["credentials"]
            
            # CRITICAL: google.auth's Request does not accept a timeout in its constructor,
            # and defaults to infinite timeout. This hangs the worker thread and deadlocks the
            # entire asyncio TaskGroup on Cloud Run cold starts. We must inject a custom session.
            import requests
            class TimeoutSession(requests.Session):
                def request(self, *args, **kwargs):
                    kwargs.setdefault('timeout', 10.0)
                    return super().request(*args, **kwargs)
                    
            req = google.auth.transport.requests.Request(session=TimeoutSession())
            await anyio.to_thread.run_sync(credentials.refresh, req)
            _token_cache = {"token": credentials.token, "expiry": now + 1800, "credentials": credentials}
            return credentials.token
        except Exception as e: 
            import logging
            logging.warning(f"Failed to refresh MCP token: {e}")
            return ""

_orig_send = httpx.AsyncClient.send
async def _patched_send(self, request, *args, **kwargs):
    _url = str(request.url)
    
    # BigQuery & Firestore MCP Auth Injection
    if "bigquery.googleapis.com/mcp" in _url or "firestore.googleapis.com/mcp" in _url:
        token = await _get_fresh_mcp_token()
        if token: request.headers['Authorization'] = f"Bearer {token}"
            


    # Execute actual request
    response = await _orig_send(self, request, *args, **kwargs)
    
    # Error Transmutation (JSON-RPC Protocol Compliance)
    # MCP uses JSON-RPC, which requires all responses (including errors) to be HTTP 200.
    # Google's MCP endpoints sometimes return HTTP 400/403 for JSON-RPC errors (e.g., 
    # invalid SQL, permission denied, DML failures). If we don't convert these to HTTP 200,
    # the HTTP transport layer in ADK rejects them before the LLM can see the error details.
    # By converting to 200, the JSON-RPC error payload reaches the LLM, which can then
    # report the actual error (e.g., "Column not found") and attempt recovery.
    if response.status_code in [400, 403] and ("bigquery.googleapis.com/mcp" in _url or "firestore.googleapis.com/mcp" in _url):
        try:
            body = b""
            async for chunk in response.aiter_bytes():
                body += chunk
                if len(body) > 0 or not chunk:
                    break
            # Only transmute if the body is a valid JSON-RPC response
            if b'"jsonrpc":' in body: response.status_code = 200
            response._content = body
        except Exception: 
            pass
    return response

# Apply Stability Patches
try:
    # 1. HTTP/2 Disable for stability
    httpx.AsyncClient.__init__ = _patched_client_init
    httpx.AsyncClient.send = _patched_send
    
    # 2. MCP Cancel-Scope Fix (backport for ADK <=1.31.1)
    # ADK's SessionContext._run() wraps client context entry in asyncio.wait_for(),
    # which runs in a nested task. AnyIO's CancelScope must be entered/exited in the
    # same task, so this causes "Attempted to exit cancel scope in a different task".
    # The fix (from ADK main branch) removes the wait_for wrapper.
    # When ADK ships the _MCP_GRACEFUL_ERROR_HANDLING flag, the env var takes over.
    from google.adk.tools.mcp_tool.session_context import SessionContext as _SC
    _orig_sc_run = _SC._run
    async def _patched_sc_run(self):
        try:
            async with __import__('contextlib').AsyncExitStack() as exit_stack:
                # NO asyncio.wait_for here — this is the fix
                transports = await exit_stack.enter_async_context(self._client)
                from datetime import timedelta
                if self._is_stdio:
                    session = await exit_stack.enter_async_context(
                        __import__('mcp').ClientSession(
                            *transports[:2],
                            read_timeout_seconds=timedelta(seconds=self._timeout)
                            if self._timeout is not None else None,
                            sampling_callback=getattr(self, '_sampling_callback', None),
                            sampling_capabilities=getattr(self, '_sampling_capabilities', None),
                        )
                    )
                else:
                    _srt = getattr(self, '_sse_read_timeout', None) or self._timeout
                    session = await exit_stack.enter_async_context(
                        __import__('mcp').ClientSession(
                            *transports[:2],
                            read_timeout_seconds=timedelta(seconds=_srt)
                            if _srt is not None else None,
                            sampling_callback=getattr(self, '_sampling_callback', None),
                            sampling_capabilities=getattr(self, '_sampling_capabilities', None),
                        )
                    )
                _init_timeout = max(self._timeout or 60, 60)  # At least 60s for custom MCP sidecars
                await asyncio.wait_for(session.initialize(), timeout=_init_timeout)
                import logging as _log
                _log.getLogger('google_adk.session_context').debug('Session initialized (patched)')
                self._session = session
                self._ready_event.set()
                await self._close_event.wait()
        except BaseException as e:
            import logging as _log
            _logger = _log.getLogger('google_adk.session_context')
            _logger.warning(f'Error on session runner task: {e}')
            # Log sub-exceptions for TaskGroup/ExceptionGroup errors
            if hasattr(e, 'exceptions'):
                for i, sub_ex in enumerate(e.exceptions):
                    _logger.warning(f'  Sub-exception [{i}]: {type(sub_ex).__name__}: {sub_ex}')
                    if hasattr(sub_ex, 'exceptions'):
                        for j, sub_sub in enumerate(sub_ex.exceptions):
                            _logger.warning(f'    Sub-sub-exception [{i}.{j}]: {type(sub_sub).__name__}: {sub_sub}')
            import traceback
            _logger.debug(f'Full traceback: {traceback.format_exc()}')
            raise
        finally:
            self._ready_event.set()
            self._close_event.set()
    _SC._run = _patched_sc_run
except Exception as e:
    import logging; logging.warning(f"Stability patches not applied: {e}")

# =============================================================================
# 🔧 MCP Toolset Configuration
# =============================================================================
def get_maps_mcp_url():
    """Returns the base Maps MCP URL."""
    return "https://mapstools.googleapis.com/mcp"

def get_firestore_mcp_url():
    """Returns the base Firestore MCP URL."""
    return "https://firestore.googleapis.com/mcp"

def get_bigquery_mcp_url():
    """Returns the project-scoped BigQuery MCP URL using a query parameter."""
    project_id = get_project_id()
    # Using ?project= query parameter as the header alone was insufficient for public datasets
    return f"https://bigquery.googleapis.com/mcp?project={project_id}"

def get_bigquery_mcp_toolset():
    """Creates a BigQuery MCP toolset. URL is project-scoped to ensure quota/perms."""
    project_id = get_project_id()
    url = get_bigquery_mcp_url()
    if project_id == "UNKNOWN":
        print("  [CRITICAL] GOOGLE_CLOUD_PROJECT is missing! MCP calls will likely fail.")
        
    return McpToolset(connection_params=StreamableHTTPConnectionParams(
        url=url, 
        headers={"x-goog-user-project": project_id},
        timeout=300
    ))

def get_firestore_mcp_toolset():
    """Creates a Firestore MCP toolset."""
    project_id = get_project_id()
    url = get_firestore_mcp_url()
    return McpToolset(connection_params=StreamableHTTPConnectionParams(
        url=url, 
        headers={"x-goog-user-project": project_id},
        timeout=300
    ))

def get_maps_mcp_toolset():
    """Creates a Google Maps MCP toolset."""
    dotenv.load_dotenv()
    maps_api_key = os.getenv('MAPS_API_KEY')
    project_id = get_project_id()
    url = get_maps_mcp_url()
    return McpToolset(connection_params=StreamableHTTPConnectionParams(
        url=url, 
        headers={
            "x-goog-api-key": maps_api_key
        },
        timeout=300
    ))

# Initialize Firestore client for background task management
# Stored on builtins so tools.py functions can access it without circular imports
# NOTE: This MUST be outside the enableWorkspaceMcp conditional block
# so background task tools work regardless of Workspace MCP configuration.
import builtins
if not hasattr(builtins, '_firestore_client'):
    try:
        from google.cloud import firestore as _firestore_mod
        builtins._firestore_client = _firestore_mod.Client()
        print("[tools.py] Firestore client initialized successfully for background tasks", flush=True)
    except Exception as _fs_init_err:
        builtins._firestore_client = None
        print("[tools.py] FAILED to initialize Firestore client: " + type(_fs_init_err).__name__ + ": " + str(_fs_init_err), flush=True)

${ enableWorkspaceMcp ? `
import re
import httpx
from pydantic import AnyUrl

# Thread-safe token holder for Workspace MCP authentication.
# Uses builtins to share state across module boundaries (tools.py ↔ fast_api_app.py).
# Updated by TokenExtractionMiddleware (primary) and _handle_request (fallback)
# with the OAuth token from each A2A request.
# The header_provider callback reads from this on each MCP HTTP call.
if not hasattr(builtins, '_workspace_oauth_token'):
    builtins._workspace_oauth_token = ""

# Try to import MCP OAuth components (available in mcp>=1.24.0)
try:
    from mcp.client.auth import OAuthClientProvider
    from mcp.shared.auth import OAuthClientMetadata, OAuthToken
    _MCP_OAUTH_AVAILABLE = True
except ImportError:
    _MCP_OAUTH_AVAILABLE = False
    import logging as _log
    _log.getLogger('workspace_mcp').warning("MCP OAuth imports not available - falling back to header-only auth")

class WorkspaceTokenStorage:
    """Bridges Gemini Enterprise OAuth tokens into MCP OAuth flow.
    
    When OAuthClientProvider receives a 401 from the MCP server, it uses this
    storage to provide the pre-existing access token. If the token is accepted
    (no 401), the MCP OAuth handshake is skipped entirely.
    """
    def __init__(self, access_token):
        if _MCP_OAUTH_AVAILABLE and access_token:
            self._token = OAuthToken(access_token=access_token, token_type="Bearer")
        else:
            self._token = None
        self._client_info = None
    
    async def get_tokens(self):
        return self._token
    
    async def set_tokens(self, tokens):
        self._token = tokens
    
    async def get_client_info(self):
        return self._client_info
    
    async def set_client_info(self, client_info):
        self._client_info = client_info

def _create_workspace_httpx_client_factory(mcp_server_url, scopes):
    """Returns an httpx_client_factory that injects OAuthClientProvider.
    
    On Cloud Run:
    - Creates OAuthClientProvider with the Google OAuth token from header_provider
    - OAuthClientProvider first tries to use the token as-is (Bearer header)
    - If MCP server returns 401, OAuthClientProvider handles the full OAuth handshake
    
    On local dev:
    - Falls back to default httpx client factory
    """
    import logging as _log
    _logger = _log.getLogger('workspace_mcp')
    
    def factory(headers=None, timeout=None, auth=None):
        from mcp.shared._httpx_utils import create_mcp_http_client
        
        # Only inject OAuthClientProvider on Cloud Run and when MCP OAuth is available
        if not os.environ.get("K_SERVICE") or not _MCP_OAUTH_AVAILABLE:
            return create_mcp_http_client(headers=headers, timeout=timeout, auth=auth)
        
        # Extract token from headers injected by header_provider
        token = None
        if headers and "Authorization" in headers:
            auth_header = headers.get("Authorization", "")
            if auth_header.startswith("Bearer "):
                token = auth_header[7:]
                _logger.warning(f"httpx_factory: Got token from headers (prefix={token[:30]}..., len={len(token)})")
        
        if not token:
            _logger.warning("httpx_factory: No token in headers, using default client")
            return create_mcp_http_client(headers=headers, timeout=timeout, auth=auth)
        
        try:
            # Create OAuthClientProvider with pre-existing token
            storage = WorkspaceTokenStorage(token)
            
            oauth_provider = OAuthClientProvider(
                server_url=mcp_server_url,
                client_metadata=OAuthClientMetadata(
                    client_name="Workspace MCP Agent",
                    redirect_uris=[AnyUrl("http://localhost:3000/callback")],
                    grant_types=["authorization_code", "refresh_token"],
                    response_types=["code"],
                    scope=" ".join(scopes),
                ),
                storage=storage,
                redirect_handler=None,   # headless: full flow not possible
                callback_handler=None,   # headless: full flow not possible
            )
            
            _logger.warning(f"httpx_factory: Created OAuthClientProvider for {mcp_server_url}")
            
            # Remove Authorization from headers since OAuthClientProvider will handle it
            clean_headers = {k: v for k, v in (headers or {}).items() if k != "Authorization"}
            
            return create_mcp_http_client(
                headers=clean_headers if clean_headers else None,
                timeout=timeout,
                auth=oauth_provider
            )
        except Exception as ex:
            _logger.warning(f"httpx_factory: OAuthClientProvider creation failed ({type(ex).__name__}: {ex}), falling back to default client with Bearer header")
            return create_mcp_http_client(headers=headers, timeout=timeout, auth=auth)
    
    return factory

def _workspace_header_provider(context) -> dict:
    """header_provider callback for McpToolset.
    
    Called by ADK on every MCP HTTP request to supply dynamic auth headers.
    Tries multiple strategies to find the OAuth token:
      1. context.state[auth_id] (ADK ReadonlyContext/CallbackContext)
      2. context.session.state[auth_id] (session-level state)
      3. builtins._workspace_oauth_token (cross-module fallback)
    """
    import logging as _log
    _logger = _log.getLogger('workspace_mcp')
    token = None
    
    auth_id = os.environ.get("GEMINI_AUTHORIZATION_ID", "")
    _logger.warning(f"header_provider: CALLED. auth_id='{auth_id}', context_type={type(context).__name__}")
    
    # Strategy 1: Direct access to context.state (no isinstance check)
    if not token and context and auth_id:
        try:
            state = getattr(context, 'state', None)
            if state is not None:
                # Try dict-like access directly (works with proxy objects too)
                t = state.get(auth_id) if hasattr(state, 'get') else None
                if not t:
                    t = state[auth_id] if auth_id in state else None
                if t:
                    token = t
                    _logger.warning(f"header_provider: ✅ Strategy1 OK - token from context.state (prefix={token[:30]}..., len={len(token)})")
                else:
                    _logger.warning(f"header_provider: Strategy1 MISS - context.state exists (type={type(state).__name__}) but auth_id '{auth_id}' not found. keys={list(state.keys()) if hasattr(state, 'keys') else 'N/A'}")
        except Exception as ex:
            _logger.warning(f"header_provider: Strategy1 ERROR - context.state access failed: {type(ex).__name__}: {ex}")
    
    # Strategy 2: Try context.session.state
    if not token and context and auth_id:
        try:
            session = getattr(context, 'session', None)
            if session:
                session_state = getattr(session, 'state', None)
                if session_state is not None:
                    t = session_state.get(auth_id) if hasattr(session_state, 'get') else None
                    if not t:
                        t = session_state[auth_id] if auth_id in session_state else None
                    if t:
                        token = t
                        _logger.warning(f"header_provider: ✅ Strategy2 OK - token from context.session.state (prefix={token[:30]}..., len={len(token)})")
        except Exception as ex:
            _logger.warning(f"header_provider: Strategy2 ERROR - context.session.state access failed: {type(ex).__name__}: {ex}")
    
    # Strategy 3: Fallback to builtins
    if not token:
        import builtins
        token = getattr(builtins, '_workspace_oauth_token', '')
        if token:
            _logger.warning(f"header_provider: ✅ Strategy3 OK - token from builtins (prefix={token[:30]}..., len={len(token)})")
    
    if not token:
        _logger.warning("header_provider: ❌ NO TOKEN AVAILABLE - MCP calls will fail with permission denied")
    
    # Token scope verification for debugging - check on first 3 calls per instance
    call_count = getattr(_workspace_header_provider, '_call_count', 0) + 1
    _workspace_header_provider._call_count = call_count
    if token and call_count <= 3:
        try:
            import httpx
            resp = httpx.get(f"https://oauth2.googleapis.com/tokeninfo?access_token={token}", timeout=5)
            if resp.status_code == 200:
                info = resp.json()
                _logger.warning(f"header_provider: 🔍 TOKEN SCOPES: {info.get('scope', 'N/A')}")
                _logger.warning(f"header_provider: 🔍 TOKEN EMAIL: {info.get('email', 'N/A')}, EXPIRES_IN: {info.get('expires_in', 'N/A')}")
            else:
                _logger.warning(f"header_provider: 🔍 TOKEN INFO FAILED: status={resp.status_code}, body={resp.text[:200]}")
        except Exception as ex:
            _logger.warning(f"header_provider: 🔍 TOKEN INFO ERROR: {type(ex).__name__}: {ex}")
    
    if token:
        return {"Authorization": f"Bearer {token}"}
    return {}

# Workspace MCP scope definitions (shared between factory and auth_kwargs)
_GMAIL_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
]
_DRIVE_SCOPES = [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
]
_CALENDAR_SCOPES = [
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    "https://www.googleapis.com/auth/calendar.events.freebusy",
    "https://www.googleapis.com/auth/calendar.events.readonly",
]
_PEOPLE_SCOPES = [
    "https://www.googleapis.com/auth/directory.readonly",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/contacts.readonly",
]
_ALL_WORKSPACE_SCOPES = _GMAIL_SCOPES + _DRIVE_SCOPES + _CALENDAR_SCOPES + _PEOPLE_SCOPES

def _get_workspace_auth_kwargs() -> dict:
    """Returns auth_scheme/auth_credential kwargs for MCP OAuth authentication.
    
    On Cloud Run (K_SERVICE set), we MUST NOT pass auth_scheme/auth_credential
    because the A2A executor does not handle adk_request_credential events.
    Authentication is handled by httpx_client_factory + OAuthClientProvider.
    
    For local development (ADK Web UI), auth_scheme/auth_credential enables
    the interactive OAuth consent flow.
    """
    if os.environ.get("K_SERVICE"):
        return {}
    return {
        "auth_scheme": OAuth2(
            flows=OAuthFlows(
                authorizationCode=OAuthFlowAuthorizationCode(
                    authorizationUrl="https://accounts.google.com/o/oauth2/auth?access_type=offline&prompt=consent",
                    tokenUrl="https://oauth2.googleapis.com/token",
                    scopes={s: s.split('/')[-1] for s in _ALL_WORKSPACE_SCOPES},
                )
            )
        ),
        "auth_credential": AuthCredential(
            auth_type=AuthCredentialTypes.OAUTH2,
            oauth2=OAuth2Auth(
                client_id=os.environ.get("OAUTH_CLIENT_ID", ""),
                client_secret=os.environ.get("OAUTH_CLIENT_SECRET", ""),
            ),
        ),
    }

def get_gmail_mcp_toolset():
    """Creates a Gmail MCP toolset with MCP OAuth support."""
    url = "https://gmailmcp.googleapis.com/mcp/v1"
    return McpToolset(
        connection_params=StreamableHTTPConnectionParams(
            url=url,
            timeout=300,
            httpx_client_factory=_create_workspace_httpx_client_factory(url, _GMAIL_SCOPES),
        ),
        header_provider=_workspace_header_provider,
        tool_filter=['create_draft', 'create_label', 'get_thread', 'label_message', 'label_thread', 'list_drafts', 'list_labels', 'search_threads', 'unlabel_message', 'unlabel_thread'],
        **_get_workspace_auth_kwargs()
    )

def get_drive_mcp_toolset():
    """Creates a Google Drive MCP toolset with MCP OAuth support."""
    url = "https://drivemcp.googleapis.com/mcp/v1"
    return McpToolset(
        connection_params=StreamableHTTPConnectionParams(
            url=url,
            timeout=300,
            httpx_client_factory=_create_workspace_httpx_client_factory(url, _DRIVE_SCOPES),
        ),
        header_provider=_workspace_header_provider,
        tool_filter=['create_file', 'download_file_content', 'get_file_metadata', 'get_file_permissions', 'list_recent_files', 'read_file_content', 'search_files'],
        **_get_workspace_auth_kwargs()
    )

def get_calendar_mcp_toolset():
    """Creates a Google Calendar MCP toolset with MCP OAuth support."""
    url = "https://calendarmcp.googleapis.com/mcp/v1"
    return McpToolset(
        connection_params=StreamableHTTPConnectionParams(
            url=url,
            timeout=300,
            httpx_client_factory=_create_workspace_httpx_client_factory(url, _CALENDAR_SCOPES),
        ),
        header_provider=_workspace_header_provider,
        tool_filter=['create_event', 'delete_event', 'get_event', 'list_calendars', 'list_events', 'respond_to_event', 'suggest_time', 'update_event'],
        **_get_workspace_auth_kwargs()
    )

def get_chat_mcp_toolset():
    """Creates a Google Chat MCP toolset.
    
    DISABLED: Chat MCP causes persistent 'Duplicate function declaration' errors
    in the Gemini API, even when filtering to a single tool. This appears to be
    an ADK/MCP interaction issue where tool declarations are duplicated during
    registration. Returning None to skip Chat MCP and unblock other Workspace tools.
    """
    import logging
    logging.getLogger('workspace_mcp').warning("get_chat_mcp_toolset: DISABLED - returning None to avoid duplicate function declaration errors")
    return None

def get_people_mcp_toolset():
    """Creates a People API MCP toolset with MCP OAuth support."""
    url = "https://people.googleapis.com/mcp/v1"
    return McpToolset(
        connection_params=StreamableHTTPConnectionParams(
            url=url,
            timeout=300,
            httpx_client_factory=_create_workspace_httpx_client_factory(url, _PEOPLE_SCOPES),
        ),
        header_provider=_workspace_header_provider,
        tool_filter=['search_directory_people', 'search_contacts', 'get_user_profile'],
        **_get_workspace_auth_kwargs()
    )
` : ''}

async def generate_image(prompt: str, tool_context: ToolContext) -> dict:
    """Generates a professional business image or presentation slide based on the given prompt.
    
    This tool creates visual assets like infographics, charts, or slides. It automatically 
    stores the image in the current environment's artifact service to be rendered in the chat.
    
    Args:
        prompt: A highly detailed, descriptive prompt for the image. Include stylistic instructions (e.g., 'photorealistic', 'flat design').
                CRITICAL: The prompt text MUST be written in the EXACT SAME language that the user is using in the current chat session.
                If the conversation is in Japanese, you MUST write the entire prompt in Japanese (e.g., '武田電気株式会社の見積状況をまとめたスライド...').
                This ensures all text inside the generated image is rendered in the user's language.
        
    Returns:
        A dictionary with status and detail keys.
    """
    filename = f"image_{uuid.uuid4().hex[:8]}.jpeg"
    
    import os
    import logging
    import re
    location = os.environ.get("GOOGLE_CLOUD_LOCATION", "global")
    project = os.environ.get("GOOGLE_CLOUD_PROJECT")
    
    logging.info(f"generate_image called with prompt: {prompt}")
    logging.info(f"Using location: {location}, project: {project}")
    
    # 1. Automatic language detection on the prompt text (Detect Japanese characters)
    is_japanese = bool(re.search(r'[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]', prompt))
    
    # 2. Construct robust system-level style and language guidelines based on detected language
    base_style_rule = "\\n\\nCRITICAL STYLE RULE: NEVER include headers, watermarks, logos, or any text reading 'Consulting Firm' in the generated image."
    
    if is_japanese:
        # Heavy reinforcement for Japanese rendering (Forces Imagen 3 to use Japanese fonts and text labels exclusively)
        lang_rule = (
            "\\n\\nCRITICAL LANGUAGE RULE: ALL text elements inside the generated image "
            "(including presentation titles, headers, table labels, chart legends, data points, bullet points, annotations, and company names) "
            "MUST be rendered EXCLUSIVELY in Japanese. Do NOT use any English or Latin characters. "
            "For example, render company names as '武田電気株式会社' (not Takeden Co), "
            "and use Japanese for headers like 'エグゼクティブサマリー' or '保留中の見積処理状況'. "
            "This is a strict requirement."
        )
    else:
        lang_rule = (
            "\\n\\nCRITICAL LANGUAGE RULE: ALL text elements inside the generated image "
            "(including titles, labels, axis names, legends, bullet points, annotations, captions) "
            "MUST be rendered in the SAME language as the prompt text above. Do NOT mix languages."
        )
        
    final_prompt = prompt + base_style_rule + lang_rule
    
    client = genai_client.Client(
        vertexai=True, 
        location=location, 
        project=project,
        http_options={'api_version': 'v1'}
    )
    from google.genai import types
    
    try:
        logging.info("Calling Gemini API for image generation...")
        # Generate image via the GenerateContent API
        result = await asyncio.to_thread(
            client.models.generate_content,
            model='gemini-3.1-flash-image',
            contents=[
                types.Content(
                    role="user",
                    parts=[types.Part.from_text(text=final_prompt)]
                )
            ],
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE"],
                image_config=types.ImageConfig(
                    aspect_ratio="16:9",
                    output_mime_type="image/jpeg",
                )
            )
        )
        logging.info("Gemini API call returned.")
    except Exception as e:
        logging.error(f"API Error generating image: {e}", exc_info=True)
        return {'status': 'error', 'detail': f'API Error generating image: {str(e)}'}
    
    if not result.candidates or not result.candidates[0].content.parts:
        logging.warning(f"Failed to generate image for prompt: {prompt}. No candidates or parts.")
        return {'status': 'error', 'detail': f'Failed to generate image for prompt: {prompt}'}
        
    image_bytes = None
    for part in result.candidates[0].content.parts:
        if part.inline_data:
            image_bytes = part.inline_data.data
            break
            
    if not image_bytes:
        logging.warning(f"No image bytes found in the response for prompt: {prompt}")
        return {'status': 'error', 'detail': f'No image bytes found in the response for prompt: {prompt}'}
    
    # Store the image bytes in the session state so the callback can pick it up later
    tool_context.session.state['pending_generated_image'] = image_bytes
    
    return {
        'status': 'success',
        'detail': 'Image generated successfully. It will be attached to your final response automatically.',
    }

def get_custom_mcp_toolsets():
${ (params.importedMcpList && params.importedMcpList.filter(m => m.type !== 'remote').length > 0) ? `
    """Returns a list of McpToolset objects for all imported custom MCP servers."""
    import logging, os, re
    os.environ["FASTMCP_SHOW_SERVER_BANNER"] = "false"
    os.environ["FASTMCP_CHECK_FOR_UPDATES"] = "off"
    toolsets = []
    mcp_configs = [
${params.importedMcpList.filter(m => m.type !== 'remote').map((mcp, idx) => {
  const rk = mcp.required_env_vars.filter(v => v.is_required).map(v => v.key).join(',');
  const safeName = (mcp.name || `mcp${idx}`).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `        {"idx": ${idx}, "port": ${9090 + idx}, "entrypoint": "${mcp.entrypoint}", "required_keys": "${rk}", "name": "${safeName}"},`;
}).join('\n')}
    ]
    for cfg in mcp_configs:
        idx, port, entrypoint = cfg["idx"], cfg["port"], cfg["entrypoint"]
        prefix = cfg.get("name", f"mcp{idx}")
        label = f"MCP #{idx + 1} ({prefix})"
        try:
            logging.warning(f"\U0001f50c [CUSTOM_MCP] Initializing {label}...")
            _rk = [v.strip() for v in cfg["required_keys"].split(",") if v.strip()]
            _missing = [k for k in _rk if not os.environ.get(k) or os.environ.get(k) == "UNDEFINED"]
            if _missing:
                logging.warning(f"\u26a0\ufe0f [CUSTOM_MCP] {label}: Missing env vars: {_missing}. Skipping.")
                continue
            if os.environ.get("K_SERVICE"):
                from google.adk.tools.mcp_tool.mcp_toolset import McpToolset
                from google.adk.tools.mcp_tool.mcp_session_manager import StreamableHTTPConnectionParams
                logging.warning(f"\U0001f50c [CUSTOM_MCP] {label}: StreamableHTTP on port {port}")
                toolsets.append(McpToolset(connection_params=StreamableHTTPConnectionParams(url=f"http://127.0.0.1:{port}/mcp", timeout=300), tool_name_prefix=prefix))
            else:
                from google.adk.tools.mcp_tool.mcp_toolset import McpToolset
                from google.adk.tools.mcp_tool.mcp_session_manager import StdioConnectionParams
                from mcp import StdioServerParameters
                import shlex
                if ":" in entrypoint and " " not in entrypoint:
                    mp, on = entrypoint.split(":")
                    command, args = "python", ["-c", f"import sys,logging,asyncio;logging.basicConfig(level=logging.INFO,stream=sys.stderr);from {mp} import {on}\\ntry:\\n {on}.run(transport='stdio')\\nexcept TypeError:\\n from mcp.server.stdio import stdio_server\\n async def _r():\\n  async with stdio_server() as (r,w):\\n   await {on}.run(r,w,{on}.create_initialization_options())\\n asyncio.run(_r())"]
                else:
                    parts = shlex.split(entrypoint)
                    command, args = parts[0], parts[1:]
                toolsets.append(McpToolset(connection_params=StdioConnectionParams(server_params=StdioServerParameters(command=command,args=args,env=dict(os.environ)),timeout=30.0), tool_name_prefix=prefix))
                logging.warning(f"\u2705 [CUSTOM_MCP] {label}: Stdio toolset created.")
        except Exception as e:
            logging.error(f"\u274c [CUSTOM_MCP] {label}: Failed: {e}", exc_info=True)
    return toolsets if toolsets else []
` : `
    return []
` }

${ (params.importedMcpList || []).some(m => m.type === 'remote' && m.auth_type === 'oauth2_slack') ? `
def get_slack_mcp_toolset():
    """Slack MCP toolset using static User Token (xoxp-) from Secret Manager."""
    import logging, os

    token = os.environ.get("SLACK_ACCESS_TOKEN", "")
    if not token:
        logging.warning("\\u26a0\\ufe0f [SLACK_MCP] SLACK_ACCESS_TOKEN not set \u2014 Slack tools unavailable")
        return None
    try:
        from google.adk.tools.mcp_tool.mcp_toolset import McpToolset
        from google.adk.tools.mcp_tool.mcp_session_manager import StreamableHTTPConnectionParams
        logging.warning("\\U0001f50c [SLACK_MCP] Connecting with static token...")
        return McpToolset(
            connection_params=StreamableHTTPConnectionParams(
                url="https://mcp.slack.com/mcp",
                headers={"Authorization": f"Bearer {token}"},
                timeout=300,
            )
        )
    except Exception as e:
        logging.error(f"\\u274c [SLACK_MCP] Failed to initialize: {e}", exc_info=True)
        return None
` : '' }

# =============================================================================
# Background Task Management (Long-Running Agent Orchestration)
# =============================================================================
import uuid as _task_uuid
import datetime as _task_dt
from google.adk.tools import LongRunningFunctionTool

def register_background_task(
    task_name: str,
    task_description: str,
    task_prompt: str,
    tool_context: ToolContext,
) -> dict:
    """Register a background task for async execution. CRITICAL RULES:
    1. Call this tool EXACTLY ONCE per user request — never split a workflow into multiple tasks.
    2. task_prompt MUST contain ALL workflow steps (SCAN, CLASSIFY, PROCESS, AUDIT, etc.)
       as a complete, self-contained instruction. The background agent uses ONLY task_prompt
       to execute the entire workflow autonomously.
    3. A second call while a task is still ACTIVE (pending/working/submitted) will be BLOCKED.
       Completed, failed, or cancelled tasks CAN be re-registered with a new call.

    Args:
        task_name: Short identifier for the ENTIRE workflow (e.g. 'store_optimization_workflow').
        task_description: Summary of the complete workflow scope.
        task_prompt: COMPLETE, SELF-CONTAINED instruction covering ALL steps from scan to audit.
                     This is the ONLY input the background agent receives. Include data queries,
                     business rules, success criteria, and reporting requirements for every step.

    Returns:
        dict with ticket-id and status.
    """
    import builtins
    _fs = getattr(builtins, '_firestore_client', None)
    _demo_id = os.environ.get("DEMO_ID", "")

    # --- Structural guard: block recursive delegation ---
    # Background workers (user_id="background-worker") must execute tasks
    # directly using data tools, not re-register them as new background tasks.
    if tool_context.user_id == "background-worker":
        return {
            "status": "blocked",
            "message": "Cannot register background tasks from within a background worker. "
                       "Execute operations directly using data tools (get_document, update_document, list_documents, execute_sql, etc.).",
        }

    _task_id = str(_task_uuid.uuid4())[:8]
    _now = _task_dt.datetime.now(_task_dt.timezone.utc)
    _now_iso = _now.isoformat()


    _def_doc = {
        "task_id": _task_id,
        "task_name": task_name,
        "task_description": task_description,
        "task_prompt": task_prompt,
        "task_type": "immediate",
        "created_at": _now_iso,
    }
    _exec_doc = {
        "task_id": _task_id,
        "definition_id": _task_id,
        "status": "submitted",
        "progress_pct": 0,
        "log_tail": "",
        "result_summary": "",
        "started_at": "",
        "completed_at": "",
        "reported_to_user": False,
    }

    import logging as _flog
    _bg_logger = _flog.getLogger("bg_task")

    if not _fs or not _demo_id:
        _bg_logger.error("register_background_task: PRECONDITION FAILED fs=%s demo_id=%s", bool(_fs), repr(_demo_id))
        return {
            "status": "error",
            "message": "Cannot register background task: Firestore client unavailable (client="
                       + str(bool(_fs)) + ", demo_id=" + repr(_demo_id) + "). "
                       + "The task management backend is not configured for this demo.",
        }

    # --- Duplicate task guard ---
    # Block registration if an ACTIVE task with the same task_name exists.
    # This prevents button-spam from creating duplicate tasks.
    try:
        _active_statuses = ("submitted", "working")
        _existing_execs = _fs.collection(_demo_id + "_task_executions").where(
            "status", "in", list(_active_statuses)
        ).stream()
        for _edoc in _existing_execs:
            _edata = _edoc.to_dict()
            _existing_def_id = _edata.get("definition_id", "")
            if _existing_def_id:
                try:
                    _def_ref = _fs.collection(_demo_id + "_task_definitions").document(_existing_def_id).get()
                    if _def_ref.exists:
                        _def_data = _def_ref.to_dict()
                        if _def_data.get("task_name") == task_name:
                            _bg_logger.warning(
                                "register_background_task: BLOCKED duplicate task_name=%s (existing task_id=%s status=%s)",
                                task_name, _edata.get("task_id", "?"), _edata.get("status", "?")
                            )
                            return {
                                "status": "already_active",
                                "ticket-id": _edata.get("task_id", _existing_def_id),
                                "task_name": task_name,
                                "message": "A task with the same name is already active (status: "
                                           + _edata.get("status", "unknown") + "). "
                                           + "Use get_task_result or list_background_tasks to check its progress.",
                            }
                except Exception:
                    pass
    except Exception as _dup_err:
        _bg_logger.warning("register_background_task: duplicate check failed (non-fatal): %s", str(_dup_err)[:200])

    try:
        _fs.collection(_demo_id + "_task_definitions").document(_task_id).set(_def_doc)
        _fs.collection(_demo_id + "_task_executions").document(_task_id).set(_exec_doc)
        _bg_logger.warning("register_background_task: Firestore docs written task_id=%s", _task_id)
    except Exception as _fs_err:
        _bg_logger.error("register_background_task: Firestore write FAILED: %s", str(_fs_err)[:300])
        return {
            "status": "error",
            "message": "Failed to register task: Firestore write error. " + str(_fs_err)[:200],
        }

    # Fire-and-forget: trigger worker endpoint via localhost
    # IMPORTANT: Do NOT use SELF_URL (public *.run.app URL) for self-calls.
    # Cloud Run --ingress internal blocks requests from the container's own
    # public URL because they exit via the internet and re-enter as "external".
    # Using localhost:PORT keeps the request inside the container.
    import threading as _threading
    import requests as _requests
    _port = os.environ.get("PORT", "8080")
    _worker_url = "http://localhost:" + _port + "/execute_task"

    def _fire():
        import logging as _log
        _logger = _log.getLogger("bg_task")
        _logger.warning("_fire: SENDING request worker_url=%s task_id=%s demo_id=%s", _worker_url, _task_id, _demo_id)
        try:
            _headers = {"Content-Type": "application/json"}
            # Use short read timeout (0.5s): this is fire-and-forget.
            # The execute_task endpoint runs the agent asynchronously;
            # we only need to confirm the request was accepted, not wait for completion.
            _resp = _requests.post(_worker_url, json={"task_id": _task_id, "demo_id": _demo_id}, headers=_headers, timeout=(5, 0.5))
            _logger.warning("_fire: response status=%s body=%s", _resp.status_code, _resp.text[:300])
        except _requests.exceptions.ReadTimeout:
            # Expected: the worker is processing asynchronously.
            _logger.warning("_fire: request accepted (ReadTimeout expected for async), task_id=%s", _task_id)
        except _requests.exceptions.ConnectionError as _ce:
            _logger.error("_fire CONNECTION_ERROR: server may not be ready. task_id=%s err=%s", _task_id, str(_ce)[:300])
        except Exception as _e:
            _logger.error("_fire FAILED: %s: %s", type(_e).__name__, str(_e)[:500])
    _threading.Thread(target=_fire, daemon=True).start()



    return {
        "status": "submitted",
        "ticket-id": _task_id,
        "task_name": task_name,
        "message": "Task registered. Processing started in background.",
    }

background_task_tool = LongRunningFunctionTool(func=register_background_task)


def list_background_tasks(tool_context: ToolContext) -> dict:
    """Lists all background tasks and their current status.

    Returns:
        dict with list of tasks.
    """
    import builtins
    _fs = getattr(builtins, '_firestore_client', None)
    _demo_id = os.environ.get("DEMO_ID", "")
    if not _fs or not _demo_id:
        return {"tasks": [], "error": "Firestore not available (client=" + str(bool(_fs)) + ", demo_id=" + repr(_demo_id) + ")"}
    try:
        _docs = _fs.collection(_demo_id + "_task_executions").order_by(
            "started_at", direction="DESCENDING"
        ).limit(20).stream()
        _tasks = []
        for _doc in _docs:
            _d = _doc.to_dict()
            _tasks.append({
                "task_id": _d.get("task_id"),
                "status": _d.get("status"),
                "progress_pct": _d.get("progress_pct", 0),
                "result_summary": _d.get("result_summary", "")[:200],
            })
        return {"tasks": _tasks, "total": len(_tasks)}
    except Exception as _fs_err:
        return {"tasks": [], "error": "Firestore query failed: " + str(_fs_err)[:200]}


def get_task_result(task_id: str, tool_context: ToolContext) -> dict:
    """Gets the detailed result of a specific background task.

    Args:
        task_id: The ticket-id returned from register_background_task.

    Returns:
        dict with status, progress, and result.
    """
    import builtins
    _fs = getattr(builtins, '_firestore_client', None)
    _demo_id = os.environ.get("DEMO_ID", "")
    if not _fs or not _demo_id:
        return {"error": "Firestore not available (client=" + str(bool(_fs)) + ", demo_id=" + repr(_demo_id) + ")"}
    try:
        _ref = _fs.collection(_demo_id + "_task_executions").document(task_id)
        _doc = _ref.get()
        if not _doc.exists:
            return {"error": "Task not found: " + task_id}
        _d = _doc.to_dict()
        # Mark as reported
        if _d.get("status") in ("completed", "failed") and not _d.get("reported_to_user"):
            try:
                _ref.update({"reported_to_user": True})
            except Exception:
                pass  # Non-critical: best-effort mark
        return {
            "task_id": _d.get("task_id"),
            "status": _d.get("status"),
            "progress_pct": _d.get("progress_pct", 0),
            "result_summary": _d.get("result_summary", ""),
            "log_tail": _d.get("log_tail", ""),
            "started_at": _d.get("started_at", ""),
            "completed_at": _d.get("completed_at", ""),
            "_MANDATORY_ACTION": "YOU MUST present result_summary below as formatted markdown text in your response. "
                "Output the result_summary content VERBATIM as text. Do NOT skip it. Do NOT output only suggestion chips. "
                "If your response contains NO text and only A2UI JSON, you have FAILED.",
        }
    except Exception as _fs_err:
        return {"error": "Firestore read failed: " + str(_fs_err)[:200]}


def cancel_background_task(task_id: str, tool_context: ToolContext) -> dict:
    """Cancels a pending or running background task.

    Args:
        task_id: The ticket-id of the task to cancel.

    Returns:
        dict with cancellation status.
    """
    import builtins
    _fs = getattr(builtins, '_firestore_client', None)
    _demo_id = os.environ.get("DEMO_ID", "")
    if not _fs or not _demo_id:
        return {"error": "Firestore not available (client=" + str(bool(_fs)) + ", demo_id=" + repr(_demo_id) + ")"}
    try:
        _ref = _fs.collection(_demo_id + "_task_executions").document(task_id)
        _doc = _ref.get()
        if not _doc.exists:
            return {"error": "Task not found: " + task_id}
        _status = _doc.to_dict().get("status", "")
        if _status in ("completed", "failed", "cancelled"):
            return {"error": "Task already in terminal state: " + _status}
        _ref.update({"status": "cancelled"})
        return {"status": "cancelled", "task_id": task_id}
    except Exception as _fs_err:
        return {"error": "Firestore operation failed: " + str(_fs_err)[:200]}


def update_task_progress(
    task_id: str,
    current_step: str,
    progress_pct: int,
    log_entry: str,
    tool_context: ToolContext,
    workflow_state: dict | None = None,
) -> dict:
    """Updates progress of a running background task. Call this after each
    major workflow step completes to report real-time progress.

    Args:
        task_id: The ticket-id of the background task.
        current_step: Name of the step just completed (e.g. 'CLASSIFY').
        progress_pct: Estimated completion percentage (10-90, not 0 or 100).
        log_entry: Brief description of what was done and key metrics.
        workflow_state: Optional structured state for workflow tracking.
            Keys: completed_steps (list of step names), pending_items (int),
            auto_processed (int), deferred_for_approval (int),
            errors (int), current_phase (str).

    Returns:
        dict with update status.
    """
    import builtins
    import datetime as _dt
    _fs = getattr(builtins, '_firestore_client', None)
    _demo_id = os.environ.get("DEMO_ID", "")
    if not _fs or not _demo_id:
        return {"error": "Firestore not available"}
    try:
        _ref = _fs.collection(_demo_id + "_task_executions").document(task_id)
        _doc = _ref.get()
        if not _doc.exists:
            return {"error": "Task not found: " + task_id}
        _current = _doc.to_dict()
        if _current.get("status") not in ("working", "pending"):
            return {"error": "Task not in active state: " + _current.get("status", "")}
        _now = _dt.datetime.now(_dt.timezone.utc).strftime("%H:%M:%S")
        _existing_log = _current.get("log_tail", "")
        _new_log = _existing_log + ("[" + _now + "] " + current_step + ": " + log_entry + chr(10)) if _existing_log else ("[" + _now + "] " + current_step + ": " + log_entry + chr(10))
        # Keep log_tail to last 1500 chars to prevent unbounded growth
        if len(_new_log) > 1500:
            _new_log = _new_log[-1500:]
        _pct = max(10, min(90, progress_pct))
        _update_data = {
            "progress_pct": _pct,
            "log_tail": _new_log,
        }
        if workflow_state and isinstance(workflow_state, dict):
            _update_data["workflow_state"] = workflow_state
        _ref.update(_update_data)
        return {"status": "updated", "task_id": task_id, "progress_pct": _pct, "step": current_step}
    except Exception as _fs_err:
        return {"error": "Firestore update failed: " + str(_fs_err)[:200]}

def register_scheduled_task(
    task_name: str,
    task_description: str,
    task_prompt: str,
    schedule_cron: str,
    tool_context: ToolContext,
) -> dict:
    """Registers a new scheduled task with automatic Cloud Scheduler job creation.

    Args:
        task_name: Short identifier (e.g. 'daily_report').
        task_description: What the task does.
        task_prompt: Detailed instruction for each execution.
        schedule_cron: Cron expression (e.g. '0 9 * * 1-5' for weekdays 9am).

    Returns:
        dict with task_id, schedule, and job_name.
    """
    import builtins, json as _json, logging as _logging
    _fs = getattr(builtins, '_firestore_client', None)
    _demo_id = os.environ.get("DEMO_ID", "")
    _project_id = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
    _region = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")
    if _region == "global":
        _region = "us-central1"
    _task_id = str(_task_uuid.uuid4())[:8]
    _now = _task_dt.datetime.now(_task_dt.timezone.utc).isoformat()

    # 1. Save definition to Firestore
    _def_doc = {
        "task_id": _task_id,
        "task_name": task_name,
        "task_description": task_description,
        "task_prompt": task_prompt,
        "task_type": "scheduled",
        "schedule_cron": schedule_cron,
        "created_at": _now,
    }
    if _fs and _demo_id:
        _fs.collection(_demo_id + "_task_definitions").document(_task_id).set(_def_doc)
        # Create initial execution document so Data Viewer shows correct status
        _exec_doc = {
            "task_id": _task_id,
            "definition_id": _task_id,
            "status": "scheduled",
            "progress_pct": 0,
            "log_tail": "",
            "result_summary": "",
            "started_at": "",
            "completed_at": "",
            "reported_to_user": False,
        }
        _fs.collection(_demo_id + "_task_executions").document(_task_id).set(_exec_doc)

    # 2. Create Cloud Scheduler job
    _job_name = ""
    _sched_topic = _demo_id + "-sched-tasks"
    try:
        from google.cloud import scheduler_v1
        _sched_client = scheduler_v1.CloudSchedulerClient()
        _parent = "projects/" + _project_id + "/locations/" + _region
        _job_id = _demo_id + "-sched-" + _task_id

        _payload = _json.dumps({"task_id": _task_id, "demo_id": _demo_id}).encode("utf-8")
        _topic_path = "projects/" + _project_id + "/topics/" + _sched_topic

        _job = scheduler_v1.Job(
            name=_parent + "/jobs/" + _job_id,
            schedule=schedule_cron,
            time_zone="Asia/Tokyo",
            pubsub_target=scheduler_v1.PubsubTarget(
                topic_name=_topic_path,
                data=_payload,
            ),
        )
        _created = _sched_client.create_job(parent=_parent, job=_job)
        _job_name = _created.name
        _logging.warning("Created Cloud Scheduler job: " + _job_name)
    except Exception as _e:
        _logging.error("Failed to create scheduler job: " + str(_e))
        return {
            "status": "partial",
            "task_id": _task_id,
            "error": "Firestore saved but scheduler creation failed: " + str(_e)[:200],
        }

    return {
        "status": "scheduled",
        "task_id": _task_id,
        "task_name": task_name,
        "schedule": schedule_cron,
        "job_name": _job_name,
        "message": "Scheduled task registered. Will execute at: " + schedule_cron,
    }


def update_scheduled_task(
    task_id: str,
    schedule_cron: str,
    tool_context: ToolContext,
) -> dict:
    """Updates the schedule of an existing scheduled task.

    Args:
        task_id: The task_id of the scheduled task to update.
        schedule_cron: New cron expression (e.g. '0 18 * * 1-5' for weekdays 6pm).

    Returns:
        dict with updated schedule info.
    """
    import builtins, logging as _logging
    _fs = getattr(builtins, '_firestore_client', None)
    _demo_id = os.environ.get("DEMO_ID", "")
    _project_id = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
    _region = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")
    if _region == "global":
        _region = "us-central1"

    if not _fs or not _demo_id:
        return {"error": "Firestore not available (client=" + str(bool(_fs)) + ", demo_id=" + repr(_demo_id) + ")"}

    # Update Firestore definition
    _def_ref = _fs.collection(_demo_id + "_task_definitions").document(task_id)
    _def_doc = _def_ref.get()
    if not _def_doc.exists:
        return {"error": "Task not found: " + task_id}
    _def_data = _def_doc.to_dict()
    if _def_data.get("task_type") != "scheduled":
        return {"error": "Task is not a scheduled task"}

    _def_ref.update({"schedule_cron": schedule_cron})

    # Update Cloud Scheduler job
    _job_id = _demo_id + "-sched-" + task_id
    try:
        from google.cloud import scheduler_v1
        from google.protobuf import field_mask_pb2
        _client = scheduler_v1.CloudSchedulerClient()
        _job_name = "projects/" + _project_id + "/locations/" + _region + "/jobs/" + _job_id
        _job = scheduler_v1.Job(name=_job_name, schedule=schedule_cron)
        _mask = field_mask_pb2.FieldMask(paths=["schedule"])
        _updated = _client.update_job(job=_job, update_mask=_mask)
        _logging.warning("Updated scheduler job: " + _updated.name + " -> " + schedule_cron)
        return {
            "status": "updated",
            "task_id": task_id,
            "new_schedule": schedule_cron,
            "job_name": _updated.name,
        }
    except Exception as _e:
        _logging.error("Failed to update scheduler job: " + str(_e))
        return {
            "status": "partial",
            "task_id": task_id,
            "message": "Firestore updated but scheduler update failed: " + str(_e)[:200],
        }


def delete_scheduled_task(
    task_id: str,
    tool_context: ToolContext,
) -> dict:
    """Deletes a scheduled task and its Cloud Scheduler job.

    Args:
        task_id: The task_id of the scheduled task to delete.

    Returns:
        dict with deletion status.
    """
    import builtins, logging as _logging
    _fs = getattr(builtins, '_firestore_client', None)
    _demo_id = os.environ.get("DEMO_ID", "")
    _project_id = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
    _region = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")
    if _region == "global":
        _region = "us-central1"

    if not _fs or not _demo_id:
        return {"error": "Firestore not available (client=" + str(bool(_fs)) + ", demo_id=" + repr(_demo_id) + ")"}

    # Check definition exists
    _def_ref = _fs.collection(_demo_id + "_task_definitions").document(task_id)
    _def_doc = _def_ref.get()
    if not _def_doc.exists:
        return {"error": "Task not found: " + task_id}

    # Delete Cloud Scheduler job
    _job_id = _demo_id + "-sched-" + task_id
    try:
        from google.cloud import scheduler_v1
        _client = scheduler_v1.CloudSchedulerClient()
        _job_name = "projects/" + _project_id + "/locations/" + _region + "/jobs/" + _job_id
        _client.delete_job(name=_job_name)
        _logging.warning("Deleted scheduler job: " + _job_name)
    except Exception as _e:
        _logging.warning("Scheduler job deletion failed (may not exist): " + str(_e)[:200])

    # Delete Firestore documents (definition + execution)
    _def_ref.delete()
    _fs.collection(_demo_id + "_task_executions").document(task_id).delete()

    return {
        "status": "deleted",
        "task_id": task_id,
        "message": "Scheduled task, execution record, and Cloud Scheduler job deleted.",
    }


def write_operational_alert(
    alert_title: str,
    alert_message: str,
    status: str = "pending",
    tool_context: ToolContext = None
) -> dict:
    """Writes a high-priority operational alert or outreach task into the Firestore database.
    ALWAYS use this tool when you need to record a high-risk client alert, outreach task, 
    manual verification workflow, or log a manual review flag. Do NOT use raw MCP add_document.
    
    Args:
        alert_title: Clear, descriptive title of the alert (e.g., 'High-Priority Outreach: Satoru Gojo').
        alert_message: Detailed description of rules triggered, client profile, AUM, and required actions.
        status: Initial status of the alert, defaults to 'pending'.
        
    Returns:
        dict with write status and created alert_id.
    """
    import builtins, uuid, datetime
    _fs = getattr(builtins, '_firestore_client', None)
    _demo_id = os.environ.get("DEMO_ID", "")
    if not _fs or not _demo_id:
        return {"status": "error", "message": "Firestore operational database is not configured."}
    
    alert_id = f"alert_{uuid.uuid4().hex[:8]}"
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    doc_data = {
        "alert_id": alert_id,
        "title": alert_title,
        "message": alert_message,
        "status": status,
        "created_at": now_iso,
        "updated_at": now_iso
    }
    try:
        _fs.collection(f"{_demo_id}_alerts").document(alert_id).set(doc_data)
        return {"status": "success", "alert_id": alert_id, "message": "Alert recorded successfully in operational database."}
    except Exception as e:
        return {"status": "error", "message": f"Failed to record alert: {str(e)}"}


def save_document_to_db(
    collection_name: str,
    document_id: str,
    document_json_string: str,
    tool_context: ToolContext = None
) -> dict:
    """Saves or updates a structured document in the Firestore operational database.
    Use this general tool to write structured records (orders, client updates, tasks).
    Accepts either a raw dictionary or a clean JSON-serialized string.
    
    Args:
        collection_name: Target collection name (e.g., 'outreach_tasks', 'client_status').
        document_id: Unique document identifier (e.g., 'client_102').
        document_json_string: Document body serialized as a JSON string OR a raw key-value dictionary.
        
    Returns:
        dict with database write status.
    """
    import builtins, json
    _fs = getattr(builtins, '_firestore_client', None)
    _demo_id = os.environ.get("DEMO_ID", "")
    if not _fs or not _demo_id:
        return {"status": "error", "message": "Firestore database is not configured."}
        
    try:
        if isinstance(document_json_string, dict):
            data = document_json_string
        else:
            data = json.loads(document_json_string)
            
        if not isinstance(data, dict):
            return {"status": "error", "message": "JSON body must represent a key-value dictionary."}
        
        # Automatically inject ISO-8601 timestamp representing last update time for dynamic sorting in Data Viewer
        import datetime
        data["updated_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        
        full_coll = f"{_demo_id}_{collection_name}" if not collection_name.startswith(_demo_id) else collection_name
        _fs.collection(full_coll).document(document_id).set(data)
        return {"status": "success", "document_id": document_id, "message": f"Document saved successfully in {full_coll}."}
    except Exception as e:
        return {"status": "error", "message": f"Failed to save document: {str(e)}"}
__TOOLS_EOF__

mkdir -p adk_agent/app/examples/0.8
cat <<'__CONFIRMATION_EOF__' > adk_agent/app/examples/0.8/complex_confirmation_card.json
[
  { 
    "beginRendering": { 
      "surfaceId": "confirmation-surface", 
      "root": "root" 
    } 
  },
  { 
    "surfaceUpdate": {
      "surfaceId": "confirmation-surface",
      "components": [
        {
          "id": "root",
          "component": {
            "Card": {
              "child": "mainColumn"
            }
          }
        },
        {
          "id": "mainColumn",
          "component": {
            "Column": {
              "children": {
                "explicitList": [
                  "titleText",
                  "beforeText",
                  "afterText",
                  "actionRow"
                ]
              },
              "distribution": "spaceAround",
              "alignment": "center"
            }
          }
        },
        {
          "id": "titleText",
          "component": {
            "Text": {
              "text": {
                "literalString": "Confirm Data Update"
              },
              "usageHint": "h2"
            }
          }
        },
        {
          "id": "beforeText",
          "component": {
            "Text": {
              "text": {
                "literalString": "Before: [Previous Data Summary]"
              },
              "usageHint": "body"
            }
          }
        },
        {
          "id": "afterText",
          "component": {
            "Text": {
              "text": {
                "literalString": "After: [New Data Summary]"
              },
              "usageHint": "body"
            }
          }
        },
        {
          "id": "actionRow",
          "component": {
            "Row": {
              "children": {
                "explicitList": [
                  "btnApprove",
                  "btnReject"
                ]
              },
              "distribution": "spaceEvenly",
              "alignment": "center"
            }
          }
        },
        {
          "id": "btnApprove",
          "component": {
            "Button": {
              "child": "lblApprove",
              "action": {
                "name": "sendText",
                "context": [
                  { "key": "text", "value": { "literalString": "Approved" } }
                ]
              }
            }
          }
        },
        {
          "id": "lblApprove",
          "component": {
            "Text": {
              "text": { "literalString": "Approve" },
              "usageHint": "body"
            }
          }
        },
        {
          "id": "btnReject",
          "component": {
            "Button": {
              "child": "lblReject",
              "action": {
                "name": "sendText",
                "context": [
                  { "key": "text", "value": { "literalString": "Rejected" } }
                ]
              }
            }
          }
        },
        {
          "id": "lblReject",
          "component": {
            "Text": {
              "text": { "literalString": "Cancel" },
              "usageHint": "body"
            }
          }
        }
      ]
    }
  }
]
__CONFIRMATION_EOF__

cat <<'__ANALYSIS_EOF__' > adk_agent/app/examples/0.8/analysis_summary_card.json
[
  {
    "beginRendering": {
      "surfaceId": "analysis-surface",
      "root": "root"
    }
  },
  {
    "surfaceUpdate": {
      "surfaceId": "analysis-surface",
      "components": [
        {
          "id": "root",
          "component": {
            "Card": {
              "child": "mainColumn"
            }
          }
        },
        {
          "id": "mainColumn",
          "component": {
            "Column": {
              "children": {
                "explicitList": [
                  "titleText",
                  "divider1",
                  "kpiRow",
                  "divider2",
                  "summaryText",
                  "actionRow"
                ]
              },
              "distribution": "start",
              "alignment": "stretch"
            }
          }
        },
        {
          "id": "titleText",
          "component": {
            "Text": {
              "text": {
                "literalString": "Analysis Summary: Q4 Revenue Performance"
              },
              "usageHint": "h2"
            }
          }
        },
        {
          "id": "divider1",
          "component": {
            "Divider": {}
          }
        },
        {
          "id": "kpiRow",
          "component": {
            "Row": {
              "children": {
                "explicitList": [
                  "kpi1",
                  "kpi2",
                  "kpi3"
                ]
              },
              "distribution": "spaceEvenly",
              "alignment": "center"
            }
          }
        },
        {
          "id": "kpi1",
          "component": {
            "Text": {
              "text": {
                "literalString": "Total Revenue: $12.4M (+8.2%)"
              },
              "usageHint": "body"
            }
          }
        },
        {
          "id": "kpi2",
          "component": {
            "Text": {
              "text": {
                "literalString": "Anomalies Detected: 23"
              },
              "usageHint": "body"
            }
          }
        },
        {
          "id": "kpi3",
          "component": {
            "Text": {
              "text": {
                "literalString": "Resolution Rate: 87%"
              },
              "usageHint": "body"
            }
          }
        },
        {
          "id": "divider2",
          "component": {
            "Divider": {}
          }
        },
        {
          "id": "summaryText",
          "component": {
            "Text": {
              "text": {
                "literalString": "Key findings: Revenue growth driven by APAC region (+15.3%). Three critical anomalies in billing reconciliation require immediate attention. Recommended action: escalate invoice IDs INV-4521, INV-4589 to finance team."
              },
              "usageHint": "body"
            }
          }
        },
        {
          "id": "actionRow",
          "component": {
            "Row": {
              "children": {
                "explicitList": [
                  "btnDrillDown",
                  "btnExport"
                ]
              },
              "distribution": "spaceEvenly",
              "alignment": "center"
            }
          }
        },
        {
          "id": "btnDrillDown",
          "component": {
            "Button": {
              "child": "lblDrillDown",
              "action": {
                "name": "sendText",
                "context": [
                  { "key": "text", "value": { "literalString": "Show me the detailed breakdown of the anomalies" } }
                ]
              }
            }
          }
        },
        {
          "id": "lblDrillDown",
          "component": {
            "Text": {
              "text": { "literalString": "Drill Down" },
              "usageHint": "body"
            }
          }
        },
        {
          "id": "btnExport",
          "component": {
            "Button": {
              "child": "lblExport",
              "action": {
                "name": "sendText",
                "context": [
                  { "key": "text", "value": { "literalString": "Generate a visual summary report" } }
                ]
              }
            }
          }
        },
        {
          "id": "lblExport",
          "component": {
            "Text": {
              "text": { "literalString": "Generate Report" },
              "usageHint": "body"
            }
          }
        }
      ]
    }
  }
]
__ANALYSIS_EOF__

cat <<'__DASHBOARD_EOF__' > adk_agent/app/examples/0.8/status_dashboard.json
[
  {
    "beginRendering": {
      "surfaceId": "dashboard-surface",
      "root": "root"
    }
  },
  {
    "surfaceUpdate": {
      "surfaceId": "dashboard-surface",
      "components": [
        {
          "id": "root",
          "component": {
            "Card": {
              "child": "mainColumn"
            }
          }
        },
        {
          "id": "mainColumn",
          "component": {
            "Column": {
              "children": {
                "explicitList": [
                  "dashTitle",
                  "divider1",
                  "statusList",
                  "divider2",
                  "refreshRow"
                ]
              },
              "distribution": "start",
              "alignment": "stretch"
            }
          }
        },
        {
          "id": "dashTitle",
          "component": {
            "Text": {
              "text": {
                "literalString": "Operational Status Dashboard"
              },
              "usageHint": "h2"
            }
          }
        },
        {
          "id": "divider1",
          "component": {
            "Divider": {}
          }
        },
        {
          "id": "statusList",
          "component": {
            "Column": {
              "children": {
                "explicitList": [
                  "item1",
                  "item2",
                  "item3",
                  "item4"
                ]
              },
              "distribution": "start",
              "alignment": "stretch"
            }
          }
        },
        {
          "id": "item1",
          "component": {
            "Text": {
              "text": {
                "literalString": "\u2705 Invoice Processing: 142 completed, 0 errors"
              },
              "usageHint": "body"
            }
          }
        },
        {
          "id": "item2",
          "component": {
            "Text": {
              "text": {
                "literalString": "\u26a0\ufe0f Compliance Review: 8 items pending (3 high priority)"
              },
              "usageHint": "body"
            }
          }
        },
        {
          "id": "item3",
          "component": {
            "Text": {
              "text": {
                "literalString": "\u274c Data Reconciliation: 2 mismatches found in Region-APAC"
              },
              "usageHint": "body"
            }
          }
        },
        {
          "id": "item4",
          "component": {
            "Text": {
              "text": {
                "literalString": "\u2705 Audit Trail: All 56 entries verified"
              },
              "usageHint": "body"
            }
          }
        },
        {
          "id": "divider2",
          "component": {
            "Divider": {}
          }
        },
        {
          "id": "refreshRow",
          "component": {
            "Row": {
              "children": {
                "explicitList": [
                  "btnRefresh",
                  "btnResolve"
                ]
              },
              "distribution": "spaceEvenly",
              "alignment": "center"
            }
          }
        },
        {
          "id": "btnRefresh",
          "component": {
            "Button": {
              "child": "lblRefresh",
              "action": {
                "name": "sendText",
                "context": [
                  { "key": "text", "value": { "literalString": "Refresh the operational status" } }
                ]
              }
            }
          }
        },
        {
          "id": "lblRefresh",
          "component": {
            "Text": {
              "text": { "literalString": "Refresh Status" },
              "usageHint": "body"
            }
          }
        },
        {
          "id": "btnResolve",
          "component": {
            "Button": {
              "child": "lblResolve",
              "action": {
                "name": "sendText",
                "context": [
                  { "key": "text", "value": { "literalString": "Investigate and resolve the data reconciliation mismatches" } }
                ]
              }
            }
          }
        },
        {
          "id": "lblResolve",
          "component": {
            "Text": {
              "text": { "literalString": "Resolve Issues" },
              "usageHint": "body"
            }
          }
        }
      ]
    }
  }
]
__DASHBOARD_EOF__

cat <<'__COMPARISON_EOF__' > adk_agent/app/examples/0.8/before_after_comparison.json
[
  {
    "beginRendering": {
      "surfaceId": "comparison-surface",
      "root": "root"
    }
  },
  {
    "surfaceUpdate": {
      "surfaceId": "comparison-surface",
      "components": [
        {
          "id": "root",
          "component": {
            "Card": {
              "child": "outerColumn"
            }
          }
        },
        {
          "id": "outerColumn",
          "component": {
            "Column": {
              "children": {
                "explicitList": [
                  "compTitle",
                  "divider1",
                  "comparisonRow",
                  "divider2",
                  "actionRow"
                ]
              },
              "distribution": "start",
              "alignment": "stretch"
            }
          }
        },
        {
          "id": "compTitle",
          "component": {
            "Text": {
              "text": {
                "literalString": "Data Update Preview"
              },
              "usageHint": "h2"
            }
          }
        },
        {
          "id": "divider1",
          "component": {
            "Divider": {}
          }
        },
        {
          "id": "comparisonRow",
          "component": {
            "Row": {
              "children": {
                "explicitList": [
                  "beforeCard",
                  "afterCard"
                ]
              },
              "distribution": "spaceEvenly",
              "alignment": "start"
            }
          }
        },
        {
          "id": "beforeCard",
          "component": {
            "Card": {
              "child": "beforeColumn"
            }
          }
        },
        {
          "id": "beforeColumn",
          "component": {
            "Column": {
              "children": {
                "explicitList": [
                  "beforeTitle",
                  "beforeStatus",
                  "beforePriority",
                  "beforeAssigned"
                ]
              },
              "distribution": "start",
              "alignment": "start"
            }
          }
        },
        {
          "id": "beforeTitle",
          "component": {
            "Text": {
              "text": { "literalString": "Before" },
              "usageHint": "h2"
            }
          }
        },
        {
          "id": "beforeStatus",
          "component": {
            "Text": {
              "text": { "literalString": "Status: Discrepancy Found" },
              "usageHint": "body"
            }
          }
        },
        {
          "id": "beforePriority",
          "component": {
            "Text": {
              "text": { "literalString": "Priority: High" },
              "usageHint": "body"
            }
          }
        },
        {
          "id": "beforeAssigned",
          "component": {
            "Text": {
              "text": { "literalString": "Assigned: Unassigned" },
              "usageHint": "body"
            }
          }
        },
        {
          "id": "afterCard",
          "component": {
            "Card": {
              "child": "afterColumn"
            }
          }
        },
        {
          "id": "afterColumn",
          "component": {
            "Column": {
              "children": {
                "explicitList": [
                  "afterTitle",
                  "afterStatus",
                  "afterPriority",
                  "afterAssigned"
                ]
              },
              "distribution": "start",
              "alignment": "start"
            }
          }
        },
        {
          "id": "afterTitle",
          "component": {
            "Text": {
              "text": { "literalString": "After" },
              "usageHint": "h2"
            }
          }
        },
        {
          "id": "afterStatus",
          "component": {
            "Text": {
              "text": { "literalString": "Status: Resolved" },
              "usageHint": "body"
            }
          }
        },
        {
          "id": "afterPriority",
          "component": {
            "Text": {
              "text": { "literalString": "Priority: Low" },
              "usageHint": "body"
            }
          }
        },
        {
          "id": "afterAssigned",
          "component": {
            "Text": {
              "text": { "literalString": "Assigned: Tanaka Yuki" },
              "usageHint": "body"
            }
          }
        },
        {
          "id": "divider2",
          "component": {
            "Divider": {}
          }
        },
        {
          "id": "actionRow",
          "component": {
            "Row": {
              "children": {
                "explicitList": [
                  "btnApply",
                  "btnCancel"
                ]
              },
              "distribution": "spaceEvenly",
              "alignment": "center"
            }
          }
        },
        {
          "id": "btnApply",
          "component": {
            "Button": {
              "child": "lblApply",
              "action": {
                "name": "sendText",
                "context": [
                  { "key": "text", "value": { "literalString": "Apply this update" } }
                ]
              }
            }
          }
        },
        {
          "id": "lblApply",
          "component": {
            "Text": {
              "text": { "literalString": "Apply Changes" },
              "usageHint": "body"
            }
          }
        },
        {
          "id": "btnCancel",
          "component": {
            "Button": {
              "child": "lblCancel",
              "action": {
                "name": "sendText",
                "context": [
                  { "key": "text", "value": { "literalString": "Cancel this update" } }
                ]
              }
            }
          }
        },
        {
          "id": "lblCancel",
          "component": {
            "Text": {
              "text": { "literalString": "Cancel" },
              "usageHint": "body"
            }
          }
        }
      ]
    }
  }
]
__COMPARISON_EOF__

cat <<'__DASHBOARD_EOF__' > adk_agent/app/examples/0.8/profile_analysis_dashboard.json
[
  {
    "beginRendering": {
      "surfaceId": "profile-dashboard",
      "root": "root"
    }
  },
  {
    "surfaceUpdate": {
      "surfaceId": "profile-dashboard",
      "components": [
        {
          "id": "root",
          "component": {
            "Card": {
              "child": "mainColumn"
            }
          }
        },
        {
          "id": "mainColumn",
          "component": {
            "Column": {
              "children": {
                "explicitList": [
                  "headerTitle",
                  "profileSubtitle",
                  "divider1",
                  "kpiRow",
                  "divider2",
                  "timelineTitle",
                  "timelineItem1",
                  "timelineItem2",
                  "divider3",
                  "insightTitle",
                  "insightBody",
                  "divider4",
                  "actionRow"
                ]
              },
              "distribution": "start",
              "alignment": "stretch"
            }
          }
        },
        {
          "id": "headerTitle",
          "component": {
            "Text": {
              "text": { "literalString": "📊 Kenta Takahashi (ALM-005) Profile Analysis" },
              "usageHint": "h2"
            }
          }
        },
        {
          "id": "profileSubtitle",
          "component": {
            "Text": {
              "text": { "literalString": "Class of 2000, Economics | Mitsubishi UFJ Bank, Head of Corporate Planning" },
              "usageHint": "h3"
            }
          }
        },
        {
          "id": "divider1",
          "component": { "Divider": {} }
        },
        {
          "id": "kpiRow",
          "component": {
            "Row": {
              "children": {
                "explicitList": ["kpiScore", "kpiDonation", "kpiRank"]
              },
              "distribution": "spaceEvenly",
              "alignment": "center"
            }
          }
        },
        {
          "id": "kpiScore",
          "component": {
            "Column": {
              "children": {
                "explicitList": ["kpiScoreValue", "kpiScoreLabel"]
              },
              "distribution": "start",
              "alignment": "center"
            }
          }
        },
        {
          "id": "kpiScoreValue",
          "component": {
            "Text": {
              "text": { "literalString": "45" },
              "usageHint": "h2"
            }
          }
        },
        {
          "id": "kpiScoreLabel",
          "component": {
            "Text": {
              "text": { "literalString": "Engagement" },
              "usageHint": "caption"
            }
          }
        },
        {
          "id": "kpiDonation",
          "component": {
            "Column": {
              "children": {
                "explicitList": ["kpiDonationValue", "kpiDonationLabel"]
              },
              "distribution": "start",
              "alignment": "center"
            }
          }
        },
        {
          "id": "kpiDonationValue",
          "component": {
            "Text": {
              "text": { "literalString": "${currencySymbol}50,000" },
              "usageHint": "h2"
            }
          }
        },
        {
          "id": "kpiDonationLabel",
          "component": {
            "Text": {
              "text": { "literalString": "Lifetime Donations" },
              "usageHint": "caption"
            }
          }
        },
        {
          "id": "kpiRank",
          "component": {
            "Column": {
              "children": {
                "explicitList": ["kpiRankValue", "kpiRankLabel"]
              },
              "distribution": "start",
              "alignment": "center"
            }
          }
        },
        {
          "id": "kpiRankValue",
          "component": {
            "Text": {
              "text": { "literalString": "CFO" },
              "usageHint": "h2"
            }
          }
        },
        {
          "id": "kpiRankLabel",
          "component": {
            "Text": {
              "text": { "literalString": "Current Title" },
              "usageHint": "caption"
            }
          }
        },
        {
          "id": "divider2",
          "component": { "Divider": {} }
        },
        {
          "id": "timelineTitle",
          "component": {
            "Text": {
              "text": { "literalString": "📅 Event Attendance History" },
              "usageHint": "h3"
            }
          }
        },
        {
          "id": "timelineItem1",
          "component": {
            "Text": {
              "text": { "literalString": "✅ 2024/03/05 Global Career Seminar — Attended" },
              "usageHint": "body"
            }
          }
        },
        {
          "id": "timelineItem2",
          "component": {
            "Text": {
              "text": { "literalString": "❌ 2024/04/10 Spring Gala 2024 — Absent (coincided with CFO appointment)" },
              "usageHint": "body"
            }
          }
        },
        {
          "id": "divider3",
          "component": { "Divider": {} }
        },
        {
          "id": "insightTitle",
          "component": {
            "Text": {
              "text": { "literalString": "💡 Cross-Silo Insights & Recommended Actions" },
              "usageHint": "h3"
            }
          }
        },
        {
          "id": "insightBody",
          "component": {
            "Text": {
              "text": { "literalString": "Post-CFO appointment workload likely caused the absence. As things stabilize, now is the ideal time for a 1-on-1 outreach from the Dean or a VIP dinner invitation." },
              "usageHint": "body"
            }
          }
        },
        {
          "id": "divider4",
          "component": { "Divider": {} }
        },
        {
          "id": "actionRow",
          "component": {
            "Row": {
              "children": {
                "explicitList": ["btnDeepDive", "btnSchedule", "btnUpdateDb"]
              },
              "distribution": "spaceEvenly",
              "alignment": "center"
            }
          }
        },
        {
          "id": "btnDeepDive",
          "component": {
            "Button": {
              "child": "lblDeepDive",
              "action": {
                "name": "sendText",
                "context": [
                  { "key": "text", "value": { "literalString": "Analyze Takahashi's donation history in detail" } }
                ]
              }
            }
          }
        },
        {
          "id": "lblDeepDive",
          "component": {
            "Text": {
              "text": { "literalString": "🔍 Deep-Dive" },
              "usageHint": "body"
            }
          }
        },
        {
          "id": "btnSchedule",
          "component": {
            "Button": {
              "child": "lblSchedule",
              "action": {
                "name": "sendText",
                "context": [
                  { "key": "text", "value": { "literalString": "Draft an outreach email for Takahashi" } }
                ]
              }
            }
          }
        },
        {
          "id": "lblSchedule",
          "component": {
            "Text": {
              "text": { "literalString": "✉️ Draft Email" },
              "usageHint": "body"
            }
          }
        },
        {
          "id": "btnUpdateDb",
          "component": {
            "Button": {
              "child": "lblUpdateDb",
              "action": {
                "name": "sendText",
                "context": [
                  { "key": "text", "value": { "literalString": "Update Takahashi's Engagement Score" } }
                ]
              }
            }
          }
        },
        {
          "id": "lblUpdateDb",
          "component": {
            "Text": {
              "text": { "literalString": "📝 Update DB" },
              "usageHint": "body"
            }
          }
        }
      ]
    }
  }
]
__DASHBOARD_EOF__

cat <<'__RANKING_EOF__' > adk_agent/app/examples/0.8/ranking_table.json
[
  { "beginRendering": { "surfaceId": "ranking-surface", "root": "root" } },
  { "surfaceUpdate": { "surfaceId": "ranking-surface", "components": [
    { "id": "root", "component": { "Card": { "child": "mainCol" } } },
    { "id": "mainCol", "component": { "Column": { "children": { "explicitList": ["title", "subtitle", "div1", "rank1", "rank2", "rank3", "rank4", "rank5", "div2", "actionRow"] }, "distribution": "start", "alignment": "stretch" } } },
    { "id": "title", "component": { "Text": { "text": { "literalString": "🏆 Donation Ranking TOP 5" }, "usageHint": "h2" } } },
    { "id": "subtitle", "component": { "Text": { "text": { "literalString": "FY2024 — Cumulative Donations" }, "usageHint": "caption" } } },
    { "id": "div1", "component": { "Divider": {} } },
    { "id": "rank1", "component": { "Text": { "text": { "literalString": "🥇 #1  Taro Tanaka (Engineering)  ${currencySymbol}1,200,000  Score: 92" }, "usageHint": "body" } } },
    { "id": "rank2", "component": { "Text": { "text": { "literalString": "🥈 #2  Hanako Sato (Law)  ${currencySymbol}980,000  Score: 88" }, "usageHint": "body" } } },
    { "id": "rank3", "component": { "Text": { "text": { "literalString": "🥉 #3  Ichiro Suzuki (Medicine)  ${currencySymbol}750,000  Score: 85" }, "usageHint": "body" } } },
    { "id": "rank4", "component": { "Text": { "text": { "literalString": "   #4  Misaki Yamada (Economics)  ${currencySymbol}520,000  Score: 76" }, "usageHint": "body" } } },
    { "id": "rank5", "component": { "Text": { "text": { "literalString": "   #5  Kenta Takahashi (Economics)  ${currencySymbol}50,000  Score: 45" }, "usageHint": "body" } } },
    { "id": "div2", "component": { "Divider": {} } },
    { "id": "actionRow", "component": { "Row": { "children": { "explicitList": ["btnDetail", "btnExport"] }, "distribution": "spaceEvenly", "alignment": "center" } } },
    { "id": "btnDetail", "component": { "Button": { "child": "lblDetail", "action": { "name": "sendText", "context": [{ "key": "text", "value": { "literalString": "Analyze #1 Taro Tanaka in detail" } }] } } } },
    { "id": "lblDetail", "component": { "Text": { "text": { "literalString": "🔍 Deep-Dive #1" }, "usageHint": "body" } } },
    { "id": "btnExport", "component": { "Button": { "child": "lblExport", "action": { "name": "sendText", "context": [{ "key": "text", "value": { "literalString": "Show the full alumni ranking" } }] } } } },
    { "id": "lblExport", "component": { "Text": { "text": { "literalString": "📊 Show All" }, "usageHint": "body" } } }
  ] } }
]
__RANKING_EOF__

cat <<'__MATRIX_EOF__' > adk_agent/app/examples/0.8/comparison_matrix.json
[
  { "beginRendering": { "surfaceId": "comparison-matrix", "root": "root" } },
  { "surfaceUpdate": { "surfaceId": "comparison-matrix", "components": [
    { "id": "root", "component": { "Card": { "child": "mainCol" } } },
    { "id": "mainCol", "component": { "Column": { "children": { "explicitList": ["title", "div1", "compareRow", "div2", "summaryText", "div3", "actionRow"] }, "distribution": "start", "alignment": "stretch" } } },
    { "id": "title", "component": { "Text": { "text": { "literalString": "📊 Faculty Performance Comparison" }, "usageHint": "h2" } } },
    { "id": "div1", "component": { "Divider": {} } },
    { "id": "compareRow", "component": { "Row": { "children": { "explicitList": ["colA", "colB", "colC"] }, "distribution": "spaceEvenly", "alignment": "start" } } },
    { "id": "colA", "component": { "Column": { "children": { "explicitList": ["colATitle", "colAK1", "colAK2", "colAK3"] }, "distribution": "start", "alignment": "center" } } },
    { "id": "colATitle", "component": { "Text": { "text": { "literalString": "🏗️ Engineering" }, "usageHint": "h3" } } },
    { "id": "colAK1", "component": { "Text": { "text": { "literalString": "Donations: ${currencySymbol}1.97M" }, "usageHint": "body" } } },
    { "id": "colAK2", "component": { "Text": { "text": { "literalString": "Score: 79.0" }, "usageHint": "body" } } },
    { "id": "colAK3", "component": { "Text": { "text": { "literalString": "6 members" }, "usageHint": "caption" } } },
    { "id": "colB", "component": { "Column": { "children": { "explicitList": ["colBTitle", "colBK1", "colBK2", "colBK3"] }, "distribution": "start", "alignment": "center" } } },
    { "id": "colBTitle", "component": { "Text": { "text": { "literalString": "⚖️ Law" }, "usageHint": "h3" } } },
    { "id": "colBK1", "component": { "Text": { "text": { "literalString": "Donations: ${currencySymbol}1.77M" }, "usageHint": "body" } } },
    { "id": "colBK2", "component": { "Text": { "text": { "literalString": "Score: 75.5" }, "usageHint": "body" } } },
    { "id": "colBK3", "component": { "Text": { "text": { "literalString": "8 members" }, "usageHint": "caption" } } },
    { "id": "colC", "component": { "Column": { "children": { "explicitList": ["colCTitle", "colCK1", "colCK2", "colCK3"] }, "distribution": "start", "alignment": "center" } } },
    { "id": "colCTitle", "component": { "Text": { "text": { "literalString": "💰 Economics" }, "usageHint": "h3" } } },
    { "id": "colCK1", "component": { "Text": { "text": { "literalString": "Donations: ${currencySymbol}1.20M" }, "usageHint": "body" } } },
    { "id": "colCK2", "component": { "Text": { "text": { "literalString": "Score: 67.0" }, "usageHint": "body" } } },
    { "id": "colCK3", "component": { "Text": { "text": { "literalString": "8 members" }, "usageHint": "caption" } } },
    { "id": "div2", "component": { "Divider": {} } },
    { "id": "summaryText", "component": { "Text": { "text": { "literalString": "💡 Engineering leads in both donations and score. Economics has more members but lower scores — engagement strategy reinforcement recommended" }, "usageHint": "body" } } },
    { "id": "div3", "component": { "Divider": {} } },
    { "id": "actionRow", "component": { "Row": { "children": { "explicitList": ["btnEcon", "btnReport"] }, "distribution": "spaceEvenly", "alignment": "center" } } },
    { "id": "btnEcon", "component": { "Button": { "child": "lblEcon", "action": { "name": "sendText", "context": [{ "key": "text", "value": { "literalString": "Analyze the root cause of low engagement in Economics" } }] } } } },
    { "id": "lblEcon", "component": { "Text": { "text": { "literalString": "📉 Deep-Dive Economics" }, "usageHint": "body" } } },
    { "id": "btnReport", "component": { "Button": { "child": "lblReport", "action": { "name": "sendText", "context": [{ "key": "text", "value": { "literalString": "Generate a detailed report for all faculties" } }] } } } },
    { "id": "lblReport", "component": { "Text": { "text": { "literalString": "📋 All Faculties Report" }, "usageHint": "body" } } }
  ] } }
]
__MATRIX_EOF__

cat <<'__ACTIONPLAN_EOF__' > adk_agent/app/examples/0.8/action_plan.json
[
  { "beginRendering": { "surfaceId": "action-plan", "root": "root" } },
  { "surfaceUpdate": { "surfaceId": "action-plan", "components": [
    { "id": "root", "component": { "Card": { "child": "mainCol" } } },
    { "id": "mainCol", "component": { "Column": { "children": { "explicitList": ["title", "subtitle", "div1", "step1", "step2", "step3", "step4", "div2", "actionRow"] }, "distribution": "start", "alignment": "stretch" } } },
    { "id": "title", "component": { "Text": { "text": { "literalString": "🎯 Recommended Action Plan" }, "usageHint": "h2" } } },
    { "id": "subtitle", "component": { "Text": { "text": { "literalString": "Economics Engagement Improvement — 4-Step Strategy" }, "usageHint": "h3" } } },
    { "id": "div1", "component": { "Divider": {} } },
    { "id": "step1", "component": { "Text": { "text": { "literalString": "1️⃣ [Immediate] Personal outreach email from the Dean to Takahashi (CFO) — Expected: Engagement Score +15pt" }, "usageHint": "body" } } },
    { "id": "step2", "component": { "Text": { "text": { "literalString": "2️⃣ [Within 1 month] Plan & invite to VIP dinner event — Target: 5 mid-tier alumni (Score 40-60)" }, "usageHint": "body" } } },
    { "id": "step3", "component": { "Text": { "text": { "literalString": "3️⃣ [Within 3 months] Launch Economics-exclusive mentoring program — Goal: Faculty avg Score 67→75" }, "usageHint": "body" } } },
    { "id": "step4", "component": { "Text": { "text": { "literalString": "4️⃣ [At 6 months] Impact assessment & next strategy — KPI: Donations +20% YoY, Avg Score ≥75" }, "usageHint": "body" } } },
    { "id": "div2", "component": { "Divider": {} } },
    { "id": "actionRow", "component": { "Row": { "children": { "explicitList": ["btnStep1", "btnSchedule"] }, "distribution": "spaceEvenly", "alignment": "center" } } },
    { "id": "btnStep1", "component": { "Button": { "child": "lblStep1", "action": { "name": "sendText", "context": [{ "key": "text", "value": { "literalString": "Draft the outreach email for Step 1" } }] } } } },
    { "id": "lblStep1", "component": { "Text": { "text": { "literalString": "✉️ Draft Email" }, "usageHint": "body" } } },
    { "id": "btnSchedule", "component": { "Button": { "child": "lblSchedule", "action": { "name": "sendText", "context": [{ "key": "text", "value": { "literalString": "Create a detailed schedule for this plan" } }] } } } },
    { "id": "lblSchedule", "component": { "Text": { "text": { "literalString": "📅 Create Schedule" }, "usageHint": "body" } } }
  ] } }
]
__ACTIONPLAN_EOF__

cat <<'__MAPS_EOF__' > adk_agent/app/examples/0.8/maps_place_card.json
[
  { "beginRendering": { "surfaceId": "maps-results", "root": "root" } },
  { "surfaceUpdate": { "surfaceId": "maps-results", "components": [
    { "id": "root", "component": { "Card": { "child": "mainCol" } } },
    { "id": "mainCol", "component": { "Column": { "children": { "explicitList": ["title", "div1", "place1", "place1Detail", "div2", "place2", "place2Detail", "div3", "place3", "place3Detail", "div4", "actionRow"] }, "distribution": "start", "alignment": "stretch" } } },
    { "id": "title", "component": { "Text": { "text": { "literalString": "📍 Recommended Venues Nearby — Search Results" }, "usageHint": "h2" } } },
    { "id": "div1", "component": { "Divider": {} } },
    { "id": "place1", "component": { "Text": { "text": { "literalString": "🏢 Palace Hotel Tokyo  ⭐ 4.6" }, "usageHint": "h3" } } },
    { "id": "place1Detail", "component": { "Text": { "text": { "literalString": "📌 Marunouchi 1-1-1, Chiyoda | ☎ 03-3211-5211 — 💰 Budget: ${currencySymbol}30,000+/person | Capacity: up to 200" }, "usageHint": "body" } } },
    { "id": "div2", "component": { "Divider": {} } },
    { "id": "place2", "component": { "Text": { "text": { "literalString": "🏢 Andaz Tokyo  ⭐ 4.5" }, "usageHint": "h3" } } },
    { "id": "place2Detail", "component": { "Text": { "text": { "literalString": "📌 Toranomon 1-23-4, Minato | ☎ 03-6830-1234 — 💰 Budget: ${currencySymbol}25,000+/person | Capacity: up to 150" }, "usageHint": "body" } } },
    { "id": "div3", "component": { "Divider": {} } },
    { "id": "place3", "component": { "Text": { "text": { "literalString": "🏢 Imperial Hotel  ⭐ 4.4" }, "usageHint": "h3" } } },
    { "id": "place3Detail", "component": { "Text": { "text": { "literalString": "📌 Uchisaiwaicho 1-1-1, Chiyoda | ☎ 03-3504-1111 — 💰 Budget: ${currencySymbol}35,000+/person | Capacity: up to 300" }, "usageHint": "body" } } },
    { "id": "div4", "component": { "Divider": {} } },
    { "id": "actionRow", "component": { "Row": { "children": { "explicitList": ["btnBook", "btnCompare"] }, "distribution": "spaceEvenly", "alignment": "center" } } },
    { "id": "btnBook", "component": { "Button": { "child": "lblBook", "action": { "name": "sendText", "context": [{ "key": "text", "value": { "literalString": "Create a detailed event plan at Palace Hotel Tokyo" } }] } } } },
    { "id": "lblBook", "component": { "Text": { "text": { "literalString": "🏢 Plan with #1" }, "usageHint": "body" } } },
    { "id": "btnCompare", "component": { "Button": { "child": "lblCompare", "action": { "name": "sendText", "context": [{ "key": "text", "value": { "literalString": "Create a detailed comparison of the 3 venues" } }] } } } },
    { "id": "lblCompare", "component": { "Text": { "text": { "literalString": "📊 Compare Venues" }, "usageHint": "body" } } }
  ] } }
]
__MAPS_EOF__

cat <<'__TABS_EOF__' > adk_agent/app/examples/0.8/tabbed_comparison.json
[
  { "beginRendering": { "surfaceId": "tabbed-view", "root": "root" } },
  { "surfaceUpdate": { "surfaceId": "tabbed-view", "components": [
    { "id": "root", "component": { "Card": { "child": "mainCol" } } },
    { "id": "mainCol", "component": { "Column": { "children": { "explicitList": ["title", "div1", "tabs", "div2", "actionRow"] }, "distribution": "start", "alignment": "stretch" } } },
    { "id": "title", "component": { "Text": { "text": { "literalString": "📋 Data Update Preview" }, "usageHint": "h2" } } },
    { "id": "div1", "component": { "Divider": {} } },
    { "id": "tabs", "component": { "Tabs": { "tabItems": [
      { "title": { "literalString": "Before" }, "child": "beforeContent" },
      { "title": { "literalString": "After" }, "child": "afterContent" }
    ] } } },
    { "id": "beforeContent", "component": { "Column": { "children": { "explicitList": ["beforeSpacer", "beforeTitle", "beforeRole", "beforeScore"] }, "distribution": "start", "alignment": "stretch" } } },
    { "id": "beforeSpacer", "component": { "Text": { "text": { "literalString": " " }, "usageHint": "body" } } },
    { "id": "beforeTitle", "component": { "Text": { "text": { "literalString": "Name: Kenta Takahashi" }, "usageHint": "body" } } },
    { "id": "beforeRole", "component": { "Text": { "text": { "literalString": "Title: Head of Corporate Planning" }, "usageHint": "body" } } },
    { "id": "beforeScore", "component": { "Text": { "text": { "literalString": "Score: 45" }, "usageHint": "body" } } },
    { "id": "afterContent", "component": { "Column": { "children": { "explicitList": ["afterSpacer", "afterTitle", "afterRole", "afterScore"] }, "distribution": "start", "alignment": "stretch" } } },
    { "id": "afterSpacer", "component": { "Text": { "text": { "literalString": " " }, "usageHint": "body" } } },
    { "id": "afterTitle", "component": { "Text": { "text": { "literalString": "Name: Kenta Takahashi" }, "usageHint": "body" } } },
    { "id": "afterRole", "component": { "Text": { "text": { "literalString": "Title: CFO ✏️" }, "usageHint": "body" } } },
    { "id": "afterScore", "component": { "Text": { "text": { "literalString": "Score: 60 ✏️" }, "usageHint": "body" } } },
    { "id": "div2", "component": { "Divider": {} } },
    { "id": "actionRow", "component": { "Row": { "children": { "explicitList": ["btnApprove", "btnReject"] }, "distribution": "spaceEvenly", "alignment": "center" } } },
    { "id": "btnApprove", "component": { "Button": { "child": "lblApprove", "primary": true, "action": { "name": "sendText", "context": [{ "key": "text", "value": { "literalString": "Approved" } }] } } } },
    { "id": "lblApprove", "component": { "Text": { "text": { "literalString": "✅ Approve & Execute" }, "usageHint": "body" } } },
    { "id": "btnReject", "component": { "Button": { "child": "lblReject", "action": { "name": "sendText", "context": [{ "key": "text", "value": { "literalString": "Rejected" } }] } } } },
    { "id": "lblReject", "component": { "Text": { "text": { "literalString": "❌ Cancel" }, "usageHint": "body" } } }
  ] } }
]
__TABS_EOF__

cat <<'__FORM_EOF__' > adk_agent/app/examples/0.8/interactive_form.json
[
  { "beginRendering": { "surfaceId": "edit-form", "root": "root" } },
  { "dataModelUpdate": { "surfaceId": "edit-form", "path": "/form", "contents": [{ "key": "name", "valueString": "Kenta Takahashi" }, { "key": "dept", "valueString": "Corporate Planning" }, { "key": "faculty", "valueMap": [{ "key": "0", "valueString": "Economics" }] }, { "key": "score", "valueNumber": 45 }, { "key": "contactDate", "valueString": "2024-03-05" }, { "key": "vip", "valueBoolean": false }, { "key": "notes", "valueString": "Key contact for CFO network.\\nSchedule follow-up after Autumn Gala." }] } },
  { "surfaceUpdate": { "surfaceId": "edit-form", "components": [
    { "id": "root", "component": { "Card": { "child": "mainCol" } } },
    { "id": "mainCol", "component": { "Column": { "children": { "explicitList": ["title", "div1", "fieldName", "fieldDept", "choiceFaculty", "sliderScore", "dateContact", "chkVip", "fieldNotes", "div2", "actionRow"] }, "distribution": "start", "alignment": "stretch" } } },
    { "id": "title", "component": { "Text": { "text": { "literalString": "📝 Edit Alumni Record" }, "usageHint": "h2" } } },
    { "id": "div1", "component": { "Divider": {} } },
    { "id": "fieldName", "component": { "TextField": { "label": { "literalString": "Name" }, "text": { "path": "/form/name" }, "textFieldType": "shortText" } } },
    { "id": "fieldDept", "component": { "TextField": { "label": { "literalString": "Department" }, "text": { "path": "/form/dept" }, "textFieldType": "shortText" } } },
    { "id": "choiceFaculty", "component": { "MultipleChoice": { "selections": { "path": "/form/faculty" }, "options": [{ "label": { "literalString": "Economics" }, "value": "Economics" }, { "label": { "literalString": "Engineering" }, "value": "Engineering" }, { "label": { "literalString": "Law" }, "value": "Law" }, { "label": { "literalString": "Medicine" }, "value": "Medicine" }, { "label": { "literalString": "Literature" }, "value": "Literature" }], "maxAllowedSelections": 1, "variant": "chips" } } },
    { "id": "sliderScore", "component": { "Slider": { "label": { "literalString": "Engagement Score" }, "value": { "path": "/form/score" }, "minValue": 0, "maxValue": 100 } } },
    { "id": "dateContact", "component": { "DateTimeInput": { "value": { "path": "/form/contactDate" }, "enableDate": true, "enableTime": false } } },
    { "id": "chkVip", "component": { "CheckBox": { "label": { "literalString": "Register as VIP" }, "value": { "path": "/form/vip" } } } },
    { "id": "fieldNotes", "component": { "TextField": { "label": { "literalString": "Notes" }, "text": { "path": "/form/notes" }, "textFieldType": "longText" } } },
    { "id": "div2", "component": { "Divider": {} } },
    { "id": "actionRow", "component": { "Row": { "children": { "explicitList": ["btnSave", "btnCancel"] }, "distribution": "spaceEvenly", "alignment": "center" } } },
    { "id": "btnSave", "component": { "Button": { "child": "lblSave", "primary": true, "action": { "name": "sendText", "context": [{ "key": "text", "value": { "literalString": "Update the record with the following values:" } }, { "key": "name", "value": { "path": "/form/name" } }, { "key": "dept", "value": { "path": "/form/dept" } }, { "key": "faculty", "value": { "path": "/form/faculty" } }, { "key": "score", "value": { "path": "/form/score" } }, { "key": "contactDate", "value": { "path": "/form/contactDate" } }, { "key": "vip", "value": { "path": "/form/vip" } }, { "key": "notes", "value": { "path": "/form/notes" } }] } } } },
    { "id": "lblSave", "component": { "Text": { "text": { "literalString": "💾 Save" }, "usageHint": "body" } } },
    { "id": "btnCancel", "component": { "Button": { "child": "lblCancel", "action": { "name": "sendText", "context": [{ "key": "text", "value": { "literalString": "Cancel editing" } }] } } } },
    { "id": "lblCancel", "component": { "Text": { "text": { "literalString": "🚫 Cancel" }, "usageHint": "body" } } }
  ] } }
]
__FORM_EOF__

cat <<'__BATCH_EOF__' > adk_agent/app/examples/0.8/batch_editor.json
[
  { "beginRendering": { "surfaceId": "batch-editor", "root": "root" } },
  {
    "dataModelUpdate": {
      "surfaceId": "batch-editor",
      "path": "/form",
      "contents": [
        { "key": "item_0_selected_sku", "valueMap": [{ "key": "0", "valueString": "SKU_A" }] },
        { "key": "item_0_qty", "valueNumber": 2 },
        { "key": "item_1_selected_sku", "valueMap": [{ "key": "0", "valueString": "SKU_B" }] },
        { "key": "item_1_qty", "valueNumber": 5 }
      ]
    }
  },
  {
    "surfaceUpdate": {
      "surfaceId": "batch-editor",
      "components": [
        { "id": "root", "component": { "Card": { "child": "mainCol" } } },
        {
          "id": "mainCol",
          "component": {
            "Column": {
              "children": {
                "explicitList": [
                  "title",
                  "divider1",
                  "companyHeader1",
                  "row_container_0",
                  "dividerRow1",
                  "row_container_1",
                  "divider2",
                  "actionRow"
                ]
              },
              "distribution": "start",
              "alignment": "stretch"
            }
          }
        },
        { "id": "title", "component": { "Text": { "text": { "literalString": "📝 Bulk Mapping & Editing Editor" }, "usageHint": "h2" } } },
        { "id": "divider1", "component": { "Divider": {} } },
        { "id": "companyHeader1", "component": { "Text": { "text": { "literalString": "🏢 Kansai Air Conditioning Services Co., Ltd." }, "usageHint": "h3" } } },
        {
          "id": "row_container_0",
          "component": {
            "Column": {
              "children": {
                "explicitList": ["main_row_0", "reason_text_0"]
              }
            }
          }
        },
        {
          "id": "main_row_0",
          "component": {
            "Row": {
              "children": {
                "explicitList": ["left_stack_0", "sku_select_0", "qty_field_0"]
              },
              "distribution": "spaceBetween",
              "alignment": "center"
            }
          }
        },
        {
          "id": "left_stack_0",
          "component": {
            "Column": {
              "children": {
                "explicitList": ["orig_name_0", "orig_qty_0"]
              },
              "distribution": "start",
              "alignment": "start"
            }
          }
        },
        { "id": "orig_name_0", "component": { "Text": { "text": { "literalString": "エアコン5馬力 (SZRC140BC)" }, "usageHint": "body" } } },
        { "id": "orig_qty_0", "component": { "Text": { "text": { "literalString": "Original Qty: 2" }, "usageHint": "caption" } } },
        {
          "id": "sku_select_0",
          "component": {
            "MultipleChoice": {
              "options": [
                { "value": "SKU_A", "label": { "literalString": "SKU_A (Recommended)" } },
                { "value": "SKU_B", "label": { "literalString": "SKU_B (Alternative)" } }
              ],
              "maxAllowedSelections": 1,
              "variant": "chips",
              "selections": { "path": "/form/item_0_selected_sku" }
            }
          }
        },
        {
          "id": "qty_field_0",
          "component": {
            "TextField": {
              "label": { "literalString": "Qty" },
              "text": { "path": "/form/item_0_qty" },
              "textFieldType": "shortText"
            }
          }
        },
        { "id": "reason_text_0", "component": { "Text": { "text": { "literalString": "💡 Recommended because SKU_A is direct replacement of legacy model" }, "usageHint": "caption" } } },
        { "id": "dividerRow1", "component": { "Divider": {} } },
        {
          "id": "row_container_1",
          "component": {
            "Column": {
              "children": {
                "explicitList": ["main_row_1", "reason_text_1"]
              }
            }
          }
        },
        {
          "id": "main_row_1",
          "component": {
            "Row": {
              "children": {
                "explicitList": ["left_stack_1", "sku_select_1", "qty_field_1"]
              },
              "distribution": "spaceBetween",
              "alignment": "center"
            }
          }
        },
        {
          "id": "left_stack_1",
          "component": {
            "Column": {
              "children": {
                "explicitList": ["orig_name_1", "orig_qty_1"]
              },
              "distribution": "start",
              "alignment": "start"
            }
          }
        },
        { "id": "orig_name_1", "component": { "Text": { "text": { "literalString": "エアコン3馬力 (PROD012)" }, "usageHint": "body" } } },
        { "id": "orig_qty_1", "component": { "Text": { "text": { "literalString": "Original Qty: 4" }, "usageHint": "caption" } } },
        {
          "id": "sku_select_1",
          "component": {
            "MultipleChoice": {
              "options": [
                { "value": "SKU_C", "label": { "literalString": "SKU_C (Recommended)" } },
                { "value": "SKU_D", "label": { "literalString": "SKU_D (Alternative)" } }
              ],
              "maxAllowedSelections": 1,
              "variant": "chips",
              "selections": { "path": "/form/item_1_selected_sku" }
            }
          }
        },
        {
          "id": "qty_field_1",
          "component": {
            "TextField": {
              "label": { "literalString": "Qty" },
              "text": { "path": "/form/item_1_qty" },
              "textFieldType": "shortText"
            }
          }
        },
        { "id": "reason_text_1", "component": { "Text": { "text": { "literalString": "💡 Matches master catalog with 95% confidence" }, "usageHint": "caption" } } },
        { "id": "divider2", "component": { "Divider": {} } },
        {
          "id": "actionRow",
          "component": {
            "Row": {
              "children": {
                "explicitList": ["btnSubmit", "btnCancel"]
              },
              "distribution": "spaceEvenly",
              "alignment": "center"
            }
          }
        },
        {
          "id": "btnSubmit",
          "component": {
            "Button": {
              "child": "lblSubmit",
              "primary": true,
              "action": {
                "name": "sendText",
                "context": [
                  { "key": "text", "value": { "literalString": "Submit proposed changes" } },
                  { "key": "item_0_selected_sku", "value": { "path": "/form/item_0_selected_sku" } },
                  { "key": "item_0_qty", "value": { "path": "/form/item_0_qty" } },
                  { "key": "item_1_selected_sku", "value": { "path": "/form/item_1_selected_sku" } },
                  { "key": "item_1_qty", "value": { "path": "/form/item_1_qty" } }
                ]
              }
            }
          }
        },
        { "id": "lblSubmit", "component": { "Text": { "text": { "literalString": "💾 Save Changes" }, "usageHint": "body" } } },
        {
          "id": "btnCancel",
          "component": {
            "Button": {
              "child": "lblCancel",
              "action": {
                "name": "sendText",
                "context": [
                  { "key": "text", "value": { "literalString": "Cancel editing" } }
                ]
              }
            }
          }
        },
        { "id": "lblCancel", "component": { "Text": { "text": { "literalString": "🚫 Cancel" }, "usageHint": "body" } } }
      ]
    }
  }
]
__BATCH_EOF__

cat <<'__LIST_EOF__' > adk_agent/app/examples/0.8/event_list.json
[
  { "beginRendering": { "surfaceId": "event-list", "root": "root" } },
  { "surfaceUpdate": { "surfaceId": "event-list", "components": [
    { "id": "root", "component": { "Card": { "child": "mainCol" } } },
    { "id": "mainCol", "component": { "Column": { "children": { "explicitList": ["title", "subtitle", "div1", "eventList", "div2", "actionRow"] }, "distribution": "start", "alignment": "stretch" } } },
    { "id": "title", "component": { "Text": { "text": { "literalString": "📅 Event Attendance History" }, "usageHint": "h2" } } },
    { "id": "subtitle", "component": { "Text": { "text": { "literalString": "Kenta Takahashi (ALM-005) — Past 12 Months" }, "usageHint": "caption" } } },
    { "id": "div1", "component": { "Divider": {} } },
    { "id": "eventList", "component": { "List": { "children": { "explicitList": ["ev1", "ev2", "ev3", "ev4"] }, "direction": "vertical", "alignment": "stretch" } } },
    { "id": "ev1", "component": { "Row": { "children": { "explicitList": ["ev1Icon", "ev1Text"] }, "distribution": "start", "alignment": "center" } } },
    { "id": "ev1Icon", "component": { "Icon": { "name": { "literalString": "check" } } } },
    { "id": "ev1Text", "component": { "Text": { "text": { "literalString": "2024/03/05  Global Career Seminar — Attended" }, "usageHint": "body" } } },
    { "id": "ev2", "component": { "Row": { "children": { "explicitList": ["ev2Icon", "ev2Text"] }, "distribution": "start", "alignment": "center" } } },
    { "id": "ev2Icon", "component": { "Icon": { "name": { "literalString": "close" } } } },
    { "id": "ev2Text", "component": { "Text": { "text": { "literalString": "2024/04/10  Spring Gala 2024 — No-Show" }, "usageHint": "body" } } },
    { "id": "ev3", "component": { "Row": { "children": { "explicitList": ["ev3Icon", "ev3Text"] }, "distribution": "start", "alignment": "center" } } },
    { "id": "ev3Icon", "component": { "Icon": { "name": { "literalString": "check" } } } },
    { "id": "ev3Text", "component": { "Text": { "text": { "literalString": "2024/06/15  Alumni Summer Meetup — Attended" }, "usageHint": "body" } } },
    { "id": "ev4", "component": { "Row": { "children": { "explicitList": ["ev4Icon", "ev4Text"] }, "distribution": "start", "alignment": "center" } } },
    { "id": "ev4Icon", "component": { "Icon": { "name": { "literalString": "event" } } } },
    { "id": "ev4Text", "component": { "Text": { "text": { "literalString": "2024/09/20  Autumn Gala 2024 — Invited (Pending)" }, "usageHint": "body" } } },
    { "id": "div2", "component": { "Divider": {} } },
    { "id": "actionRow", "component": { "Row": { "children": { "explicitList": ["btnAll", "btnInvite"] }, "distribution": "spaceEvenly", "alignment": "center" } } },
    { "id": "btnAll", "component": { "Button": { "child": "lblAll", "action": { "name": "sendText", "context": [{ "key": "text", "value": { "literalString": "Show the full event attendance history for Takahashi" } }] } } } },
    { "id": "lblAll", "component": { "Text": { "text": { "literalString": "📋 Show All" }, "usageHint": "body" } } },
    { "id": "btnInvite", "component": { "Button": { "child": "lblInvite", "action": { "name": "sendText", "context": [{ "key": "text", "value": { "literalString": "Draft an RSVP confirmation email for Autumn Gala 2024" } }] } } } },
    { "id": "lblInvite", "component": { "Text": { "text": { "literalString": "✉️ RSVP Email" }, "usageHint": "body" } } }
  ] } }
]
__LIST_EOF__

cat <<'__IMAGE_EOF__' > adk_agent/app/examples/0.8/image_report.json
[
  { "beginRendering": { "surfaceId": "image-report", "root": "root" } },
  { "surfaceUpdate": { "surfaceId": "image-report", "components": [
    { "id": "root", "component": { "Card": { "child": "mainCol" } } },
    { "id": "mainCol", "component": { "Column": { "children": { "explicitList": ["title", "div1", "chartImage", "insight", "div2", "actionRow"] }, "distribution": "start", "alignment": "stretch" } } },
    { "id": "title", "component": { "Text": { "text": { "literalString": "📊 Donation Trend Analysis Report" }, "usageHint": "h2" } } },
    { "id": "div1", "component": { "Divider": {} } },
    { "id": "chartImage", "component": { "Image": { "url": { "literalString": "https://example.com/chart.png" }, "altText": { "literalString": "2020-2024 Donation Trends by Faculty" }, "fit": "contain" } } },
    { "id": "insight", "component": { "Text": { "text": { "literalString": "💡 Engineering donations up +23% YoY. Economics down -8%. Engagement strategy review recommended." }, "usageHint": "body" } } },
    { "id": "div2", "component": { "Divider": {} } },
    { "id": "actionRow", "component": { "Row": { "children": { "explicitList": ["btnDetail", "btnExport"] }, "distribution": "spaceEvenly", "alignment": "center" } } },
    { "id": "btnDetail", "component": { "Button": { "child": "lblDetail", "action": { "name": "sendText", "context": [{ "key": "text", "value": { "literalString": "Analyze the root cause of declining donations in the Economics faculty" } }] } } } },
    { "id": "lblDetail", "component": { "Text": { "text": { "literalString": "📉 Root Cause" }, "usageHint": "body" } } },
    { "id": "btnExport", "component": { "Button": { "child": "lblExport", "action": { "name": "sendText", "context": [{ "key": "text", "value": { "literalString": "Summarize this analysis report in PDF format" } }] } } } },
    { "id": "lblExport", "component": { "Text": { "text": { "literalString": "📄 Export Report" }, "usageHint": "body" } } }
  ] } }
]
__IMAGE_EOF__

cat <<'__MODAL_EOF__' > adk_agent/app/examples/0.8/detail_modal.json
[
  { "beginRendering": { "surfaceId": "modal-detail", "root": "root" } },
  { "surfaceUpdate": { "surfaceId": "modal-detail", "components": [
    { "id": "root", "component": { "Card": { "child": "mainCol" } } },
    { "id": "mainCol", "component": { "Column": { "children": { "explicitList": ["title", "div1", "kpiRow", "div2", "modal", "div3", "actionRow"] }, "distribution": "start", "alignment": "stretch" } } },
    { "id": "title", "component": { "Text": { "text": { "literalString": "📊 Kenta Takahashi Summary" }, "usageHint": "h2" } } },
    { "id": "div1", "component": { "Divider": {} } },
    { "id": "kpiRow", "component": { "Row": { "children": { "explicitList": ["kpi1", "kpi2", "kpi3"] }, "distribution": "spaceEvenly", "alignment": "center" } } },
    { "id": "kpi1", "component": { "Column": { "children": { "explicitList": ["kpi1Val", "kpi1Lbl"] }, "distribution": "start", "alignment": "center" } } },
    { "id": "kpi1Val", "component": { "Text": { "text": { "literalString": "45" }, "usageHint": "h2" } } },
    { "id": "kpi1Lbl", "component": { "Text": { "text": { "literalString": "Score" }, "usageHint": "caption" } } },
    { "id": "kpi2", "component": { "Column": { "children": { "explicitList": ["kpi2Val", "kpi2Lbl"] }, "distribution": "start", "alignment": "center" } } },
    { "id": "kpi2Val", "component": { "Text": { "text": { "literalString": "${currencySymbol}50K" }, "usageHint": "h2" } } },
    { "id": "kpi2Lbl", "component": { "Text": { "text": { "literalString": "Lifetime Donations" }, "usageHint": "caption" } } },
    { "id": "kpi3", "component": { "Column": { "children": { "explicitList": ["kpi3Val", "kpi3Lbl"] }, "distribution": "start", "alignment": "center" } } },
    { "id": "kpi3Val", "component": { "Text": { "text": { "literalString": "3x" }, "usageHint": "h2" } } },
    { "id": "kpi3Lbl", "component": { "Text": { "text": { "literalString": "Attendance" }, "usageHint": "caption" } } },
    { "id": "div2", "component": { "Divider": {} } },
    { "id": "modal", "component": { "Modal": { "entryPointChild": "modalBtn", "contentChild": "modalContent" } } },
    { "id": "modalBtn", "component": { "Button": { "child": "modalBtnLbl", "action": { "name": "sendText", "context": [{ "key": "text", "value": { "literalString": "" } }] } } } },
    { "id": "modalBtnLbl", "component": { "Text": { "text": { "literalString": "📋 View Full Profile" }, "usageHint": "body" } } },
    { "id": "modalContent", "component": { "Column": { "children": { "explicitList": ["detailTitle", "detailDiv1", "detailInfo", "detailDiv2", "detailHistory", "detailDiv3", "detailEvents"] }, "distribution": "start", "alignment": "stretch" } } },
    { "id": "detailTitle", "component": { "Text": { "text": { "literalString": "Kenta Takahashi — Full Profile" }, "usageHint": "h2" } } },
    { "id": "detailDiv1", "component": { "Divider": {} } },
    { "id": "detailInfo", "component": { "Text": { "text": { "literalString": "🏢 Mitsubishi UFJ Bank CFO — 🎓 Class of 2000, Economics — 📧 k.takahashi@example.com — 📞 090-XXXX-XXXX" }, "usageHint": "body" } } },
    { "id": "detailDiv2", "component": { "Divider": {} } },
    { "id": "detailHistory", "component": { "Text": { "text": { "literalString": "💰 Donation History: — 2021: ${currencySymbol}10,000 — 2022: ${currencySymbol}15,000 — 2023: ${currencySymbol}25,000 — Total: ${currencySymbol}50,000" }, "usageHint": "body" } } },
    { "id": "detailDiv3", "component": { "Divider": {} } },
    { "id": "detailEvents", "component": { "Text": { "text": { "literalString": "📅 Event Attendance: 75% (3/4) — ✅ Career Seminar, Alumni Meetup, Lecture — ❌ Spring Gala 2024" }, "usageHint": "body" } } },
    { "id": "div3", "component": { "Divider": {} } },
    { "id": "actionRow", "component": { "Row": { "children": { "explicitList": ["btnApproach", "btnEdit"] }, "distribution": "spaceEvenly", "alignment": "center" } } },
    { "id": "btnApproach", "component": { "Button": { "child": "lblApproach", "primary": true, "action": { "name": "sendText", "context": [{ "key": "text", "value": { "literalString": "Suggest an engagement strategy for Takahashi" } }] } } } },
    { "id": "lblApproach", "component": { "Text": { "text": { "literalString": "🎯 Engagement Strategy" }, "usageHint": "body" } } },
    { "id": "btnEdit", "component": { "Button": { "child": "lblEdit", "action": { "name": "sendText", "context": [{ "key": "text", "value": { "literalString": "I want to edit Takahashi's record" } }] } } } },
    { "id": "lblEdit", "component": { "Text": { "text": { "literalString": "✏️ Edit Record" }, "usageHint": "body" } } }
  ] } }
]
__MODAL_EOF__

cat <<'__DELETE_SURFACE_EOF__' > adk_agent/app/examples/0.8/delete_surface_example.json
[
  { "deleteSurface": { "surfaceId": "confirmation-surface" } }
]
__DELETE_SURFACE_EOF__

cat <<'__CHIPS_EOF__' > adk_agent/app/examples/0.8/suggestion_chips.json
[
  { "beginRendering": { "surfaceId": "suggestions", "root": "root" } },
  { "surfaceUpdate": { "surfaceId": "suggestions", "components": [
    { "id": "root", "component": { "Row": { "children": { "explicitList": ["chip1", "chip2", "chip3"] }, "distribution": "spaceEvenly", "alignment": "center" } } },
    { "id": "chip1", "component": { "Button": { "child": "chip1Lbl", "action": { "name": "sendText", "context": [{ "key": "text", "value": { "literalString": "Show the donation ranking" } }] } } } },
    { "id": "chip1Lbl", "component": { "Text": { "text": { "literalString": "📊 Donation Ranking" }, "usageHint": "body" } } },
    { "id": "chip2", "component": { "Button": { "child": "chip2Lbl", "action": { "name": "sendText", "context": [{ "key": "text", "value": { "literalString": "Analyze alumni with low engagement scores" } }] } } } },
    { "id": "chip2Lbl", "component": { "Text": { "text": { "literalString": "📉 Low Score Analysis" }, "usageHint": "body" } } },
    { "id": "chip3", "component": { "Button": { "child": "chip3Lbl", "action": { "name": "sendText", "context": [{ "key": "text", "value": { "literalString": "Suggest the next event plan" } }] } } } },
    { "id": "chip3Lbl", "component": { "Text": { "text": { "literalString": "📅 Event Proposal" }, "usageHint": "body" } } }
  ] } }
]
__CHIPS_EOF__

cat <<'__AGENT_EOF__' > adk_agent/app/agent.py
import os
import dotenv

# =============================================================================
# Environment Configuration
# Load environment variables from .env file
# =============================================================================
dotenv.load_dotenv(override=True)

# =============================================================================
# ADK Runtime Cycle-Breaking Monkey-Patch for the Deployed Container
# Prevents RecursionError when parsing complex Firestore schemas in Vertex AI
# =============================================================================
import google.adk.tools._gemini_schema_util

def _safe_dereference_schema(schema: dict) -> dict:
    defs = schema.get("$defs", {})
    _memo = {}  # Memoization cache: ref_key -> resolved schema

    def _resolve_json_pointer(ref_path, root):
        """Resolve a JSON Pointer (e.g., '#/anyOf/0/properties/foo') against root schema."""
        if not ref_path.startswith("#/"):
            return None
        parts = ref_path[2:].split("/")
        current = root
        for part in parts:
            if isinstance(current, dict) and part in current:
                current = current[part]
            elif isinstance(current, list):
                try:
                    current = current[int(part)]
                except (ValueError, IndexError):
                    return None
            else:
                return None
        return current if isinstance(current, dict) else None

    def _resolve_refs(sub_schema, ancestors=None):
        if ancestors is None:
            ancestors = frozenset()
        if isinstance(sub_schema, dict):
            if "$ref" in sub_schema:
                ref_path = sub_schema["$ref"]
                ref_key = ref_path.split("/")[-1]
                # Try $defs lookup first (most common case)
                if ref_key in defs:
                    if ref_key in ancestors:
                        return {"type": "object"}  # Break cycle
                    if ref_key in _memo:
                        return _memo[ref_key]  # Return cached result
                    new_ancestors = ancestors | {ref_key}
                    resolved = defs[ref_key].copy()
                    sub_copy = sub_schema.copy()
                    del sub_copy["$ref"]
                    resolved.update(sub_copy)
                    result = _resolve_refs(resolved, new_ancestors)
                    _memo[ref_key] = result
                    return result
                # Fallback: resolve arbitrary JSON Pointer against root schema
                resolved = _resolve_json_pointer(ref_path, schema)
                if resolved is not None:
                    cache_key = ref_path
                    if cache_key in _memo:
                        return _memo[cache_key]
                    if cache_key in ancestors:
                        return {"type": "object"}
                    new_ancestors = ancestors | {cache_key}
                    resolved_copy = resolved.copy()
                    sub_copy = sub_schema.copy()
                    del sub_copy["$ref"]
                    resolved_copy.update(sub_copy)
                    result = _resolve_refs(resolved_copy, new_ancestors)
                    _memo[cache_key] = result
                    return result
                # Cannot resolve — return a safe fallback
                return {"type": "object"}
            return {k: _resolve_refs(v, ancestors) for k, v in sub_schema.items()}
        elif isinstance(sub_schema, list):
            return [_resolve_refs(item, ancestors) for item in sub_schema]
        return sub_schema

    def _ensure_types(node):
        """Walk schema tree and inject 'type' where missing.
        
        Gemini API rejects functionDeclarations when any property schema
        lacks an explicit 'type' field. This handles:
        - Empty schemas {} within properties
        - Schemas with description/enum/items but no type
        - anyOf/oneOf (unsupported by Gemini) — flatten to first variant
        """
        if not isinstance(node, dict):
            return node
        # Flatten anyOf/oneOf to first non-null variant (Gemini doesn't support these)
        for key in ("anyOf", "oneOf"):
            if key in node and isinstance(node[key], list):
                variants = [v for v in node[key] if isinstance(v, dict) and v.get("type") != "null"]
                if variants:
                    chosen = variants[0].copy()
                    del node[key]
                    # Preserve description from parent
                    if "description" in node:
                        chosen.setdefault("description", node["description"])
                    node.update(chosen)
                elif node[key]:
                    del node[key]
                    node.setdefault("type", "string")
        # Process children recursively
        for k, v in list(node.items()):
            if isinstance(v, dict):
                node[k] = _ensure_types(v)
            elif isinstance(v, list):
                node[k] = [_ensure_types(i) if isinstance(i, dict) else i for i in v]
        # Ensure every property in 'properties' is a valid schema dict
        if "properties" in node and isinstance(node["properties"], dict):
            for prop_name, prop_schema in list(node["properties"].items()):
                if isinstance(prop_schema, str):
                    # Convert shorthand "string" -> {"type": "string"}
                    node["properties"][prop_name] = {"type": prop_schema}
                elif isinstance(prop_schema, list):
                    # Convert list shorthand -> {"type": "string"}
                    node["properties"][prop_name] = {"type": "string"}
                elif isinstance(prop_schema, dict) and "type" not in prop_schema:
                    prop_schema["type"] = "string"  # Safe default
        # Infer type for the current node if missing
        if "type" not in node:
            if "properties" in node:
                node["type"] = "object"
            elif "items" in node:
                node["type"] = "array"
            elif "enum" in node:
                node["type"] = "string"
            elif any(k in node for k in ("description", "default", "title")):
                node["type"] = "string"
        return node

    deref = _resolve_refs(schema)
    if "$defs" in deref:
        del deref["$defs"]
    deref = _ensure_types(deref)
    return deref

google.adk.tools._gemini_schema_util._dereference_schema = _safe_dereference_schema

from . import tools
from google.adk.agents import LlmAgent
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.models import Gemini
from google.genai import types
from google.adk.code_executors.agent_engine_sandbox_code_executor import AgentEngineSandboxCodeExecutor
from google.adk.agents import callback_context as adk_callback_context
from google.adk.models import llm_response as adk_llm_response
from google.adk.apps.app import App, EventsCompactionConfig
from google.adk.agents.context_cache_config import ContextCacheConfig
from google.adk.plugins import ReflectAndRetryToolPlugin, LoggingPlugin
from a2ui.schema.constants import VERSION_0_8
from a2ui.schema.manager import A2uiSchemaManager
from a2ui.basic_catalog.provider import BasicCatalog

PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT")

maps_toolset = tools.get_maps_mcp_toolset()
bigquery_toolset = tools.get_bigquery_mcp_toolset()
firestore_toolset = tools.get_firestore_mcp_toolset()
custom_mcp_toolsets = tools.get_custom_mcp_toolsets()
${ (params.importedMcpList || []).some(m => m.type === 'remote' && m.auth_type === 'oauth2_slack') ? `slack_mcp_toolset = tools.get_slack_mcp_toolset()` : `slack_mcp_toolset = None` }


# =============================================================================
# AGENT CONFIGURATION (Zero-Formatting Instruction Pattern)
# =============================================================================
# We intentionally avoid Python f-strings or .format() here to prevent crashes
# when the generated System Instruction contains literal curly braces {}.
# =============================================================================

base_instruction = """
You are an autonomous business operations agent. Your mission is DUAL:
(A) ANALYZE: Answer questions by strategically combining insights from BigQuery, Google Maps, and operational databases.
(B) EXECUTE: Carry out multi-step operational workflows — scan for actionable items, apply business rules, update records, and report results.
When the user gives a task, determine whether it is an ANALYSIS request or an EXECUTION request (or both), and act accordingly.

--- GREETING & ONBOARDING UI GUARDRAIL (MANDATORY) ---
When the user sends an initial greeting or open-ended first message (e.g., 'Hi', 'Hello', 'Hi there'), you **MUST NOT** call any tools, databases, or BigQuery under any circumstances. Performing queries on the first turn completely hides and breaks the onboarding welcome card rendering. You MUST immediately respond in the very first turn with the rich A2UI onboarding welcome card (using surfaceId 'welcome-card') and NO suggestion chips at the bottom (the card's own buttons are sufficient). Focus ONLY on welcome onboarding. Never perform background queries or tool calls until the user explicitly requests analysis or clicks a button.

--- WORKFLOW EXECUTION MODE (CRITICAL) ---
When the user requests an operational action (e.g., "process all pending items", "resolve flagged anomalies",
"update all expired records", "run the reconciliation workflow"), you MUST follow this execution pattern:

SINGLE TASK RULE (CRITICAL — NO DUPLICATES):
When executing a workflow via background mode, you MUST call register_background_task
EXACTLY ONCE for the entire workflow. The single task_prompt MUST contain the complete
dependency chain (all steps from SCAN through AUDIT). Do NOT register separate tasks
for individual steps, and do NOT register a second task from a different routing path
(such as Background-First Routing or Proactive Suggestion). One user workflow request
= exactly one register_background_task call. If you have already called
register_background_task for this workflow, do NOT call it again under any circumstance.

MULTI-STEP DEPENDENT WORKFLOW ARCHITECTURE:
Workflows are NOT simple data updates. They are PIPELINES of interdependent steps
where each step's OUTPUT becomes the next step's INPUT. You MUST:
- Design workflows as explicit step chains with data dependencies
- Show intermediate results between steps to the user
- Handle partial failures (mark failed step, report what succeeded, continue or stop)
- Model workflows as BUSINESS PROCESSES: each step maps to a real organizational
  function (data collection, risk assessment, decision making, execution, audit)
- ANALYSIS DEPTH at CLASSIFY step: do NOT use simple threshold checks alone.
  Cross-reference multiple data dimensions, calculate composite scores, and
  explain the classification logic in plain language so stakeholders can verify

STANDARD DEPENDENCY CHAIN (adapt steps to the actual task):
Step 1: SCAN (no dependency) — Query data source, identify ALL items matching criteria
  Output: item_count, item_list, category_breakdown
Step 2: CLASSIFY (depends on SCAN output) — Deep analysis with multi-perspective evaluation:
  a. Apply business rules to assign priority/risk level
  b. Cross-reference with related data sources (e.g., historical trends, reference tables)
  c. Calculate composite risk/priority scores using multiple dimensions
  d. Explain classification rationale for non-obvious decisions
  Output: auto_processable_items, manual_review_items, risk_categories, classification_rationale
Step 3: PROCESS (depends on CLASSIFY output) — Execute auto-processable items sequentially
  Output: success_count, failure_count, processed_item_details
Step 4: ESCALATE (depends on PROCESS remainder) — Present items needing human approval
  For each escalated item: explain WHY it was escalated and recommend a specific action
  Output: escalation_list with per-item rationale and recommended_action
Step 5: NOTIFY (depends on PROCESS + ESCALATE results) — Draft notification/report with results
  Output: draft_text (mark as [MANUAL — Draft Only] per Action Honesty rules)
Step 6: REPORT (depends on ALL prior steps) — Generate comprehensive execution summary:
  a. Executive summary with key business metrics (before/after comparison)
  b. Detailed per-item action log with timestamps
  c. Statistical analysis of changes (distributions, outliers, trends)
  d. Recommendations for follow-up actions or process improvements
  Output: structured_report with business_metrics, action_log, statistical_summary, recommendations
  (audit trail is logged automatically by the system — do NOT write to any audit or activity_log table)

EXECUTION MODE SELECTION (MANDATORY):
After presenting the Workflow Execution Plan (A2UI Pattern I), you MUST ask the user
to choose an execution mode by presenting 3 suggestion chip buttons:

A. Immediate/Synchronous — For small-scope workflows (10 items or fewer).
   Execute all steps in the current conversation. Show real-time progress via
   A2UI Workflow Execution Plan card updates (change step icons from hourglass_empty
   to check_circle as each completes).

B. Background/Async — For large-scope workflows (more than 10 items) or
   workflows that may take more than 30 seconds. Use register_background_task
   to submit the complete workflow as a background job. Include the FULL
   dependency chain definition in the task_prompt so the background agent
   can execute all steps autonomously.
   When executing in background mode, call update_task_progress after completing
   each major step to report real-time progress (current_step, progress_pct,
   log_entry). This allows users to monitor via get_task_result.

C. Scheduled/Recurring — For monitoring or periodic workflows. Use
   register_scheduled_task with a cron expression. Suggest an appropriate
   schedule based on the business context (e.g., weekday mornings for
   operational checks, hourly for critical monitoring).

1. SCAN: Query the relevant data source to identify ALL items matching the criteria. Present a summary count.
2. PLAN: Present a Workflow Execution Plan card (A2UI Pattern I) showing:
   - Total items found and breakdown by category/severity
   - Each execution step with status indicators and dependencies
   - Which steps are auto-executed vs. require approval
   - Estimated scope of changes
   - Execution mode selection buttons (Immediate / Background / Scheduled)
   Then wait for the user to choose the execution mode.
3. EXECUTE: Based on the selected mode, process the dependency chain:
   - LOW-RISK actions (status updates, log entries, routine corrections within tolerance): Execute autonomously WITHOUT asking per-item confirmation. Show progress.
   - HIGH-RISK actions (deletes, large value changes, policy overrides): Present a confirmation card per item or per batch.
4. PROGRESS: Update the Workflow Progress card to show real-time step completion.
   For each completed step, show: step name, items processed, intermediate results.
5. REPORT: Generate a comprehensive Execution Summary showing:
   - Total items processed / auto-resolved / escalated / failed
   - Specific actions taken per item (brief)
   - Exceptions or items requiring follow-up
   - Timeline of actions with timestamps
   The summary MUST be a rich interactive card, not plain text.

AUTONOMOUS DECISION MAKING: When your instructions define clear business rules
(e.g., "if discrepancy < 5%, auto-approve"), you MUST apply them without asking
the user for each item. Only escalate when the rules say to or when the situation
falls outside defined thresholds.

PROACTIVE ACTION PROPOSAL (CRITICAL — DIFFERENTIATOR):
After completing ANY analysis or data retrieval, you MUST proactively propose
concrete workflow actions you can execute automatically on the user's behalf.
Do NOT wait for the user to ask — actively suggest what you can do next.
Examples of proactive proposals:
- After finding anomalies: "I detected 12 anomalies. Shall I auto-process the 8 items within tolerance and escalate the remaining 4?"
- After a data overview: "There are 5 items with PENDING status. I can start a batch execution workflow for you."
- After a comparison: "I found 3 mismatches. I can run a remediation workflow to correct them automatically."
- After any query result: "I can automatically execute [specific action] on these records. Shall I show you the execution plan?"
Your default stance is: "I can do this for you automatically" — not "Here is the data, what would you like to do?"
Always frame your proposals with specific counts, scope, and what will happen automatically vs. what needs approval.

PROACTIVE MONITORING: When the user asks you to "monitor" or "watch" a condition,
suggest using register_scheduled_task to create a recurring check. Define the check
logic clearly so your background instance can execute the full workflow autonomously.

ACTION HONESTY (CRITICAL — ANTI-HALLUCINATION):
You MUST NEVER claim to have performed an action that you do not have a tool for.
Specifically:
- You CANNOT send emails, Slack messages, or any notifications. You DO NOT have email or messaging tools.
- You CANNOT make external API calls other than through the tools explicitly listed above (BigQuery, Maps, Firestore, generate_image).
- When a workflow step involves notification (e.g., "notify the manager"), you MUST clearly state:
  "I have DRAFTED a notification/email below, but I cannot send it automatically. Please copy and send it manually, or forward it through your organization's communication channel."
- In the workflow plan card, label notification steps as '[MANUAL — Draft Only]' instead of '[AUTO]'.
- NEVER say "email sent", "notification delivered", or similar claims.
  Instead say "I have drafted the notification below. Please copy and send it manually."
--- END WORKFLOW EXECUTION MODE ---

Help the user answer questions by strategically combining insights from BigQuery and Google Maps:

1. **BigQuery Toolset**: Access and modify data in the [PROJECT_ID].[DATASET_ID] dataset.
   - **NAMING RULE (CRITICAL)**: When referring to BigQuery in your responses to the user, you MUST ALWAYS use the format "Analytical warehouse (BigQuery)". NEVER use the bare product name "BigQuery" alone.
   - Available Tools: \\\`execute_sql\\\`, \\\`list_table_ids\\\`, \\\`get_table_info\\\`, \\\`list_dataset_ids\\\`, \\\`get_dataset_info\\\`.
   - **FULL DML SUPPORT**: The \\\`execute_sql\\\` tool supports SELECT, INSERT, UPDATE, DELETE, and MERGE statements. You can both read and write data in BigQuery.
   - **BIGQUERY WRITE CONFIRMATION (CRITICAL)**: Whenever a user asks to INSERT, UPDATE, DELETE, or MERGE data in BigQuery, you MUST follow the same confirmation workflow as Firestore: present a confirmation card with A2UI \u003ca2ui-json\u003e tags showing the proposed SQL statement and affected data, then wait for explicit user approval before executing.
   - DATASET ISOLATION (CRITICAL): You MUST ONLY access the \\\`[DATASET_ID]\\\` dataset. DO NOT use \\\`list_dataset_ids\\\` to discover other datasets. DO NOT query any dataset other than \\\`[DATASET_ID]\\\` (except public datasets when explicitly instructed). If a user asks about data not in \\\`[DATASET_ID]\\\`, inform them that only this dataset is available for this demo.
[PUBLIC_DATASET_INFO]

[GENERATED_SYSTEM_INSTRUCTION]

- REFERENCE DATE: The current date for this demo is [REFERENCE_DATE]. Use this for absolute time references (e.g., 'today', 'last month').

2. **Maps Toolset**: Real-world location analysis.
   - Available Tools: \\\`compute_routes\\\`, \\\`get_place\\\`, \\\`search_places\\\`, \\\`geocode\\\`, \\\`reverse_geocode\\\`.
   - IMPORTANT: There is NO weather tool. Do not hallucinate or attempt to use weather services.

3. **Firestore Toolset**: Read and update live operational status.
   - **NAMING RULE (CRITICAL)**: When referring to Firestore in your responses to the user, you MUST ALWAYS use the format "Operational database (Firestore)". NEVER use the bare product name "Firestore" alone.
   - FIRESTORE ISOLATION (CRITICAL): You MUST ONLY access the \\\`[COLLECTION_ID]\\\` collection. DO NOT read or write to any other collection. If a user asks to access data in another collection, inform them that only this collection is available for this demo.
   - FIRESTORE MCP PATH FORMAT (CRITICAL - MUST FOLLOW EXACTLY):
     * For \\\`list_documents\\\`: Set \\\`parent\\\` to \\\`projects/[PROJECT_ID]/databases/(default)/documents\\\` and \\\`collection_id\\\` to \\\`[COLLECTION_ID]\\\`. NEVER append the collection name to the parent path.
     * For \\\`get_document\\\`: Set \\\`name\\\` to \\\`projects/[PROJECT_ID]/databases/(default)/documents/[COLLECTION_ID]/<document_id>\\\`.
     * For \\\`add_document\\\`: Set \\\`parent\\\` to \\\`projects/[PROJECT_ID]/databases/(default)/documents\\\` and \\\`collection_id\\\` to \\\`[COLLECTION_ID]\\\`.
     * For \\\`update_document\\\` / \\\`delete_document\\\`: Set \\\`name\\\` to \\\`projects/[PROJECT_ID]/databases/(default)/documents/[COLLECTION_ID]/<document_id>\\\`.
     * For \\\`list_collections\\\`: Set \\\`parent\\\` to \\\`projects/[PROJECT_ID]/databases/(default)/documents\\\`.
     * WRONG example: \\\`parent: "projects/.../documents/[COLLECTION_ID]"\\\` (this treats the collection name as a document and causes "lacks / at index" errors).
     * RIGHT example: \\\`parent: "projects/.../documents", collection_id: "[COLLECTION_ID]"\\\`.
   - FIRESTORE ERROR RECOVERY: If a Firestore tool call returns an error:
     * NEVER use \\\`list_collections\\\` as it returns massive project-wide metadata that will bloat your context and cause MALFORMED_FUNCTION_CALL. The only valid collection is \\\`[COLLECTION_ID]\\\`.
     * Check if the error mentions "lacks /" — this means you incorrectly appended collection_id to parent. Separate them.
     * If \\\`list_documents\\\` fails, try \\\`get_document\\\` with a known document ID instead.
     * After 2 failed attempts with the SAME error, STOP retrying that approach and inform the user of the specific error.
   - FIRESTORE SCHEMA AWARENESS (CRITICAL): Before adding or updating any document in Firestore, you MUST first query existing documents (e.g. using \\\`list_documents\\\` or \\\`get_document\\\`) to explicitly inspect the active data schema, field names, and data types!
   - SCHEMA CONSISTENCY: You MUST write updates back to the collection in a completely consistent fashion using the EXACT field structures you discovered. Do not hallucinate new fields!
   - FIRESTORE VALUE TYPE FORMAT (CRITICAL - PREVENTS ERRORS):
      * The Firestore REST API requires TYPED values in the \\\`fields\\\` object. NEVER send null, None, or empty typed wrappers.
      * String fields: \\\`"fieldName": {"stringValue": "text"}\\\`
      * Number fields: \\\`"fieldName": {"integerValue": "123"}\\\` or \\\`"fieldName": {"doubleValue": 1.5}\\\`
      * Boolean fields: \\\`"fieldName": {"booleanValue": true}\\\`
      * Map/object fields: \\\`"fieldName": {"mapValue": {"fields": {"key1": {"stringValue": "val1"}}}}\\\`. The \\\`mapValue\\\` MUST contain a \\\`fields\\\` object, NEVER null or empty.
      * Array fields: \\\`"fieldName": {"arrayValue": {"values": [{"stringValue": "item1"}]}}\\\`. The \\\`arrayValue\\\` MUST contain a \\\`values\\\` array, NEVER null or empty. For empty arrays use \\\`{"arrayValue": {"values": []}}\\\`.
      * WRONG: \\\`{"mapValue": null}\\\` or \\\`{"arrayValue": null}\\\` -- causes 'Cannot convert firestore.v1.Value with type unset' error.
      * WRONG: \\\`{"mapValue": {}}\\\` without a \\\`fields\\\` key.
      * If you need to REMOVE a field, omit it from \\\`fields\\\` and add the field name to \\\`updateMask.fieldPaths\\\`.
      * ALWAYS copy the exact Value type structure from the \\\`get_document\\\` response when updating. Do not simplify or restructure the types.

${ (params.importedMcpList && params.importedMcpList.length > 0) ? params.importedMcpList.map((mcp, idx) => {
  if (mcp.type === 'remote') {
    return `
${4 + idx}. **Slack MCP Toolset**: Search channels & messages, send messages, manage canvases, and access user profiles.
   - Available Tools: Dynamically discovered at runtime from Slack MCP Server.
   - Use this toolset for queries about Slack messages, channels, users, and canvases.`;
  }
  const rn = mcp.github_url.split('/').pop().replace(/\.git$/, '');
  return `
${4 + idx}. **Custom MCP Toolset #${idx + 1} (${rn})**: Access data in the custom MCP server.
   - Available Tools: Dynamically discovered at runtime.
   - Use this toolset for queries that require access to external systems, if configured.`;
}).join('') : '' }
${ enableWorkspaceMcp ? `
* **Workspace MCP Toolset**: Access Google Workspace data (Gmail, Drive, Calendar, Chat, People).
   - Available Tools: Dynamically discovered at runtime.
   - Use this toolset for queries that require accessing or creating emails, files, calendar events, or chat messages.
` : '' }
---------------------------------------------------
CRITICAL OPERATIONAL RULES:
- A2UI_MANDATORY_OUTPUT (HIGHEST PRIORITY — NEVER SKIP):
    * EVERY response that contains an analysis result, data summary, ranking, comparison, entity profile, action plan, OR a confirmation request MUST use A2UI interactive cards wrapped in <a2ui-json> tags. Plain text output for these scenarios is FORBIDDEN and constitutes a system failure.
    * For database updates in BigQuery or Firestore (insert/update/delete/merge): You MUST present a confirmation card with <a2ui-json> tags showing before/after data and approve/reject Buttons. NEVER ask for confirmation in plain text.
    * At the END of EVERY response, you MUST append suggestion chips in a separate <a2ui-json> block with surfaceId "suggestions" containing 3-4 contextual follow-up Buttons. NEVER write any plain text or markdown headers (like "Next Actions", "💡 Next Actions", or other localized header equivalent) before the suggestions block; the system will automatically render the appropriate header. NEVER nest components inside a Button's 'child' property; 'child' MUST always be a flat string pointing to the ID of a separately defined Text component.
    * If you are unsure whether to use A2UI, USE IT. The cost of missing an A2UI card is far greater than providing one unnecessarily.
    * CONTEXT-AWARE ELEMENT SELECTION (CRITICAL): Choose the most appropriate A2UI element for each piece of content. Refer to the A2UI schema examples provided in your system prompt. General guidelines:
      - Tabular data (query results, comparisons, rankings): Use DataTable or structured cards with rows and columns. Never dump raw text tables.
      - Entity profiles (person, product, location details): Use InfoCard with key-value pairs, images where available, and action buttons.
      - Status or progress updates: Use StatusTracker or progress indicators.
      - Lists of items or options: Use ordered/unordered List components or selectable card grids.
      - Confirmations and approvals: Use cards with clear approve/reject Buttons showing the proposed change.
      - Recommendations or action plans: Use numbered step cards or prioritized lists with visual hierarchy.
      - Greetings and self-introductions: Use a welcoming card that lists capabilities with icons and example queries as clickable Buttons.
      - Error states: Use alert-style cards with clear error descriptions and suggested recovery actions as Buttons.
    * RICHNESS OVER MINIMALISM: When in doubt, use MORE A2UI elements, not fewer. A response with well-structured cards, buttons, and visual hierarchy is always preferred over plain text. Combine multiple A2UI blocks in a single response when the content warrants it (e.g., a DataTable for results + an InfoCard for a highlight + suggestion Buttons).
- LANGUAGE & TONE (CRITICAL):
    * You MUST always respond in the same language the user is using for interaction. If the user writes in English, your response (conversational text, analysis report, etc.) MUST be strictly in English. If in Japanese, respond in Japanese.
    * NEVER mix languages or use Japanese phrases/words when the conversation is in English.
    * This language rule applies universally to ALL agents (coordinator and deep analysis specialist) at all times, without exception.

- VISUAL ASSETS & IMAGES:
    * Your output MUST NOT contain any inline images.
    * You are forbidden from using Markdown's ![alt text](url) syntax.
    * If you need to reference an image from tools or guidelines, describe it textually and provide the viewing link as a standard hyperlink.
    * Correct Usage: The official logo is a green apple. Data from: [Cymbal Brand Guidelines](https://storage.googleapis.com/...)
    * Incorrect Usage: ![Cymbal Logo](https://storage.googleapis.com/...)
    * TURN SPLITTING FOR ANALYSIS & IMAGES (CRITICAL): When requested to perform an analysis AND generate a visual asset (like an infographic or chart via \\\`generate_image\\\` tool):
        1. In the first turn, you MUST provide the full, comprehensive text analysis in your response *along with* the tool call to \\\`generate_image\\\`. Do NOT wait for the tool to complete to provide the main analysis text.
        2. In the follow-up turn (after the tool returns success), provide only a brief confirmation (e.g., "Here is the generated visualization.") and let the system automatically attach the image.
    * LANGUAGE CONSISTENCY FOR IMAGES (CRITICAL): When calling \\\`generate_image\\\`, you MUST write the ENTIRE prompt in the same language the user is using for interaction. If the user communicates in Japanese, the prompt — including slide titles, labels, KPI names, bullet points, chart axis labels, and all descriptive text — MUST be written in Japanese. Do NOT write the prompt in English when the user is speaking another language. The image generation model renders text exactly as provided in the prompt, so English prompts produce English slides regardless of the user's language.
    * RE-GENERATION & RETRY (CRITICAL): If the user asks to "try again", "regenerate the image", "fix the text on the slide", or otherwise indicates the generated visual needs correction, you MUST call the \\\`generate_image\\\` tool again with an updated prompt (incorporating the user's feedback or correcting the issue). NEVER try to output a JSON reference to the image or assume the previous image is still attached. You MUST trigger a new \\\`generate_image\\\` tool call.
    * NO RAW IMAGE JSON (CRITICAL): Never output raw JSON blocks for images or A2UI components directly in your conversational text. All A2UI UI components MUST be valid, fully-formed A2UI JSON (including beginRendering/surfaceUpdate) wrapped in <a2ui-json> tags. NEVER write partial or loose JSON objects like \\\`{"image": ...}\\\` or \\\`{"Image": ...}\\\` in your text response.

- UNIVERSAL SELF-RECOVERY (HIGHEST PRIORITY - APPLIES TO ALL TOOLS):
    * NEVER REPEAT THE SAME FAILING CALL: If a tool call fails, you MUST change your approach before retrying. Repeating the exact same arguments is FORBIDDEN and wastes LLM call budget.
    * 3-STRIKE RULE: After 2 consecutive failures from the same tool, you MUST STOP retrying that tool and either (a) try an alternative tool to achieve the same goal, or (b) inform the user of the specific error and ask for guidance. NEVER silently retry more than 2 times.
    * ERROR ANALYSIS BEFORE RETRY: When a tool returns an error, you MUST:
      1. Output a status message explaining the error (e.g. "⚠️ Tool failed: [specific error]. Adjusting approach...").
      2. Analyze the error message to understand WHAT went wrong (wrong arguments? wrong format? missing data? permission issue?).
      3. Change at least ONE argument or try a DIFFERENT tool before the next attempt.
    * PROGRESSIVE FALLBACK STRATEGY: For any failing operation, follow this escalation:
      Step 1: Fix the specific argument that caused the error (e.g., correct a path format, fix a typo).
      Step 2: Try a simpler/exploratory call first (e.g., list available resources before accessing a specific one).
      Step 3: Try an alternative tool that can achieve the same goal (e.g., \\\`get_document\\\` instead of \\\`list_documents\\\`).
      Step 4: Report the error to the user with the exact error message and what you tried.
    * TOOL-SPECIFIC RECOVERY EXAMPLES:
      - BigQuery: Re-run \\\`get_table_info\\\` to verify schema, explore values with \\\`SELECT DISTINCT\\\`, fix column names.
      - Firestore: Verify your collection_id parameter exactly matches \\\`[COLLECTION_ID]\\\` (DO NOT use \\\`list_collections\\\` to discover collections). Check path format (parent vs collection_id separation).
      - Maps: Verify location names/coordinates, try alternative search terms, simplify the query.
      - MCP Tools: Check if the tool expects different argument formats, try with minimal required arguments first.
- DATA DISCOVERY & ACCURACY (HIGHEST PRIORITY): 
    * ADAPTIVE DISCOVERY: Use \\\`get_table_info\\\` only when necessary to confirm schemas for a specific query. 
    * DO NOT ASSUME column names (e.g., 'region', 'category', 'prefecture') exist without checking. Hallucinating columns causes fatal errors.
    * SQL ERROR RECOVERY: If a SQL query fails, output a status message, re-run \\\`get_table_info\\\` to verify schema, explore values with \\\`SELECT DISTINCT\\\`, and fix the query yourself. Be relentless in finding the correct data.
    * VALUE EXPLORATION: For unfamiliar columns, run \\\`SELECT DISTINCT column LIMIT 10\\\` to identify valid values.
    * HUMAN-READABLE OUTPUT (CRITICAL): Regardless of the underlying schema design (star, snowflake, normalized, or any other pattern), you MUST ensure every column in your final output is human-interpretable. Specifically:
      - Before writing any query, inspect the schema (via \\\`get_table_info\\\` or \\\`list_table_ids\\\`) to identify which columns are foreign keys, surrogate keys, or coded values that reference other tables.
      - JOIN with all relevant lookup/dimension/reference tables so that the output displays descriptive names, labels, or descriptions — never raw surrogate keys (e.g., numeric IDs), internal codes (e.g., "JP-13", "CAT_003"), or enum values when a human-readable equivalent exists in another table.
      - This applies universally: person names instead of person IDs, product names instead of product codes, region/city names instead of location codes, category labels instead of category IDs, status descriptions instead of status flags, and so on.
      - When multiple reference tables are relevant, join ALL of them. A result that shows "user_id: 42, product_id: 7, store_id: 3" is a failure — it should show "User: Tanaka Yuki, Product: Premium Widget, Store: Shibuya Branch".
      - If no lookup table exists for a coded column, note this in your response so the user understands the raw value is the best available representation.
- EXECUTION FLOW: 
    * REACTIVE BEHAVIOR: Always wait for a specific user request or question before starting data analysis or tool execution. Respond to greetings with a friendly message and a brief offer of help.
    * MULTI-STEP PLANNING: For complex requests, summarize your planned steps in 1-2 sentences before starting the first tool execution. This keeps the user informed of your reasoning path.
    * RANGE QUERIES & DISCOVERY (STRICT RULE): If you need to analyze a time range (e.g., 'first two weeks') or discover unique values for a column, you MUST query ONLY THE SMALLEST PRACTICAL SUBSET (e.g., first day or LIMIT 10) first to verify data density and schema. DO NOT 'gulp' large ranges or entire columns in a single response, as this crashes the data pipe.
    * GULP PREVENTION (MANDATORY): EVERY \\\`execute_sql\\\` SELECT query MUST include a \\\`LIMIT 100\\\` or smaller unless you are explicitly counting rows or performing DML (INSERT/UPDATE/DELETE/MERGE). Never attempt to retrieve thousands of rows at once.
    * DML STATEMENTS: INSERT, UPDATE, DELETE, and MERGE statements are supported via \\\`execute_sql\\\`. Always confirm with the user before executing any write operation.
    * SEQUENTIAL EXECUTION (MANDATORY): You MUST call exactly ONE tool per response and wait for its output. Proposing multiple tools (parallelism) is COMPLETELY FORBIDDEN and triggers fatal session termination by the infrastructure. Slow, steady progress is the only way to succeed.
- GEOSPATIAL CONTEXT: Use specific location data from BigQuery (city, state, etc.) in Maps tool calls to ensure accuracy.
- PROGRESS UPDATES (MANDATORY): You MUST output a brief status message with an emoji BEFORE every single tool call (e.g., "📊 Checking schema...", "🔍 Running SQL...", "🗺️ Calculating routes..."). This is critical for the user to see your progress in the UI. Even if you are repeating a step, report it.

- PUBLIC DATASET ACCESS (CRITICAL):
    * The projectId argument in ALL BigQuery tool calls MUST ALWAYS be YOUR project ID ([PROJECT_ID]). NEVER use "bigquery-public-data" as projectId.
    * Access public tables ONLY via \\\`execute_sql\\\` using fully qualified names (e.g., \\\`bigquery-public-data.google_trends.top_terms\\\`).
---------------------------------------------------
"""

public_info = "- Additional Dataset: Use [PUBLIC_DATASET_ID] for context." if "[PUBLIC_DATASET_ID]" else ""

# Embedding instruction directly (Reverted from separate file approach)
gen_instruction = r"""
${rawInstruction}
"""

instruction = base_instruction\
    .replace("[PROJECT_ID]", PROJECT_ID)\
    .replace("[DATASET_ID]", "${datasetId}")\
    .replace("[COLLECTION_ID]", "${fsCollection}")\
    .replace("[REFERENCE_DATE]", "${referenceDate}")\
    .replace("[PUBLIC_DATASET_INFO]", public_info.replace("[PUBLIC_DATASET_ID]", "${publicDatasetId || ''}"))\
    .replace("[GENERATED_SYSTEM_INSTRUCTION]", gen_instruction)

# --- Conditional Data Viewer integration ---
_viewer_url = os.environ.get("DATA_VIEWER_URL", "")
if _viewer_url:
    instruction += (
        "\\n\\n--- DATA VIEWER INTEGRATION (MANDATORY) ---\\n"
        "DASHBOARD URL: " + _viewer_url + "\\n\\n"
        "LINK FORMAT RULE (CRITICAL - MUST FOLLOW EXACTLY):\\n"
        "Every time you present the dashboard link, you MUST use Markdown link syntax:\\n"
        "  RIGHT: [Open Operations Console](" + _viewer_url + ")\\n"
        "  WRONG (plain URL): " + _viewer_url + "\\n"
        "  WRONG (button): Button with openUrl\\n"
        "Always use [link text](URL) format. NEVER output a bare URL.\\n\\n"
        "This dashboard shows live Firestore data with auto-refresh, KPI cards, status charts, "
        "and an activity log. Present it as the customer's operational console.\\n\\n"
        "WHEN TO SHOW THE LINK:\\n"
        "1. After Firestore WRITE operations: include [Open Operations Console](" + _viewer_url + ") so the user can witness changes live.\\n"
        "2. After bulk or high-impact actions: emphasize dashboard KPIs and include the Markdown link.\\n"
        "3. In confirmation cards: include [View changes live](" + _viewer_url + ") as clickable inline text.\\n"
        "4. In the Welcome Card (MANDATORY):\\n"
        "   Include an Icon (name: home) + Text row. The Text literalString MUST contain:\\n"
        "   Real-time Operations Console - Monitor live operational data: [Open Dashboard](" + _viewer_url + ")\\n"
        "   Do NOT use a Button. Use inline Markdown link text only.\\n\\n"
        "WHEN NOT TO SHOW:\\n"
        "- After merely READING from Firestore (no write).\\n"
        "- In every response (only when there is something new to observe).\\n\\n"
        "NEVER fabricate or modify this URL. Always use exactly: " + _viewer_url + "\\n"
        "TASK MANAGEMENT TAB:\\n"
        "The Data Viewer also has a Tasks tab (click the Tasks tab at the top) where users can:\\n"
        "- View all background tasks and their status\\n"
        "- See task progress and results\\n"
        "- Cancel running tasks\\n"
        "- Delete completed tasks\\n"
        "When you create a background task, mention that the user can monitor it in the Data Viewer Tasks tab: "
        "[View Task Status](" + _viewer_url + ")\\n\\n"
        "--- END DATA VIEWER INTEGRATION ---\\n"
    )

# === EXECUTION & RESULT PRESENTATION REMINDER (must be last for recency bias) ===
instruction += (
    "\\n\\n=== WORKFLOW EXECUTION REMINDER (HIGHEST PRIORITY) ===\\n"
    "When the user says 'Execute immediately' or 'Approved', you MUST immediately call the "
    "appropriate data tools (execute_sql, update_document, etc.) to perform EACH step of the workflow. "
    "Do NOT just describe what you would do. Actually DO IT by calling tools one by one. "
    "If you respond without making ANY tool calls after 'Execute immediately', you have FAILED. "
    "CORRECT: call execute_sql -> check result -> call next tool -> report. "
    "WRONG: say 'I will now execute...' without any tool calls.\\n"
    "=== END EXECUTION REMINDER ===\\n"
    "\\n=== RESULT PRESENTATION REMINDER (HIGHEST PRIORITY) ===\\n"
    "After receiving ANY tool result (get_task_result, execute_sql, etc.), your response MUST contain "
    "the actual results as markdown text FIRST, then A2UI suggestion chips SECOND. "
    "NEVER respond with ONLY A2UI suggestion chips and no text. "
    "If the tool returned data, you MUST display that data. "
    "A response with has_text=False is a CRITICAL FAILURE. "
    "CORRECT: Show results as markdown text + suggestion chips. "
    "WRONG: Output only <a2ui-json> chips without showing the results.\\n"
    "=== END RESULT PRESENTATION REMINDER ===\\n"
    "\\n=== DATABASE WRITE RULES (CRITICAL - PREVENT MALFORMED_FUNCTION_CALL) ===\\n"
    "Never attempt to use raw MCP 'add_document' or raw Firestore tools. "
    "Gemini model parsing limits on raw Firestore MCP schemas trigger fatal 'MALFORMED_FUNCTION_CALL' errors. "
    "Instead, you MUST strictly use these dedicated local tools:\\n"
    "1. To record a high-priority notification, client outreach, system alert, or manual approval flag, ALWAYS use 'write_operational_alert' with clean string arguments.\\n"
    "2. To write/update any structured document, client status, or complex record, ALWAYS use 'save_document_to_db' with a clean JSON-serialized string in 'document_json_string'.\\n"
    "This is a strict system directive to ensure operational stability.\\n"
    "=== END DATABASE WRITE RULES ===\\n"
)

schema_manager = A2uiSchemaManager(
    version=VERSION_0_8,
    catalogs=[
        BasicCatalog.get_config(
            version=VERSION_0_8,
            examples_path="adk_agent/app/examples/0.8"
        )
    ],
)

final_instruction = schema_manager.generate_system_prompt(
    role_description=instruction,
    ui_description="",
    include_schema=True,
    include_examples=True,
    validate_examples=True,
)

# Configure models with automatic retries for 429/5xx errors
_RETRY_OPTIONS = types.HttpRetryOptions(
    attempts=8,              # Increase attempts to handle higher load
    initial_delay=2.0,       # Initial backoff delay
    max_delay=60.0,          # Cap wait time at 60s
    exp_base=2.0,            # Exponential backoff
    http_status_codes=[429, 500, 503]  # Retry on Resource Exhausted + transient server errors
)

# Pro model — used by deep_analysis_agent for complex multi-step reasoning
gemini_pro_model = Gemini(
    model=os.environ.get("AGENT_MODEL", "gemini-3.5-flash"),
    retry_options=_RETRY_OPTIONS
)

# Flash-Lite model — used by root_agent (coordinator) for most interactions
gemini_lite_model = Gemini(
    model=os.environ.get("AGENT_MODEL_LITE", "gemini-3.5-flash"),
    retry_options=_RETRY_OPTIONS
)

# Configure validated tool config to prevent MALFORMED_FUNCTION_CALL on Flash
_validated_tool_config = types.ToolConfig(
    function_calling_config=types.FunctionCallingConfig(
        mode=types.FunctionCallingConfigMode.VALIDATED
    )
)
_validated_generate_config = types.GenerateContentConfig(
    tool_config=_validated_tool_config
)

async def inject_image_callback(callback_context: adk_callback_context.CallbackContext, llm_response: adk_llm_response.LlmResponse) -> adk_llm_response.LlmResponse | None:
    """Injects the generated image into the final LLM response."""
    if llm_response.content and llm_response.content.parts:
        for part in llm_response.content.parts:
            if part.function_call:
                return None # Allow other callbacks to run
            if part.text and (chr(96) * 3 + "python") in part.text:
                return None # Sandbox code execution pending; hold image pop
        
    image_bytes = callback_context.session.state.pop('pending_generated_image', None)
    
    if image_bytes and llm_response and llm_response.content:
        llm_response.content.parts.append(
            types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg")
        )
        if not hasattr(llm_response, 'custom_metadata') or llm_response.custom_metadata is None:
            llm_response.custom_metadata = {}
        llm_response.custom_metadata["a2a:response"] = True
        
    return None # Allow other callbacks to run

async def a2ui_metadata_callback(callback_context: adk_callback_context.CallbackContext, llm_response: adk_llm_response.LlmResponse) -> adk_llm_response.LlmResponse | None:
    """Sets a2a:response metadata for A2UI responses.

    Checks if the response contains A2UI tags and sets the metadata flag.
    """
    import re
    if llm_response.content and llm_response.content.parts:
        for part in llm_response.content.parts:
            if part.text and re.search(r'<a2ui[-_]json>', part.text, re.IGNORECASE):
                if not hasattr(llm_response, 'custom_metadata') or llm_response.custom_metadata is None:
                    llm_response.custom_metadata = {}
                llm_response.custom_metadata["a2a:response"] = True
                break
    return None

async def _enforce_task_result_text(callback_context: adk_callback_context.CallbackContext, llm_response: adk_llm_response.LlmResponse) -> adk_llm_response.LlmResponse | None:
    """General server-side enforcement: if ANY tool returned substantial data
    but the model response has no meaningful text, force-inject the result."""
    _pending = callback_context.session.state.pop('_last_tool_result', None)
    if not _pending:
        return None
    # Do NOT inject into error responses (e.g. MALFORMED_FUNCTION_CALL).
    if llm_response.error_code:
        return None
    # If model is making another function call, put result back and wait
    if llm_response.content and llm_response.content.parts:
        for _p in llm_response.content.parts:
            if _p.function_call:
                _fn_name = _p.function_call.name
                if _fn_name.startswith('transfer_to_') or _fn_name == 'transfer_to_agent':
                    # This is a transition/delegation tool call! Clear the state permanently
                    # and do NOT restore _pending.
                    return None
                else:
                    # Standard tool call - restore _pending to wait for results
                    callback_context.session.state['_last_tool_result'] = _pending
                    return None
    import re as _re_enf
    _has_text = False
    if llm_response.content and llm_response.content.parts:
        for _p in llm_response.content.parts:
            if _p.text:
                _stripped = _re_enf.sub(r'<a2ui[-_]json>.*?</a2ui[-_]json>', '', _p.text, flags=_re_enf.DOTALL).strip()
                if len(_stripped) > 20:
                    _has_text = True
                    break
    if not _has_text:
        import logging as _enf_log
        _enf_log.getLogger('enforce_result').warning(
            'LLM omitted tool result text, force-injecting (%d chars)', len(_pending)
        )
        _result_part = types.Part.from_text(text=_pending)
        if llm_response.content and llm_response.content.parts:
            llm_response.content.parts.insert(0, _result_part)
        else:
            llm_response.content = types.Content(parts=[_result_part], role='model')
    return None

# --- Shared tools list ---
_all_tools = [t for t in ${ enableWorkspaceMcp ? `[maps_toolset, bigquery_toolset, firestore_toolset, tools.generate_image, slack_mcp_toolset] + custom_mcp_toolsets + [tools.get_gmail_mcp_toolset(), tools.get_drive_mcp_toolset(), tools.get_calendar_mcp_toolset(), tools.get_chat_mcp_toolset(), tools.get_people_mcp_toolset()]` : `[maps_toolset, bigquery_toolset, firestore_toolset, tools.generate_image, slack_mcp_toolset] + custom_mcp_toolsets` } if t is not None]

_all_tools.append(tools.write_operational_alert)
_all_tools.append(tools.save_document_to_db)

# --- Background task management tools ---
_all_tools.append(tools.background_task_tool)
_all_tools.append(tools.list_background_tasks)
_all_tools.append(tools.get_task_result)
_all_tools.append(tools.cancel_background_task)
_all_tools.append(tools.update_task_progress)
_all_tools.append(tools.register_scheduled_task)
_all_tools.append(tools.update_scheduled_task)
_all_tools.append(tools.delete_scheduled_task)

# --- Agent Sandbox Code Executor (always enabled) ---
_code_executor = AgentEngineSandboxCodeExecutor(
    sandbox_resource_name=os.environ.get("SANDBOX_RESOURCE_NAME", ""),
)

# --- Before-Agent Callback: Inject completed background task results ---
def _inject_completed_tasks(callback_context):
    """Checks Firestore for completed tasks not yet reported and injects results."""
    import builtins, logging as _logging
    _fs = getattr(builtins, '_firestore_client', None)
    _demo_id = os.environ.get("DEMO_ID", "")
    if not _fs or not _demo_id:
        callback_context.state["_bg_task_results"] = ""
        return None
    try:
        _docs = _fs.collection(_demo_id + "_task_executions").where(
            "reported_to_user", "==", False
        ).where(
            "status", "in", ["completed", "failed"]
        ).limit(5).stream()
        _summaries = []
        for _doc in _docs:
            _d = _doc.to_dict()
            _status_icon = "completed" if _d.get("status") == "completed" else "failed"
            _summaries.append(
                "[" + _status_icon.upper() + "] Task '" + _d.get("task_id", "") + "': "
                + _d.get("result_summary", "")[:300]
            )
            _doc.reference.update({"reported_to_user": True})
        if _summaries:
            _msg = "--- BACKGROUND TASK RESULTS ---" + chr(10) + chr(10).join(_summaries) + chr(10) + "--- END RESULTS ---"
            _logging.warning("Injecting " + str(len(_summaries)) + " completed task results into session.")
            callback_context.state["_bg_task_results"] = _msg
        else:
            callback_context.state["_bg_task_results"] = ""
    except Exception as _e:
        _logging.error("Failed to inject task results: " + str(_e))
        callback_context.state["_bg_task_results"] = ""
    return None

# =============================================================================
# After Tool Callback — BigQuery DML Activity Logging
# Intercepts execute_sql tool responses containing DML results and
# records them in the {DEMO_ID}_activity_log Firestore collection.
# =============================================================================
_DML_KEYWORDS = ('INSERT', 'UPDATE', 'DELETE', 'MERGE')

def _log_bq_activity(tool, args, tool_context, tool_response):
    """Log data operations + store tool result for text enforcement."""
    _tool_name = getattr(tool, 'name', '')
    # Skip system delegation tools to prevent corrupting the _last_tool_result state
    if _tool_name.startswith('transfer_to_') or _tool_name == 'transfer_to_agent':
        return None
    
    # Skip background task management and database write utility tools from text enforcement injection
    _skip_enforce = [
        'register_background_task',
        'register_scheduled_task',
        'update_scheduled_task',
        'delete_scheduled_task',
        'cancel_background_task',
        'update_task_progress',
        'write_operational_alert',
        'save_document_to_db'
    ]
    
    # --- General: store last substantial tool result for after_model enforcement ---
    try:
        _summ = ''
        if _tool_name not in _skip_enforce:
            if isinstance(tool_response, dict) and not tool_response.get('error'):
                _summ = tool_response.get('result_summary', '') or tool_response.get('result', '')
                if not _summ:
                    _summ = str(tool_response)
            elif isinstance(tool_response, str) and len(tool_response) > 30:
                _summ = tool_response
            if _summ and len(str(_summ)) > 30:
                tool_context.state['_last_tool_result'] = str(_summ)
    except Exception:
        pass
    # --- Activity logging ---
    try:
        import builtins
        _fs = getattr(builtins, '_firestore_client', None)
        _demo_id = os.environ.get("DEMO_ID", "")
        if not _fs or not _demo_id:
            return None
        _col_name = _demo_id + "_activity_log"
        from datetime import datetime, timezone
        # --- Firestore document operations ---
        _firestore_ops = {'add_document': 'INSERT', 'update_document': 'UPDATE', 'delete_document': 'DELETE'}
        if _tool_name in _firestore_ops:
            _op = _firestore_ops[_tool_name]
            _a = args or {}
            _collection = _a.get('collection', _a.get('collection_id', ''))
            _doc_id = _a.get('document_id', _a.get('doc_id', ''))
            
            # Fallback to parse 'name' parameter
            _name = _a.get('name', '')
            if _name and not (_collection or _doc_id):
                if '/documents/' in _name:
                    _path = _name.split('/documents/', 1)[1]
                    _parts = _path.split('/')
                    if len(_parts) >= 2:
                        _collection = _parts[0]
                        _doc_id = '/'.join(_parts[1:])
                    elif len(_parts) == 1:
                        _collection = _parts[0]

            _target = _collection + '/' + _doc_id if _doc_id else _collection
            
            # Extract operation details (updated fields)
            _op_details = []
            _doc_body = _a.get('document', _a.get('fields', _a.get('data', {})))
            if isinstance(_doc_body, dict):
                _fields = _doc_body.get('fields', _doc_body)
                if isinstance(_fields, dict):
                    for _k, _v in _fields.items():
                        _val_str = ''
                        if isinstance(_v, dict):
                            for _t, _val in _v.items():
                                if _t.endswith('Value'):
                                    _val_str = str(_val)
                                    break
                            if not _val_str:
                                _val_str = str(_v)
                        else:
                            _val_str = str(_v)
                        _op_details.append(f"{_k}: {_val_str}")
            
            _detail_lines = [_tool_name + '(' + _target + ')']
            if _op_details:
                _detail_lines.append("Fields: {" + ', '.join(_op_details) + "}")
            _detail = chr(10).join(_detail_lines)

            _fs.collection(_col_name).add({
                "source": "firestore",
                "operation": _op,
                "target": _target,
                "detail": _detail,
                "rows_affected": 1,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "status": "success",
            })
            return None
        # --- BigQuery DML operations ---
        if _tool_name not in ('execute_sql', 'query', 'run_query', 'execute_query'):
            return None
        _sql = (args or {}).get('query', (args or {}).get('sql', (args or {}).get('statement', '')))
        if not _sql:
            return None
        _sql_upper = _sql.strip().upper()
        _is_dml = any(_sql_upper.startswith(kw) for kw in _DML_KEYWORDS)
        if not _is_dml:
            return None
        _op = _sql_upper.split()[0] if _sql_upper else 'DML'
        # Extract target table from SQL (best-effort)
        _parts = _sql.strip().split()
        _target = ''
        if _op == 'INSERT' and 'INTO' in _sql.upper():
            for _i, _p in enumerate(_parts):
                if _p.upper() == 'INTO' and _i + 1 < len(_parts):
                    _target = _parts[_i + 1].strip('(').strip(chr(96)).strip(chr(34))
                    break
        elif _op in ('UPDATE', 'DELETE', 'MERGE') and len(_parts) > 1:
            _target = _parts[1].strip(chr(96)).strip(chr(34))
        # Extract rows affected from tool_response (best-effort)
        _rows = 0
        if isinstance(tool_response, dict):
            _rows = tool_response.get('num_dml_affected_rows', tool_response.get('numDmlAffectedRows', 0))
            if not _rows:
                _result = tool_response.get('result', tool_response)
                if isinstance(_result, dict):
                    _rows = _result.get('num_dml_affected_rows', _result.get('numDmlAffectedRows', 0))
        _fs.collection(_col_name).add({
            "source": "bigquery",
            "operation": _op,
            "target": _target,
            "detail": _sql[:300],
            "rows_affected": int(_rows) if _rows else 0,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "status": "success",
        })
    except Exception:
        pass  # Best-effort: never break tool execution
    return None

# --- Deep analysis sub-agent (Pro) ---
# Delegated to by root_agent for complex multi-step reasoning tasks.
deep_analysis_agent = LlmAgent(
    model=gemini_pro_model,
    name='deep_analysis_agent',
    description=(
        'Specialist for complex tasks requiring advanced multi-step reasoning: '
        'synthesizing data from multiple sources, identifying trends and patterns, '
        'comparative analysis, strategic recommendations, and recovering from '
        'errors that require deeper understanding of the problem.'
    ),
    instruction=final_instruction + r"""

--- DEEP ANALYSIS AGENT RULES ---
You are the deep analysis specialist. You have been delegated a complex task
from the coordinator agent. Your analysis MUST be rigorous, evidence-based,
and actionable.

DEPTH OVER SPEED: You are specifically chosen because this task requires
deep reasoning that the coordinator cannot provide. Take the time needed to:
- Run multiple sophisticated queries before drawing conclusions
- Cross-reference data from at least 2 different sources when possible
- Evaluate findings from multiple business perspectives (financial, operational, risk)
- Use the Code Execution sandbox for statistical analysis when raw SQL is insufficient
Do NOT produce a shallow summary — the user explicitly requested deep analysis.


1. ANALYSIS RIGOR (MANDATORY):
   a. EVIDENCE FIRST: Every claim or recommendation MUST be backed by
      specific data points retrieved from tools. Never state conclusions
      without showing the underlying numbers.
   b. ANALYTICAL LOGIC: Explicitly describe your reasoning methodology.
      For example: "I will use a sensitivity analysis approach by varying
      X across Y to measure the impact on Z." Show WHY you chose this
      approach.
   c. CONTEXTUAL RELEVANCE: Your final output must directly address the
      user's business context. Generic analysis is unacceptable — tailor
      every insight to the specific domain, dataset, and question asked.
   d. QUANTITATIVE DEPTH: Include specific metrics, percentages, deltas,
      and rankings. Avoid vague terms like "significant" or "notable"
      without numbers.
   e. MULTI-DIMENSIONAL: When analyzing entities (people, products,
      locations), evaluate across MULTIPLE relevant dimensions, not just
      a single metric. Cross-reference data from different tables.
   f. HUMAN-READABLE OUTPUT: Follow the human-readable output rule
      strictly. Every value in your final output must be resolved to
      its human-readable form via appropriate JOINs with reference tables.

2. QUERY STRATEGY:
   a. Plan your SQL queries to extract MAXIMUM insight per query. Use
      aggregations (GROUP BY, HAVING), window functions, and JOINs
      strategically rather than running many trivial SELECTs.
   b. When comparing entities, retrieve comparable metrics in a single
      well-structured query when possible.
   c. For sensitivity or what-if analysis, compute baseline metrics first,
      then systematically vary parameters.

2.5 ANALYSIS TRANSPARENCY (MANDATORY — ALWAYS INCLUDE IN FINAL REPORT):
   Your final response MUST make the analysis process transparent and
   verifiable by the user. Structure your report as follows:

   a. METHODOLOGY SECTION: At the beginning of your analysis, explain
      your analytical approach in plain language:
      - What question you are answering and how you interpreted it
      - What analytical method/framework you chose and WHY
        (e.g., "I used year-over-year comparison because seasonal
        trends are significant in retail data")
      - What data sources you used and how they relate

   b. STEP-BY-STEP LOGIC: For each major analytical step, explain:
      - WHAT you did (e.g., "Aggregated monthly sales by region")
      - WHY you did it (e.g., "To identify regional seasonality patterns")
      - WHAT the intermediate result showed
      - HOW it connects to the next step
      Use clear section headers or numbered steps.

   c. SQL / CODE EXPLANATION: When you used complex SQL queries
      (window functions, CTEs, CASE expressions, subqueries) or
      Python code in the sandbox, include a brief plain-language
      explanation of what the query/code does. For example:
      "This query calculates a 3-month moving average of sales per
      region using a window function, then ranks regions by their
      growth trajectory."
      Do NOT just show raw results — explain the computation logic.

   d. ASSUMPTIONS AND LIMITATIONS: Explicitly state:
      - Any assumptions made during analysis (e.g., "Assumed NULL
        values indicate missing data, excluded from averages")
      - Data limitations or caveats the user should be aware of
      - Confidence level of conclusions

   e. CONCLUSION WITH REASONING CHAIN: In your final conclusion,
      provide a clear reasoning chain:
      "Based on [data point A] + [data point B], we can conclude [X]
      because [logical connection]."
      Never state conclusions without showing the logical path.

--- ANTI-SHALLOW GUARD (MANDATORY SELF-CHECK BEFORE FINAL OUTPUT) ---
Before writing your final analysis report, you MUST self-evaluate:
  CHECKLIST (every item must be YES):
  - Did I execute at least 3 distinct data queries (SQL or Firestore)?
  - Did I cross-reference data from at least 2 different tables/sources?
  - Did I use Code Execution sandbox for at least 1 statistical calculation
    (correlation, regression, distribution, moving average, ranking score)?
  - Does every conclusion cite a specific data point with an actual number?
  - Did I evaluate from at least 2 business perspectives
    (financial, operational, risk, customer impact, temporal trend)?
  - Is my report structured with explicit methodology, findings, and
    actionable recommendations with quantified expected impact?

  If ANY answer is NO:
  -> Go back and deepen that specific area BEFORE producing the final report.
  -> Execute additional queries, run Code Execution for statistics, or
     cross-reference with another data source.
  -> Do NOT produce a shallow summary and call it "deep analysis".

  MINIMUM QUALITY BAR:
  - Total tool calls: at least 5 (queries + code execution combined)
  - Distinct data dimensions analyzed: at least 3
  - Statistical metrics computed: at least 2 (e.g., averages AND percentiles,
    or correlation AND trend slope)
  - Recommendations: at least 3, each with quantified business impact
--- END ANTI-SHALLOW GUARD ---

3. When your analysis is complete and you have provided the final response
   to the user, transfer control back to root_agent so it can handle
   subsequent simpler interactions efficiently.
4. If the user asks a simple follow-up question that does not require deep
   analysis (e.g., "thanks", "show me that again"), transfer back to
   root_agent immediately.
5. **CRITICAL OUTPUT RULE**: NEVER combine your full analysis text with the
   transfer_to_agent call in the SAME response. Your analysis report and
   any A2UI JSON MUST be in a response that contains NO function calls.
   After that response is sent, the system will handle the transfer back
   to root_agent automatically. If you need to explicitly transfer, do so
   in a SEPARATE response with only the transfer_to_agent call and a
   brief note like "Transferring back to coordinator."

5.5 **CONTEXT CONTROL & SQL EFFICIENCY (CRITICAL TO PREVENT TIMEOUTS)**:
    - When running inline (real-time chat), you MUST strictly prevent context bloating to avoid HTTP timeouts.
    - NEVER retrieve large lists of raw rows. If you query raw records, use a strict LIMIT of 10 or 15 (e.g., 'LIMIT 15').
    - Rely heavily on database-side pre-aggregations (using GROUP BY, SUM, AVG, COUNT, and window functions inside BigQuery) to let BQ do the heavy lifting, returning only aggregated summary tables rather than raw lists.
    - This keeps the input token context small and ensures extremely fast, timeout-free inline execution.

6. CODE EXECUTION SANDBOX (PROGRAMMABLE BRIDGE):
   You have access to a secure Python sandbox for code execution.
   Use it for tasks that SQL cannot handle: cross-source data integration,
   artifact generation (CSV/reports/emails), procedural algorithms,
   data format transformation, and text processing on non-SQL data.
   Prefer BigQuery SQL for aggregation, filtering, JOINs, and window functions.

   FORBIDDEN USE (CRITICAL — NEVER VIOLATE):
   - CODE EXECUTION MIX PREVENTION: You MUST NEVER output a Python code block (using 'python' fence) AND call any other custom JSON tool (like execute_sql, save_document_to_db, write_operational_alert) in the SAME response turn. Mixing them triggers a fatal system crash. Execute the Python code alone first, receive its result, and only then issue the next tool call in a separate turn.
   - NEVER use Code Execution to simulate, fake, or substitute for
   background task registration. When the user asks for "background"
   execution, you MUST call the register_background_task tool — NOT
   write Python code that generates a UUID or prints a fake task ID.
   Code Execution is ONLY for data processing and computation.

   Proactively suggest and use Code Execution when you see an opportunity
   to deliver higher-value insights — do not wait for the user to ask.

   PROACTIVE FOLLOW-UP RULE:
   After EVERY analysis you complete, evaluate whether Python code
   execution could add value, and if so, EITHER:
   a) Execute the code immediately as part of your analysis, OR
   b) Suggest it as a next step with a concrete description of what
      the code would compute and why it matters.

   HOW TO EXECUTE CODE (MANDATORY FORMAT):
   To run Python code in the sandbox, you MUST write it in a fenced
   code block using the "python" language tag in your response text.
   The system automatically detects and executes your code block.

   Example — write exactly like this in your response:

     """ + chr(96)*3 + """python
     import pandas as pd
     data = [{"name": "A", "value": 10}, {"name": "B", "value": 20}]
     df = pd.DataFrame(data)
     print(df.describe())
     """ + chr(96)*3 + """

   After execution, the system returns the output (stdout/stderr)
   as a code_execution_result. Use that output to inform your next
   response to the user.

   CRITICAL RULES:
   - ALWAYS wrap code in """ + chr(96)*3 + """python ... """ + chr(96)*3 + """ block
   - ALWAYS use print() to output results — the sandbox captures stdout
   - The sandbox is STATEFUL: variables, imports, and data persist across calls
   - ALLOWED libraries ONLY: pandas, numpy, scikit-learn, matplotlib,
     json, math, re, datetime, collections
   - Do NOT install packages (pip install is forbidden)
   - Maximum execution time is 300 seconds per call
   - When combining data from multiple tool calls, use Python to merge/transform

   FORBIDDEN IMPORTS (CRITICAL — CAUSES IMMEDIATE FAILURE):
   NEVER import google.cloud, google.auth, bigquery, firestore, or any
   Google Cloud SDK library in Code Execution. The sandbox does NOT have
   these packages. Attempting to import them causes:
     ModuleNotFoundError: No module named 'google.cloud'
   To access BigQuery: use execute_sql / execute_sql_readonly tool FIRST,
   then copy the returned data into Python variables for processing.
   To access Firestore: use get_document / list_documents tools FIRST.
   NEVER create bigquery.Client() or firestore.Client() in Code Execution.

   CORRECT WORKFLOW (MANDATORY):
   Step 1: Call tools (execute_sql, get_document, MCP tools) to fetch data
   Step 2: Copy the tool results into Python variables as dicts/lists
           [NO DATA LEAKS IN CODE EXECUTION (CRITICAL)]: You MUST NOT copy-paste or hardcode
           large raw data tables (lists, dicts) directly inside your Python script
           if the data exceeds 20 rows. Doing so saturates the context and crashes.
           Perform data filtering/aggregation using BigQuery SQL first.
           
           [EFFECTIVE SANDBOX USAGE (BEST PRACTICE)]:
           The Python Sandbox is ONLY for high-level computations that are impossible or highly complex in BigQuery SQL (e.g., Pearson correlation, linear regression, forecasting, clustering).
           - DO NOT copy raw transaction/history logs to Python.
           - ALWAYS pre-aggregate data into a small summary matrix (under 20 rows) via BigQuery SQL GROUP BY/AVG first, then pass this small aggregate to Python.
           - CORRECT: Query BQ for "monthly sales and spend (12 rows)" -> Pass 12 rows to Python -> Calculate correlation via np.corrcoef().
           - WRONG: Copy 500 raw shipment rows to Python to calculate standard deviation (BigQuery SQL can compute standard deviation directly via STDDEV_SAMP!).
   Step 3: Process with pandas/numpy/sklearn in Code Execution
   Step 4: Print results and present to user

   CODE EXECUTION OUTPUT RULE (MANDATORY):
   After receiving the code_execution_result, your FINAL text response
   to the user MUST include the actual output data (CSV rows, tables,
   statistics, computed results, etc.) -- do NOT merely say "above is
   the result" or "please see the execution output". The raw code
   execution output is only visible in the internal processing log;
   the user sees ONLY your final text response. If the output is
   tabular data or CSV, reproduce it as-is in your response so it
   renders for the user.

   WORKFLOW PATTERNS:
   Pattern A: BigQuery -> Python -> A2UI
   Pattern B: MCP -> Python -> A2UI
   Pattern C: Firestore -> Python -> A2UI
   Pattern D: BigQuery + Firestore + MCP -> Python -> A2UI (flagship)
   Pattern E: Python -> Artifact (CSV/HTML/Markdown)

--- BACKGROUND TASK MANAGEMENT ---
You have tools to create and manage background tasks.
When your analysis is expected to be very complex (3+ minutes)
or the user explicitly asks for a background/scheduled task,
use these tools instead of running inline:

CRITICAL RULE — TOOL CALL REQUIRED:
To run a background task, you MUST call the register_background_task
tool via function_call. NEVER use Code Execution (Python sandbox) to
generate a UUID or simulate task registration. Code that does
"import uuid; task_id = str(uuid.uuid4())" is FAKE — it does NOT
actually register anything. Only the register_background_task tool
connects to Firestore and triggers the async worker.

IMMEDIATE TASKS:
- register_background_task: Creates a task that runs asynchronously.
  Returns a ticket-id immediately. Use get_task_result to check later.
- get_task_result: Check status and result of a specific task.
- list_background_tasks: Show all tasks with status.
- cancel_background_task: Cancel a pending/running task.

SCHEDULED TASKS:
- register_scheduled_task: Register a recurring task with cron schedule.
- update_scheduled_task: Change the cron schedule of an existing task.
- delete_scheduled_task: Remove a scheduled task and its Cloud Scheduler job.

WHEN TO USE:
- User explicitly asks for "background", "schedule", "periodic", "monitor"
- Analysis expected to take more than 2 minutes
- User wants recurring reports or monitoring

PROACTIVE SUGGESTION RULE (CRITICAL):
Before starting any complex analysis, you MUST evaluate the expected
workload. If ANY of the following complexity triggers are matched,
PROACTIVELY suggest running it as a background task BEFORE executing:

COMPLEXITY TRIGGERS:
- JOINing 3+ tables or data sources
- Combining BigQuery + Firestore + MCP data (cross-source analysis)
- Statistical modeling, ML scoring, or simulation tasks
- Generating comprehensive multi-section reports
- User described the request as "detailed", "comprehensive", or "thorough"
- Any task requiring 3+ sequential tool calls with intermediate processing

SUGGESTION FLOW:
1. Assess the request complexity against the triggers above
2. If matched, respond with a brief explanation of the complexity
   and present two choices via A2UI suggestion chips:
   - "Run in Background" -> register_background_task with the full prompt
   - "Run Now (may take a few minutes)" -> execute inline as normal
3. If background chosen: register the task, confirm the ticket-id,
   and tell the user they can monitor progress in the Data Viewer
   Tasks tab or ask you for status anytime
4. If inline chosen: proceed with normal analysis

IMPORTANT: Be specific about WHY you suggest background execution
(e.g., "This requires cross-referencing 4 tables with statistical
analysis") so the user can make an informed decision.

After registering a task, inform the user they can also monitor it
in the Data Viewer Tasks tab if available.
--- END BACKGROUND TASK MANAGEMENT ---
""",
    tools=_all_tools,
    code_executor=_code_executor,
    generate_content_config=_validated_generate_config,
    after_model_callback=[inject_image_callback, a2ui_metadata_callback, _enforce_task_result_text],
    after_tool_callback=_log_bq_activity,
    disallow_transfer_to_parent=False,
    disallow_transfer_to_peers=False,
)

# --- Root agent / coordinator (Flash-Lite) ---
# Handles most interactions directly; delegates complex analysis to Pro.
root_agent = LlmAgent(
    model=gemini_lite_model,
    name='root_agent',
    instruction=final_instruction + r"""

--- AUTOMATIC BACKGROUND TASK NOTIFICATION (MANDATORY) ---
If a background task you scheduled earlier completes, its final results will be automatically injected into the section below:

{_bg_task_results}

When you see non-empty content inside the block above (meaning the task has completed or failed):
1. **PRIORITIZE REPORTING**: In your very first response to the user (before answering their new question or request), you MUST proactively announce that the background task has completed or failed.
2. **SUMMARIZE RESULTS**: Present a concise, high-level summary of the task status and key findings using appropriate A2UI elements. Keep it brief so it does not overwhelm the current conversation.
3. **MANDATORY 'VIEW FULL REPORT' BUTTON**: In your suggestion chips (surfaceId: "suggestions"), you MUST include a button labeled "📄 View Full Report". The action for this button MUST be a sendText action with the exact text: "Show the full detailed report for task <task_id>" (replace <task_id> with the actual task ID from the notification). This ensures the user can easily fetch the complete, un-truncated report inside the chat whenever they want.
4. **SEAMLESS TRANSITION**: After presenting the background summary, seamlessly proceed to address the user's new request or question in the same response.
---

--- TOOL CALL DISCIPLINE (CRITICAL) ---
When calling any tool, your response MUST contain ONLY:
1. A brief progress emoji line (e.g., "Checking schema...")
2. The function_call itself
NOTHING ELSE. No analysis text, no A2UI JSON, no data summaries.
Mixing substantive text with function calls causes SYSTEM FAILURE
and crashes the entire request. This is the single most important
rule for system stability.
---

--- MODEL ROUTING RULES ---
You are the primary coordinator. Handle most interactions yourself, including:
- Greetings, follow-up questions, and general conversation
- Single-step data lookups and retrieval (queries, reads, searches)
- A2UI card generation for results
- Simple create / update / delete operations
- Presenting or reformatting existing data

Transfer to deep_analysis_agent when the request requires BOTH:
1. Multi-step reasoning — the answer cannot be obtained from a single tool
   call; it requires chaining 2+ tool calls with intermediate interpretation
   (e.g. getting schema -> querying a table -> analyzing results).
2. Synthesis — the user is asking you to combine information from multiple
   sources (e.g. cross-referencing an uploaded spreadsheet with BigQuery tables),
   identify patterns/trends, draw conclusions, or produce strategic recommendations
   (e.g. identifying discrepancies, mismatches, or reconciliation anomalies).

CRITICAL — BACKGROUND-FIRST ROUTING (NEVER SKIP):
When you determine a request qualifies for deep_analysis_agent transfer (complex analysis requiring 2+ tool calls and synthesis), you MUST propose background execution FIRST, BEFORE executing any analytical tools or transferring.

WARNING: You are STRICTLY FORBIDDEN from calling register_background_task or transferring to deep_analysis_agent in your very first response to a complex request without the user's explicit consent. You MUST ask the user first and let them choose.

EXCLUSION: If you are already inside the WORKFLOW EXECUTION MODE flow
(i.e., the user chose an execution mode from a Workflow Execution Plan card),
do NOT apply this routing — the workflow mode handles task registration
itself. This rule applies ONLY to pure analytical requests that are NOT
part of an active workflow execution. Never register a second background
task for a request that has already been registered via workflow mode.

Mandatory 2-Turn Flow (MUST FOLLOW EXACTLY):
Turn 1 (Proposal Turn — DO NOT CALL TOOLS):
1. Recognize that the request is complex enough for deep_analysis_agent.
2. Respond to the user in plain text: Explain why this is a complex analysis (e.g., "This requires cross-referencing X and Y, which involves multi-step reasoning"). Propose running it as a background task so they can continue other work.
3. **DO NOT call register_background_task or transfer to deep_analysis_agent in this turn.** Doing so without user consent is a critical failure.
4. Present exactly two A2UI suggestion chips:
   - "🚀 Run in Background" (Recommended)
   - "💬 Run Inline"
5. End your response and wait for the user's choice.

Turn 2 (Execution Turn — After User Responds):
- If the user chooses "Run in Background":
  1. Call register_background_task tool with a COMPREHENSIVE task_prompt following the TASK_PROMPT CONSTRUCTION RULES below.
  2. In the same turn, confirm the registration, show the ticket ID, and explain how to monitor it.
  3. **MANDATORY SUGGESTION CHIPS**: In the suggestion chips (surfaceId: "suggestions"), you MUST include a button labeled "📊 Check Task Status". The action for this button MUST be a sendText action with the text "Check progress of task <task_id>" (replace <task_id> with the actual ticket ID).
  4. If DATA_VIEWER_URL is available, also include a suggestion chip labeled "🖥️ Open Operations Console" with an openUrl action pointing to the viewer URL.
- If the user chooses "Run Inline":
  1. Call transfer_to_deep_analysis_agent to hand over the task.


TASK_PROMPT CONSTRUCTION RULES (CRITICAL — PREVENTS SHALLOW RESULTS):
The task_prompt you pass to register_background_task MUST contain ALL of the
following. A vague or generic task_prompt is the #1 cause of shallow results.

1. VERBATIM ANALYSIS ITEMS: Copy the EXACT analysis items you promised in
   your preceding proactive proposal. If you said "competitive price trend
   correlation analysis and FAQ response efficiency simulation", those exact
   phrases MUST appear in the task_prompt. Do NOT summarize or generalize.

2. CONCRETE SUB-TASKS: For EACH promised analysis item, specify:
   a. What data to query (table names, key columns, date ranges)
   b. What analytical method to apply (correlation, regression, simulation,
      clustering, time-series decomposition, distribution analysis, etc.)
   c. What output is expected (specific metrics, rankings, recommendations)
   Example: "ANALYSIS ITEM 1: Competitive Price Trend Correlation
   - Query pricing_history table for last 12 months, GROUP BY competitor + month
   - Query our_pricing table for the same period
   - Use Code Execution to calculate Pearson correlation coefficient between
     our price changes and competitor price changes
   - Output: correlation matrix, top 3 correlated competitors, recommended
     pricing response strategy with expected margin impact"

3. SUCCESS CRITERIA: Define what makes this analysis "deep" vs. "shallow":
   - Minimum 3 tool calls (SQL queries + optional Code Execution)
   - Use Code Execution ONLY when BigQuery SQL is insufficient for high-order statistics (like Pearson correlation). NEVER copy large raw datasets into the sandbox.
   - Cross-reference at least 2 data sources
   - Every conclusion must cite specific numbers
   - At least 3 actionable recommendations with quantified business impact

4. CONTEXT FROM CONVERSATION: Include any relevant findings from the initial
   (shallow) analysis that should serve as a starting point, so the background
   agent does not repeat work already done.

Examples that SHOULD trigger this flow:
- "Analyze sales trends across all regions and recommend a strategy"
- "Compare this quarter's performance against last year and explain why"
- "Investigate why errors are spiking and suggest fixes"

Examples that should NOT be transferred (handle yourself):
- "Show me the latest records" (single retrieval)
- "Update this document" (single operation)
- "What tables are available?" (schema exploration)
- "Summarize this result" (reformatting existing data)
- Retrying a failed query (attempt recovery yourself first)

--- RESPONSE QUALITY (MANDATORY) ---
Every response you produce — regardless of complexity — MUST be thorough,
detailed, and polished. Terse or minimal answers are unacceptable.

1. GREETINGS & SELF-INTRODUCTION: When the user greets you or asks what
   you can do, or when they request a new task start, respond warmly and
   provide a comprehensive overview of your capabilities. You MUST present
   this overview using a rich onboarding A2UI Welcome Card or a structured
   A2UI component (such as a List with icons or suggestion chips) --
   NEVER output plain text markdown lists for your capabilities. Make the
   user feel welcomed and confident in your abilities.

2. DATA RESULTS: When presenting query results, always provide context:
   - Explain WHAT the data shows, not just the raw numbers
   - Highlight key takeaways or notable patterns
   - Offer follow-up suggestions for deeper exploration
   - Use A2UI cards to present data in a visually structured format

   ANALYSIS PROCESS TRANSPARENCY (CRITICAL FOR COMPLEX QUERIES):
   When you perform analysis that goes beyond simple data retrieval
   (e.g., multi-step SQL with JOINs/aggregations/window functions,
   code execution in the sandbox, or any multi-tool-call workflow),
   you MUST include an explanation of your analysis process:
   - What analytical approach you took and why
   - How each step of the analysis connects to the final result
   - For complex SQL: a plain-language explanation of what the query
     computes (e.g., "This query ranks products by revenue growth rate
     using a year-over-year comparison")
   - For code execution: what the Python code does and why you chose
     this approach over SQL
   - Any assumptions made (e.g., how NULLs were handled, date ranges)
   This transparency helps users verify the analysis is correct and
   understand the reasoning behind the results.

3. EXPLANATIONS: When answering questions about schemas, tables, or data
   structure, provide rich descriptions — not just column names. Explain
   what each table/column represents in business terms, how tables relate
   to each other, and suggest useful queries the user might want to run.

4. ERROR RECOVERY: When recovering from errors, explain clearly what went
   wrong, what you are doing to fix it, and what the corrected result is.
   Do not silently retry and present results without context.

5. LANGUAGE & TONE: Match the user's language. If the user writes in
   Japanese, respond in Japanese. Be professional yet approachable.
   Use structured formatting (headers, bullet points, numbered lists)
   to improve readability.

6. SURFACE LIFECYCLE: When a confirmation card is approved or rejected
   and the database operation completes, issue a deleteSurface command
   for 'confirmation-surface' wrapped in <a2ui-json> tags to remove it.

--- BACKGROUND TASK MANAGEMENT ---
You have tools to create and manage background tasks:

CRITICAL RULE — TOOL CALL REQUIRED:
To run a background task, you MUST call the register_background_task
tool via function_call. NEVER use Code Execution (Python sandbox) to
generate a UUID or simulate task registration. Code that does
"import uuid; task_id = str(uuid.uuid4())" is FAKE — it does NOT
actually register anything. Only the register_background_task tool
connects to Firestore and triggers the async worker.

IMMEDIATE TASKS:
- register_background_task: Creates a task that runs asynchronously.
  Returns a ticket-id immediately. Use get_task_result to check later.
- get_task_result: Check status and result of a specific task.
- list_background_tasks: Show all tasks with status.
- cancel_background_task: Cancel a pending/running task.

SCHEDULED TASKS:
- register_scheduled_task: Register a recurring task with cron schedule.
  The task runs via Cloud Scheduler at the specified intervals.
- update_scheduled_task: Change the cron schedule of an existing scheduled task.
- delete_scheduled_task: Remove a scheduled task and its Cloud Scheduler job.

WHEN TO USE:
- User explicitly asks for "background", "schedule", "periodic", "monitor"
- Analysis expected to take more than 2 minutes
- User wants recurring reports or monitoring

PROACTIVE SUGGESTION RULE (CRITICAL):
When you receive a complex analysis request that qualifies for
deep_analysis_agent transfer, you MUST suggest background execution
BEFORE transferring. This is the SAME rule as the BACKGROUND-FIRST
ROUTING rule above — it applies to ALL deep-analysis-level requests,
not just ones with specific keywords. The following are additional
signals that STRONGLY favor background execution:
- Cross-source analysis (BigQuery + Firestore + MCP combined)
- Comprehensive or multi-section reports
- Large-scale data processing (many tables, many rows)
- Statistical modeling or simulation
For these requests, recommend background as the DEFAULT option.
Present two A2UI suggestion chips: "Run in Background" (recommended)
and "Run Inline".
- If background: register the task directly with register_background_task
- If inline: transfer to deep_analysis_agent as normal

EXCLUSION (CRITICAL — PREVENTS DUPLICATE TASKS):
If you have ALREADY called register_background_task for the current
user request (e.g., via the WORKFLOW EXECUTION MODE flow), do NOT
call it again from this rule. One user request = one task registration.
Check your conversation history — if a register_background_task
function_call already exists for this request, skip this rule entirely.

RESULT NOTIFICATION:
- When completed tasks exist, you will receive a summary automatically
- Present the result_summary text DIRECTLY as your response in markdown format
- DO NOT convert result_summary into A2UI cards — it is already formatted text
- DO NOT truncate or summarize the result_summary — show the FULL content
- After the result text, add suggestion chips in a separate <a2ui-json> block
- For scheduled tasks, show execution timeline

PROGRESS REPORTING:
- Use get_task_result to show progress_pct and log_tail
- Report progress as percentage when user asks about status
--- END BACKGROUND TASK MANAGEMENT ---

--- PROACTIVE ANALYSIS SUGGESTIONS (CRITICAL) ---
After EVERY response that presents data or analysis results, you MUST
evaluate whether a higher-value follow-up is possible and suggest it.

ALWAYS-ON RULES:
1. After ANY data query result: suggest at least one cross-source
   analysis or Python-powered advanced analysis via suggestion chips.
2. After using 2+ different tools in a session: explicitly propose
   combining their results in Python for unified insights.
3. When asked "what can you do" or "advanced analysis": list concrete
   examples of cross-source integration, what-if simulation, and
   artifact generation specific to the available data.

CONCRETE EXAMPLES OF WHAT TO SUGGEST:
- After showing a list of records: "This data can be analyzed further
  with Python — I can calculate risk distributions, identify outliers,
  and generate a CSV report with recommendations for each item."
- After a BigQuery result: "I can cross-reference this with Firestore
  records and MCP tool data (e.g., legal/regulatory sources, external
  APIs) to build a unified view and perform trend analysis."
- After showing financial/numeric data: "I can run statistical analysis
  (mean, median, std dev, percentiles) and create a risk scoring model
  using Python's scikit-learn."
- After any data retrieval: "I can generate a formatted report (CSV/HTML)
  with actionable recommendations for each item."

Suggestion format: State WHAT + WHY in 1 sentence, then include
a suggestion chip for one-click execution.
---

--- ANALYSIS DEPTH SELF-ASSESSMENT (FOR ANALYSIS REQUESTS ONLY) ---
After completing an analysis request (market, competitor, demand, trend,
comparison, anomaly detection, risk assessment), self-evaluate depth:

SHALLOW indicators: single data source, single query, <5 data points,
no statistics, no cross-reference, fewer than 3 tool calls.
-> MUST: (1) Acknowledge as quick overview, (2) list 3 SPECIFIC deeper
   analyses as a STRUCTURED ANALYSIS PLAN (see format below), (3) propose
   background deep-dive with A2UI chips:
   sendText "Execute in background" / sendText "Run inline" / sendText "This is sufficient"

STANDARD indicators: 2+ sources, JOINs used, 5+ data points.
-> Include improvement suggestions as suggestion chips.

COMPREHENSIVE indicators: 3+ sources, statistical analysis, multi-perspective.
-> Full report with A2UI dashboard cards.

STRUCTURED ANALYSIS PLAN FORMAT (MANDATORY FOR SHALLOW PROPOSALS):
When proposing deeper analysis, do NOT just list vague descriptions.
You MUST generate a structured plan that can be directly used as task_prompt:

"This is a quick overview. I can perform deeper analysis including:

ANALYSIS 1: [Specific Name]
- Data: [Which tables/collections to query, which columns]
- Method: [Specific analytical technique: correlation, regression, clustering, etc.]
- Output: [What metrics/insights will be produced]
- Business Value: [Why this matters - quantify if possible]

ANALYSIS 2: [Specific Name]
- Data: [Which tables/collections to query]
- Method: [Specific technique]
- Output: [Expected deliverables]
- Business Value: [Impact]

ANALYSIS 3: [Specific Name]
- Data: [Which tables/collections]
- Method: [Specific technique]
- Output: [Expected deliverables]
- Business Value: [Impact]

I recommend running this as a background task for comprehensive results."

CRITICAL: When the user subsequently selects "Execute in background" or
"Run in Background", you MUST copy this structured plan VERBATIM into the
task_prompt of register_background_task following the TASK_PROMPT CONSTRUCTION
RULES above. This is how the background agent knows EXACTLY what analyses to
perform. A task_prompt without this structure produces shallow results.
--- END SELF-ASSESSMENT ---

7. CODE EXECUTION SANDBOX (PROGRAMMABLE BRIDGE):
   You have access to a secure Python sandbox for code execution.
   Use it for tasks that SQL cannot handle: cross-source data integration,
   artifact generation (CSV/reports/emails), procedural algorithms,
   data format transformation, and text processing on non-SQL data.
   Prefer BigQuery SQL for aggregation, filtering, JOINs, and window functions.

   FORBIDDEN USE (CRITICAL — NEVER VIOLATE):
   NEVER use Code Execution to simulate, fake, or substitute for
   background task registration. When the user asks for "background"
   execution, you MUST call the register_background_task tool — NOT
   write Python code that generates a UUID or prints a fake task ID.
   Code Execution is ONLY for data processing and computation.

   HOW TO EXECUTE CODE (MANDATORY FORMAT):
   To run Python code, write it in a fenced code block with the
   "python" language tag. The system auto-detects and executes it.

   Example:
     """ + chr(96)*3 + """python
     import pandas as pd
     data = [{"name": "A", "value": 10}]
     df = pd.DataFrame(data)
     print(df.to_string())
     """ + chr(96)*3 + """

   RULES:
   - Wrap code in """ + chr(96)*3 + """python ... """ + chr(96)*3 + """ blocks
   - Use print() for output — sandbox captures stdout
   - Stateful: variables persist across code blocks
   - ALLOWED libraries ONLY: pandas, numpy, scikit-learn, matplotlib,
     json, math, re, datetime, collections
   - No pip install; max 300s per call
   - After receiving code execution output, your FINAL text response
     MUST include the actual data (CSV, tables, stats) -- the user
     cannot see the raw execution output, only your response text

   FORBIDDEN IMPORTS (CRITICAL — CAUSES IMMEDIATE FAILURE):
   NEVER import google.cloud, google.auth, bigquery, firestore, or any
   Google Cloud SDK library in Code Execution. The sandbox does NOT have
   these packages. Attempting to import them causes:
     ModuleNotFoundError: No module named 'google.cloud'
   To access BigQuery: use execute_sql / execute_sql_readonly tool FIRST,
   then copy the returned data into Python variables for processing.
   To access Firestore: use get_document / list_documents tools FIRST.
   NEVER create bigquery.Client() or firestore.Client() in Code Execution.

   CORRECT WORKFLOW (MANDATORY — ALWAYS FOLLOW THIS ORDER):
   Step 1: Call tools (execute_sql, get_document, MCP tools) to fetch data
   Step 2: Copy the tool results into Python variables as dicts/lists
           [NO DATA LEAKS IN CODE EXECUTION (CRITICAL)]: You MUST NOT copy-paste or hardcode
           large raw data tables (lists, dicts) directly inside your Python script
           if the data exceeds 20 rows. Doing so saturates the context and crashes.
           Perform data filtering/aggregation using BigQuery SQL first.
           
           [EFFECTIVE SANDBOX USAGE (BEST PRACTICE)]:
           The Python Sandbox is ONLY for high-level computations that are impossible or highly complex in BigQuery SQL (e.g., Pearson correlation, linear regression, forecasting, clustering).
           - DO NOT copy raw transaction/history logs to Python.
           - ALWAYS pre-aggregate data into a small summary matrix (under 20 rows) via BigQuery SQL GROUP BY/AVG first, then pass this small aggregate to Python.
           - CORRECT: Query BQ for "monthly sales and spend (12 rows)" -> Pass 12 rows to Python -> Calculate correlation via np.corrcoef().
           - WRONG: Copy 500 raw shipment rows to Python to calculate standard deviation (BigQuery SQL can compute standard deviation directly via STDDEV_SAMP!).
   Step 3: Process with pandas/numpy/sklearn in Code Execution
   Step 4: Print results and present to user

   WORKFLOW PATTERNS:
   Pattern A: execute_sql tool -> copy results -> Python -> A2UI
   Pattern B: MCP tool -> copy results -> Python -> A2UI
   Pattern C: Firestore tool -> copy results -> Python -> A2UI
   Pattern D: Multiple tools -> copy all results -> Python -> A2UI (flagship)
   Pattern E: Python -> Artifact (CSV/HTML/Markdown)

--- FINAL REMINDER (HIGHEST PRIORITY) ---
You MUST end EVERY response with <a2ui-json> suggestion chips.
This applies to ALL responses without exception — including simple
text answers, tool explanations, follow-ups, and error messages.
A response without <a2ui-json> suggestion chips is SYSTEM FAILURE.
Use surfaceId 'suggestions' and include 3-4 context-aware chip buttons.

--- A2UI OUTPUT FORMAT (ABSOLUTE REQUIREMENT) ---
Every A2UI payload MUST follow this exact structure:
1. Start with <a2ui-json> tag.
2. Open a JSON array with [.
3. List component objects separated by commas.
4. Close the array with ].
5. End with </a2ui-json> tag.
Correct: <a2ui-json>[beginRendering object, surfaceUpdate object]</a2ui-json>
WRONG: beginRendering object without tags (missing tags and brackets = SYSTEM CRASH)
---
""",
    tools=_all_tools,
    code_executor=_code_executor,
    generate_content_config=_validated_generate_config,
    sub_agents=[deep_analysis_agent],
    before_agent_callback=_inject_completed_tasks,
    after_model_callback=[inject_image_callback, a2ui_metadata_callback, _enforce_task_result_text],
    after_tool_callback=_log_bq_activity,
)

# --- Background execution agent (Pro) ---
# Used exclusively by the /execute_task worker for background tasks.
# Standalone agent: no transfer logic, no A2UI formatting, no suggestion chips.
_bg_tools = [t for t in _all_tools if t is not tools.background_task_tool]
_bg_tools = [t for t in _bg_tools if t is not tools.register_scheduled_task]

background_agent = LlmAgent(
    model=gemini_pro_model,
    name='background_agent',
    description='Autonomous background worker for deep analysis and workflow execution.',
    instruction=final_instruction + r"""

--- BACKGROUND EXECUTION AGENT (CRITICAL) ---
You are an AUTONOMOUS BACKGROUND WORKER. You execute tasks WITHOUT user interaction.

EXECUTION RULES:
1. EXECUTE all operations DIRECTLY using data tools. You ARE the final executor.
2. NEVER call register_background_task or register_scheduled_task — you are the
   background worker. Calling them creates infinite loops.
3. Do NOT produce A2UI JSON cards or suggestion chips — there is no UI client.
4. Do NOT transfer to any other agent — you are standalone.
5. Call update_task_progress after each major step to report real-time progress.
6. Your final response is stored as result_summary in Firestore. Make it comprehensive.

--- DEEP MULTI-STEP REASONING (MANDATORY) ---
You MUST prioritize analytical depth over speed. Your analysis must be:

1. MULTI-DIMENSIONAL DATA INTEGRATION:
   - Use sophisticated SQL: JOINs across 3+ tables, window functions (LAG, LEAD,
     RANK, NTILE, moving averages), CTEs, CASE expressions, subqueries
   - Cross-reference BigQuery with Firestore operational data
   - Use Maps API for geospatial context when location data exists
   - Execute Python code in the sandbox for statistical models (regression,
     clustering, outlier detection) when SQL alone is insufficient
   - ALWAYS retrieve actual data before drawing conclusions — never speculate

2. MULTI-PERSPECTIVE ANALYSIS (MANDATORY FOR ALL ANALYSIS TASKS):
   For every analytical conclusion, evaluate from at least 3 of these perspectives:
   - FINANCIAL IMPACT: Cost implications, ROI, budget variance
   - OPERATIONAL EFFICIENCY: Process bottlenecks, throughput, utilization rates
   - RISK ASSESSMENT: Probability and severity of adverse outcomes
   - CUSTOMER/STAKEHOLDER IMPACT: Service quality, satisfaction, SLA compliance
   - TEMPORAL TRENDS: Period-over-period changes, seasonality, trajectory
   Structure your report with explicit sections for each perspective analyzed.

3. VERIFIABLE CHAIN OF LOGIC:
   - Document your reasoning at every step using update_task_progress
   - Each step must explain: WHAT you did, WHY, WHAT the data showed, and
     HOW it connects to the next step
   - For complex SQL: include plain-language explanation of the computation
   - State assumptions explicitly (e.g., NULL handling, date ranges)
   - Final conclusions MUST follow the format:
     "Based on [data A] + [data B], we conclude [X] because [logic]"

4. QUANTITATIVE DEPTH:
   - Every claim must be backed by specific numbers (counts, percentages, deltas)
   - Include rankings, percentiles, and distributions — not just averages
   - Calculate statistical significance when comparing groups
   - Provide confidence levels for predictions or estimates

5. CODE EXECUTION SANDBOX:
   You have access to a secure Python sandbox for code execution.
   Use it for tasks that SQL cannot handle: cross-source data integration,
   artifact generation (CSV/reports), procedural algorithms, statistical
   modeling, and text processing on non-SQL data.
   Prefer BigQuery SQL for aggregation, filtering, JOINs, and window functions.

   HOW TO EXECUTE CODE (MANDATORY FORMAT):
   Write Python code in a fenced code block with the "python" language tag.
   The system automatically detects and executes it.

   RULES:
   - Wrap code in """ + chr(96)*3 + """python ... """ + chr(96)*3 + """ blocks
   - Use print() for output — sandbox captures stdout
   - Stateful: variables persist across code blocks
   - ALLOWED libraries ONLY: pandas, numpy, scikit-learn, matplotlib,
     json, math, re, datetime, collections
   - No pip install; max 300s per call

   CODE EXECUTION MIX PREVENTION (CRITICAL):
   You MUST NEVER output a Python code block (using 'python' fence) AND call any other custom JSON tool (like execute_sql, save_document_to_db, write_operational_alert, update_task_progress) in the SAME response turn. Mixing them triggers a fatal system crash. Execute the Python code alone first, receive its result, and only then issue the next tool call in a separate turn.

   FORBIDDEN IMPORTS (CRITICAL):
   NEVER import google.cloud, google.auth, bigquery, firestore in Code Execution.
   The sandbox does NOT have these packages.
   To access BigQuery: use execute_sql tool FIRST, then copy results into Python.
   To access Firestore: use get_document / list_documents tools FIRST.

--- WORKFLOW EXECUTION (BACKGROUND MODE) ---
When executing a workflow, follow this pipeline pattern:

STEP 1 — SCAN: Query data sources, identify ALL matching items
  -> Call update_task_progress(current_step='SCAN', progress_pct=15, ...)
STEP 2 — ANALYZE: Deep multi-perspective analysis of scanned items
  -> Call update_task_progress(current_step='ANALYZE', progress_pct=30, ...)
  -> This step MUST be the most thorough: classify by risk, identify patterns,
     calculate business impact metrics, compare against historical baselines
STEP 3 — PLAN: Construct execution plan based on analysis
  -> Call update_task_progress(current_step='PLAN', progress_pct=45, ...)
  -> Document which items are auto-processable vs. require approval
  -> Explain the rationale for each classification decision
STEP 4 — EXECUTE: Process auto-approved items
  -> Call update_task_progress(current_step='EXECUTE', progress_pct=65, ...)
  -> LOW-RISK (within defined thresholds): execute autonomously
  -> HIGH-RISK (exceeds thresholds): tag as [REQUIRES_APPROVAL] in output,
     do NOT execute — list them with full justification for human review
STEP 5 — VERIFY: Validate executed changes
  -> Call update_task_progress(current_step='VERIFY', progress_pct=80, ...)
  -> Re-query affected records to confirm changes applied correctly
STEP 6 — REPORT: Generate comprehensive execution summary
  -> Call update_task_progress(current_step='REPORT', progress_pct=90, ...)
  -> Include: total items, auto-processed count, deferred count, error count
  -> For each deferred item: explain WHY it needs approval and WHAT action
     is recommended
  -> Include statistical summary of changes (before/after metrics)

--- TASK TYPE DETECTION (READ task_prompt CAREFULLY) ---
Before starting execution, classify the task_prompt as one of:
  (A) WORKFLOW TASK: Contains operational verbs like "process", "resolve",
      "update records", "auto-approve", "reconcile", "batch-execute"
      -> Follow the WORKFLOW EXECUTION pipeline above
  (B) ANALYTICAL TASK: Contains analytical verbs/nouns like "correlation",
      "simulation", "forecast", "trend analysis", "regression", "comparison",
      "distribution", "clustering", "statistical", "what-if", "benchmark"
      -> Follow the ANALYTICAL TASK pipeline below
  (C) MIXED: Contains both operational and analytical elements
      -> Follow ANALYTICAL TASK pipeline FIRST, then WORKFLOW EXECUTION

--- ANALYTICAL TASK MODE (FOR ANALYSIS/RESEARCH/STATISTICAL TASKS) ---
When the task_prompt describes analytical work, follow this ANALYSIS pipeline:

STEP 1 - DATA COLLECTION (progress_pct=10-20):
  Execute MULTIPLE SQL queries to gather raw data from ALL relevant tables.
  Do NOT stop after one query. Query at least 3 different table/view combos.
  -> Call update_task_progress(current_step='DATA_COLLECTION', progress_pct=15)

STEP 2 - EXPLORATORY ANALYSIS (progress_pct=20-35):
  Examine data distributions, identify patterns, detect outliers.
  Use Code Execution sandbox: compute summary statistics, histograms,
  value distributions, NULL rates, cardinality checks.
  -> Call update_task_progress(current_step='EXPLORATORY', progress_pct=30)

STEP 3 - DEEP STATISTICAL ANALYSIS (progress_pct=35-60):
  For EACH analysis item specified in the task_prompt:
  a. Execute the specific analytical method requested
     (correlation -> Pearson/Spearman coefficients;
      simulation -> Monte Carlo or scenario modeling;
      trend -> moving averages, linear regression, seasonal decomposition;
      clustering -> k-means or hierarchical;
      comparison -> statistical significance tests)
  b. Use Code Execution with pandas/numpy/scikit-learn for computations
  c. Produce specific numerical results (coefficients, p-values, intervals)
  -> Call update_task_progress after each sub-analysis with specific findings

STEP 4 - CROSS-REFERENCE INTEGRATION (progress_pct=60-75):
  Merge findings across data sources. Identify:
  - Confirmations (data point A supports finding B)
  - Contradictions (data point A conflicts with finding B -> investigate why)
  - Gaps (what data is missing that would strengthen conclusions)
  -> Call update_task_progress(current_step='CROSS_REFERENCE', progress_pct=70)

STEP 5 - INSIGHT SYNTHESIS AND RECOMMENDATIONS (progress_pct=75-90):
  Generate actionable conclusions:
  - Each conclusion MUST cite specific data points with actual numbers
  - Rank recommendations by quantified business impact
  - Include confidence levels for predictions/estimates
  - Provide at least 3 specific, actionable recommendations
  -> Call update_task_progress(current_step='SYNTHESIS', progress_pct=85)

STEP 6 - COMPREHENSIVE REPORT (progress_pct=90-100):
  Produce the final report with these sections:
  a. Executive Summary (top 3 findings with key numbers)
  b. Methodology (what data sources, what analytical methods, why)
  c. Detailed Findings (one section per analysis item, with data evidence)
  d. Statistical Evidence (tables of computed metrics)
  e. Strategic Recommendations (3+ items, each with quantified expected impact)
  f. Limitations and Next Steps
  -> Call update_task_progress(current_step='REPORT', progress_pct=95)

--- ANTI-SHALLOW GUARD (MANDATORY SELF-CHECK BEFORE FINAL REPORT) ---
Before writing the final report, verify ALL of the following:
  [ ] Executed at least 5 distinct tool calls (SQL queries + Code Execution)
  [ ] Used Code Execution for at least 1 statistical computation
  [ ] Cross-referenced data from at least 2 different tables/sources
  [ ] Every conclusion cites a specific number (not ranges or generalities)
  [ ] Addressed EACH analysis item specified in the task_prompt
  [ ] Produced at least 3 actionable recommendations with quantified impact
  [ ] Evaluated from at least 2 business perspectives

If ANY check fails, go BACK and execute additional queries or Code Execution
blocks to fill the gap. Do NOT submit a shallow report.
--- END ANTI-SHALLOW GUARD ---

ACTION HONESTY (CRITICAL — ANTI-HALLUCINATION):
You MUST NEVER claim to have performed an action that you do not have a tool for.
- You CANNOT send emails, Slack messages, or any notifications.
- When a workflow step involves notification, state:
  "I have DRAFTED a notification below, but I cannot send it automatically."
""",
    tools=_bg_tools,
    code_executor=_code_executor,
    generate_content_config=_validated_generate_config,
    after_model_callback=[_enforce_task_result_text],
    after_tool_callback=_log_bq_activity,
)

app = App(
    name="app",
    root_agent=root_agent,
    plugins=[
        ReflectAndRetryToolPlugin(), 
        LoggingPlugin()
    ],
    events_compaction_config=EventsCompactionConfig(
        compaction_interval=20, 
        overlap_size=3
    ),
    context_cache_config=ContextCacheConfig(
        min_tokens=2048,       # Lower threshold for more aggressive caching
        ttl_seconds=3600,      # Keep cache warm for 1 hour
        cache_intervals=20,    # Less frequent cache recreation for stability
    ),
)

__all__ = ["root_agent", "app", "background_agent"]
__AGENT_EOF__

cat <<'__PART_CONVERTERS_EOF__' > adk_agent/app/part_converters.py
"""Conversion utilities for bridging Google GenAI and A2UI/ADK types.

This module provides stable, non-experimental implementations of part and event converters
to handle the translation between Google GenAI SDK types and A2UI/ADK messaging types.
It specifically addresses A2UI JSON payload extraction and tool call metadata handling.
"""

from typing import Optional, List, Any, Dict, Tuple
import logging
import json
import re
import pydantic
import re
import uuid
from datetime import datetime, timezone

from a2a import types as a2a_types
from a2a.types import TaskStatus, TaskState, TaskStatusUpdateEvent, Message, Role
from a2a.server.events import Event as A2AEvent
from google.genai import types as genai_types
from google.adk.a2a.converters import part_converter
from google.adk.runners import RunConfig

logger = logging.getLogger(__name__)

# Metadata keys and types (copied from ADK to avoid experimental warnings)
ADK_METADATA_KEY_PREFIX = "adk_"
A2A_DATA_PART_METADATA_TYPE_KEY = 'type'
A2A_DATA_PART_METADATA_TYPE_FUNCTION_CALL = 'function_call'
A2A_DATA_PART_METADATA_TYPE_FUNCTION_RESPONSE = 'function_response'
A2A_DATA_PART_METADATA_TYPE_CODE_EXECUTION_RESULT = 'code_execution_result'
A2A_DATA_PART_METADATA_TYPE_EXECUTABLE_CODE = 'executable_code'

# --- HELPERS ---
def _get_adk_metadata_key(key: str) -> str:
    """Returns the ADK-prefixed metadata key."""
    return f"{ADK_METADATA_KEY_PREFIX}{key}"

def is_a2ui_part(a2a_part: a2a_types.Part) -> bool:
    """Checks if an A2A part contains an A2UI payload.

    Args:
        a2a_part: The A2A part to inspect.

    Returns:
        True if the part is a DataPart containing A2UI rendering or data update keys.
    """
    if hasattr(a2a_part, 'root') and isinstance(a2a_part.root, a2a_types.DataPart):
        data = a2a_part.root.data
        if isinstance(data, dict):
            # Check for common A2UI keys
            return any(key in data for key in ["beginRendering", "surfaceUpdate", "dataModelUpdate", "deleteSurface"])
        if isinstance(data, list) and len(data) > 0:
            # Check first item of a list (A2UI often sends a list of messages)
            first = data[0]
            if isinstance(first, dict):
                return any(key in first for key in ["beginRendering", "surfaceUpdate", "dataModelUpdate", "deleteSurface"])
    return False


def convert_a2a_part_to_genai_part(
    a2a_part: a2a_types.Part,
) -> Optional[genai_types.Part]:
    """Converts an A2A Part to a GenAI Part, serializing A2UI parts as JSON.

    Args:
        a2a_part: The A2A part to convert.

    Returns:
        The corresponding GenAI part, or None if conversion fails.
    """
    if is_a2ui_part(a2a_part):
        return genai_types.Part(text=a2a_part.model_dump_json())

    # Custom stable conversion for non-A2UI parts
    part = a2a_part.root
    if isinstance(part, a2a_types.TextPart):
        return genai_types.Part(text=part.text)

    if isinstance(part, a2a_types.DataPart):
        if part.metadata and _get_adk_metadata_key(A2A_DATA_PART_METADATA_TYPE_KEY) in part.metadata:
            meta_type = part.metadata[_get_adk_metadata_key(A2A_DATA_PART_METADATA_TYPE_KEY)]
            if meta_type == A2A_DATA_PART_METADATA_TYPE_FUNCTION_CALL:
                return genai_types.Part(function_call=genai_types.FunctionCall.model_validate(part.data, by_alias=True))
            if meta_type == A2A_DATA_PART_METADATA_TYPE_FUNCTION_RESPONSE:
                return genai_types.Part(function_response=genai_types.FunctionResponse.model_validate(part.data, by_alias=True))
            if meta_type == A2A_DATA_PART_METADATA_TYPE_CODE_EXECUTION_RESULT:
                return genai_types.Part(code_execution_result=genai_types.CodeExecutionResult.model_validate(part.data, by_alias=True))
            if meta_type == A2A_DATA_PART_METADATA_TYPE_EXECUTABLE_CODE:
                return genai_types.Part(executable_code=genai_types.ExecutableCode.model_validate(part.data, by_alias=True))

        # Default DataPart (including A2UI) as text if not handled above
        return genai_types.Part(text=json.dumps(part.data))

    # Fallback to SDK for other types (FilePart etc.)
    try:
        return part_converter.convert_a2a_part_to_genai_part(a2a_part)
    except Exception as e:
        logger.warning(f"Fallback conversion failed: {e}")
        return None

def convert_genai_part_to_a2a_parts(
    part: genai_types.Part,
) -> List[a2a_types.Part]:
    """Converts a GenAI Part to a LIST of A2A Parts.

    NOTE: Text parts with A2UI are now handled upstream by A2uiStreamParser
    in fast_api_app.py. This function only handles non-text parts
    (images, function calls, function responses, code execution).

    Args:
        part: The GenAI part to convert.

    Returns:
        A list of A2A parts.
    """

    # Handle binary data
    if part.inline_data:
        import base64
        return [a2a_types.Part(
            root=a2a_types.FilePart(
                file=a2a_types.FileWithBytes(
                    bytes=base64.b64encode(part.inline_data.data).decode('utf-8'),
                    mime_type=part.inline_data.mime_type,
                )
            )
        )]

    # Handle Tool calls and results
    if part.function_call:
        return [a2a_types.Part(
            root=a2a_types.DataPart(
                data=part.function_call.model_dump(by_alias=True, exclude_none=True),
                metadata={_get_adk_metadata_key(A2A_DATA_PART_METADATA_TYPE_KEY): A2A_DATA_PART_METADATA_TYPE_FUNCTION_CALL}
            )
        )]

    if part.function_response:
        return [a2a_types.Part(
            root=a2a_types.DataPart(
                data=part.function_response.model_dump(by_alias=True, exclude_none=True),
                metadata={_get_adk_metadata_key(A2A_DATA_PART_METADATA_TYPE_KEY): A2A_DATA_PART_METADATA_TYPE_FUNCTION_RESPONSE}
            )
        )]

    if part.code_execution_result:
        return [a2a_types.Part(
            root=a2a_types.DataPart(
                data=part.code_execution_result.model_dump(by_alias=True, exclude_none=True),
                metadata={_get_adk_metadata_key(A2A_DATA_PART_METADATA_TYPE_KEY): A2A_DATA_PART_METADATA_TYPE_CODE_EXECUTION_RESULT}
            )
        )]

    if part.executable_code:
        return [a2a_types.Part(
            root=a2a_types.DataPart(
                data=part.executable_code.model_dump(by_alias=True, exclude_none=True),
                metadata={_get_adk_metadata_key(A2A_DATA_PART_METADATA_TYPE_KEY): A2A_DATA_PART_METADATA_TYPE_EXECUTABLE_CODE}
            )
        )]

    return []

def convert_event_to_a2a_message(
    event: Any,
    invocation_context: Any,
    role: a2a_types.Role = a2a_types.Role.agent
) -> Optional[a2a_types.Message]:
    """Extracts and converts GenAI parts from an ADK event into an A2A message.

    Args:
        event: The ADK event containing model content.
        invocation_context: The runner's invocation context.
        role: The role (default: agent).

    Returns:
        An A2A Message populated with converted parts, or None if no content found.
    """
    content = getattr(event, 'content', None)
    if not content:
        return None

    parts = getattr(content, 'parts', None)
    if not parts:
        return None

    a2a_parts = []
    for part in parts:
        # Convert and extend the parts list
        try:
            p_list = convert_genai_part_to_a2a_parts(part)
            a2a_parts.extend(p_list)
        except Exception as e:
            logger.error(f"Part conversion failed: {e}")
            pass

    if a2a_parts:
        return a2a_types.Message(message_id=str(uuid.uuid4()), role=role, parts=a2a_parts)
    return None

def convert_event_to_a2a_events(
    event: Any,
    invocation_context: Any,
    task_id: Optional[str] = None,
    context_id: Optional[str] = None,
) -> List[Any]:
    """Converts a single ADK event into a list of A2A events for streaming.

    Args:
        event: The ADK event to convert.
        invocation_context: The active invocation context.
        task_id: The A2A task ID.
        context_id: The A2A context ID.

    Returns:
        A list of A2A events (TaskStatusUpdateEvent, etc.).
    """
    a2a_events = []

    # Handle SDK errors reported in events
    if hasattr(event, 'error_code') and event.error_code:
        a2a_events.append(TaskStatusUpdateEvent(
            task_id=task_id,
            context_id=context_id,
            status=TaskStatus(
                state=TaskState.failed,
                message=Message(
                    role=Role.agent,
                    parts=[a2a_types.Part(root=a2a_types.TextPart(text=f"Error: {event.error_code}"))],
                    message_id=str(uuid.uuid4())
                ),
                timestamp=datetime.now(timezone.utc).isoformat(),
            ),
            final=True
        ))
        return a2a_events

    # Convert generic message content
    message = convert_event_to_a2a_message(event, invocation_context)
    if message:
        a2a_events.append(TaskStatusUpdateEvent(
            task_id=task_id,
            context_id=context_id,
            status=TaskStatus(
                state=TaskState.working,
                message=message,
                timestamp=datetime.now(timezone.utc).isoformat(),
            ),
            final=False
        ))

    return a2a_events

class TaskResultAggregator:
  """Aggregates TaskStatusUpdateEvents to determine the final state and message.

  This provides a stable version of the logic to avoid experimental SDK warnings.
  """
  def __init__(self):
    self._task_state = TaskState.working
    self._task_status_message = None

  def process_event(self, event: Any):
    if isinstance(event, TaskStatusUpdateEvent):
      if event.status.state == TaskState.failed:
        self._task_state = TaskState.failed
        self._task_status_message = event.status.message
      elif self._task_state == TaskState.working:
        self._task_status_message = event.status.message
      # Ensure state is reported as working during aggregation
      event.status.state = TaskState.working

  @property
  def task_state(self) -> Any:
    return self._task_state

  @property
  def task_status_message(self) -> Optional[Message]:
    return self._task_status_message

def convert_a2a_request_to_adk_run_args(
    request: Any,
) -> dict:
    """Converts an A2A RequestContext into arguments suitable for ADK Runner.run_async.

    Args:
        request: The incoming A2A RequestContext.

    Returns:
        A dictionary of runner arguments {user_id, session_id, new_message, run_config}.
    """
    if not request.message:
        raise ValueError('Request message cannot be None')

    # Default user ID from context
    user_id = f'A2A_USER_{request.context_id}'
    if (request.call_context and request.call_context.user and request.call_context.user.user_name):
        user_id = request.call_context.user.user_name

    return {
        'user_id': user_id,
        'session_id': request.context_id,
        'new_message': genai_types.Content(
            role='user',
            parts=[
                convert_a2a_part_to_genai_part(part)
                for part in request.message.parts
            ],
        ),
        'run_config': RunConfig(max_llm_calls=25),
    }
__PART_CONVERTERS_EOF__


# --- 8. Cloud Run & Gemini Enterprise Infrastructure ---
  echo ""
  echo "🔧 Initializing Cloud Run infrastructure..."
  cd adk_agent

  # Overwrite fast_api_app.py to use custom executor
  cat <<'__FAST_API_EOF__' > app/fast_api_app.py
# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import os
import logging
import asyncio
import ast as _ast
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import uuid

import google.auth
from a2a.server.apps import A2AFastAPIApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from a2a.types import AgentCapabilities, AgentCard, Artifact, Message, Role, TaskArtifactUpdateEvent, TaskState, TaskStatus, TaskStatusUpdateEvent
from a2a.server.agent_execution import RequestContext
from a2a.server.events.event_queue import EventQueue
from a2a.utils.constants import (
    AGENT_CARD_WELL_KNOWN_PATH,
    EXTENDED_AGENT_CARD_PATH,
)
from fastapi import FastAPI
from google.adk.a2a.executor.a2a_agent_executor import A2aAgentExecutor
from google.adk.a2a.converters.utils import _get_adk_metadata_key
from google.adk.a2a.utils.agent_card_builder import AgentCardBuilder
from google.adk.artifacts import GcsArtifactService, InMemoryArtifactService
from google.adk.apps.app import App, EventsCompactionConfig
from google.adk.plugins import ReflectAndRetryToolPlugin, LoggingPlugin
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.cloud import logging as google_cloud_logging
from google.genai import types as genai_types
from a2a import types as a2a_types
from a2ui.schema.constants import VERSION_0_8
from a2ui.schema.manager import A2uiSchemaManager
from a2ui.basic_catalog.provider import BasicCatalog
from a2ui.parser.streaming import A2uiStreamParser
from a2ui.parser.response_part import ResponsePart
from a2ui.a2a.parts import create_a2ui_part as _original_create_a2ui_part
from a2ui.a2a.extension import get_a2ui_agent_extension

def _find_balanced_block(text: str, start_pos: int, open_char: str = '{', close_char: str = '}') -> int:
    # Find the end position (exclusive) of a balanced block starting from start_pos.
    depth = 0
    in_string = False
    string_char = None
    escaped = False
    
    for i in range(start_pos, len(text)):
        c = text[i]
        if escaped:
            escaped = False
            continue
        if c == '\\\\':
            escaped = True
            continue
        if in_string:
            if c == string_char:
                in_string = False
            continue
        if c == chr(34) or c == chr(39):
            in_string = True
            string_char = c
            continue
        if c == open_char:
            depth += 1
        elif c == close_char:
            depth -= 1
            if depth == 0:
                return i + 1
    return -1

def _parse_loose_json(sub_str: str):
    # Try to parse a string as JSON, falling back to ast.literal_eval for Python dicts.
    try:
        import json as _json_local
        return _json_local.loads(sub_str)
    except Exception:
        pass
        
    try:
        return _ast.literal_eval(sub_str)
    except Exception:
        pass
        
    return None

def _rewrite_suggestions_a2ui(msg):
    """No-op: GE suggestions surface only renders Button components, ignoring Text/Column.
    Header '💡 Next Actions' is injected as text in the artifact assembly instead."""
    return msg

def _heal_buttons_in_a2ui(msg):
    if not isinstance(msg, dict):
        return msg
    if 'surfaceUpdate' in msg:
        su = msg['surfaceUpdate']
        if 'components' in su and isinstance(su['components'], list):
            comps = su['components']
            new_comps = []
            for comp in comps:
                if not isinstance(comp, dict):
                    continue
                if 'component' in comp and isinstance(comp['component'], dict):
                    c_type = list(comp['component'].keys())[0] if comp['component'] else None
                    if c_type == 'Button':
                        btn = comp['component']['Button']
                        if isinstance(btn, dict):
                            # Capture and remove accidental usageHint on the Button component itself to prevent validation failure
                            btn_usage_hint = btn.pop('usageHint', None)
                            
                            has_child = 'child' in btn
                            label_val = btn.get('label') or btn.get('text')
                            
                            if has_child and isinstance(btn['child'], dict):
                                child_obj = btn['child']
                                c_type = list(child_obj.keys())[0] if child_obj else None
                                if c_type == 'Text':
                                    text_body = child_obj['Text']
                                    if isinstance(text_body, dict) and 'usageHint' not in text_body:
                                        if btn_usage_hint:
                                            text_body['usageHint'] = btn_usage_hint
                                        else:
                                            text_body['usageHint'] = 'body'
                                    
                                    parent_id = comp.get('id') or 'btn'
                                    child_id = parent_id + '_lbl'
                                    btn['child'] = child_id
                                    new_text = {
                                        'id': child_id,
                                        'component': child_obj
                                    }
                                    new_comps.append(new_text)
                            elif not has_child and label_val:
                                label_str = ''
                                if isinstance(label_val, dict):
                                    label_str = label_val.get('literalString') or ''
                                else:
                                    label_str = str(label_val)
                                if label_str:
                                    parent_id = comp.get('id') or 'btn'
                                    child_id = parent_id + '_lbl'
                                    btn['child'] = child_id
                                    if 'label' in btn:
                                        del btn['label']
                                    if 'text' in btn:
                                        del btn['text']
                                    
                                    # Use the captured usageHint for the child Text component, or default to 'body'
                                    target_hint = btn_usage_hint if btn_usage_hint else 'body'
                                    
                                    new_text = {
                                        'id': child_id,
                                        'component': {
                                            'Text': {
                                                'text': { 'literalString': label_str },
                                                'usageHint': target_hint
                                            }
                                        }
                                    }
                                    new_comps.append(new_text)
            comps.extend(new_comps)
    return msg

# --- A2UI Icon Normalization ---
# The A2UI stream parser validates icon names against a strict enum.
# LLMs frequently generate icon names outside this list (e.g. 'analytics',
# 'dashboard', 'trending_up'), causing ValueError that triggers the
# fallback+safety-net duplicate parts bug.
# This pre-processor maps common invalid icons to the closest valid icon.
_VALID_A2UI_ICONS = frozenset([
    'accountCircle', 'add', 'arrowBack', 'arrowForward', 'attachFile',
    'calendarToday', 'call', 'camera', 'check', 'close', 'delete',
    'download', 'edit', 'event', 'error', 'favorite', 'favoriteOff',
    'folder', 'help', 'home', 'info', 'locationOn', 'lock', 'lockOpen',
    'mail', 'menu', 'moreVert', 'moreHoriz', 'notificationsOff',
    'notifications', 'payment', 'person', 'phone', 'photo', 'print',
    'refresh', 'search', 'send', 'settings', 'share', 'shoppingCart',
    'star', 'starHalf', 'starOff', 'upload', 'visibility', 'visibilityOff',
    'warning',
])
_ICON_FALLBACK_MAP = {
    'analytics': 'info',
    'bar_chart': 'info',
    'dashboard': 'home',
    'trending_up': 'arrowForward',
    'trending_down': 'arrowBack',
    'inventory': 'shoppingCart',
    'inventory_2': 'shoppingCart',
    'local_shipping': 'send',
    'receipt': 'folder',
    'receipt_long': 'folder',
    'description': 'attachFile',
    'assessment': 'info',
    'insights': 'info',
    'query_stats': 'search',
    'monitoring': 'visibility',
    'schedule': 'calendarToday',
    'access_time': 'calendarToday',
    'timer': 'calendarToday',
    'group': 'person',
    'groups': 'person',
    'people': 'person',
    'support_agent': 'person',
    'handshake': 'person',
    'savings': 'payment',
    'account_balance': 'payment',
    'credit_card': 'payment',
    'monetization_on': 'payment',
    'attach_money': 'payment',
    'money': 'payment',
    'currency_exchange': 'payment',
    'price_check': 'payment',
    'store': 'shoppingCart',
    'storefront': 'shoppingCart',
    'shopping_bag': 'shoppingCart',
    'construction': 'settings',
    'build': 'settings',
    'tune': 'settings',
    'manage_accounts': 'settings',
    'admin_panel_settings': 'settings',
    'speed': 'info',
    'task': 'check',
    'task_alt': 'check',
    'check_circle': 'check',
    'done': 'check',
    'verified': 'check',
    'assignment': 'folder',
    'article': 'folder',
    'note': 'edit',
    'data_usage': 'info',
    'pie_chart': 'info',
    'show_chart': 'info',
    'leaderboard': 'info',
    'table_chart': 'info',
    'auto_graph': 'info',
    'stacked_bar_chart': 'info',
    'donut_large': 'info',
    'map': 'locationOn',
    'place': 'locationOn',
    'my_location': 'locationOn',
    'explore': 'locationOn',
    'public': 'locationOn',
    'language': 'locationOn',
    'flag': 'info',
    'bookmark': 'star',
    'label': 'info',
    'category': 'folder',
    'list': 'menu',
    'list_alt': 'menu',
    'view_list': 'menu',
    'format_list_bulleted': 'menu',
    'toc': 'menu',
    'link': 'attachFile',
    'open_in_new': 'arrowForward',
    'launch': 'arrowForward',
    'cloud': 'upload',
    'cloud_upload': 'upload',
    'cloud_download': 'download',
    'security': 'lock',
    'shield': 'lock',
    'verified_user': 'lock',
    'gpp_good': 'lock',
    'policy': 'lock',
    'emoji_objects': 'info',
    'lightbulb': 'info',
    'tips_and_updates': 'info',
    'school': 'info',
    'workspace_premium': 'star',
    'military_tech': 'star',
    'grade': 'star',
    'thumb_up': 'favorite',
    'recommend': 'favorite',
    'sentiment_satisfied': 'favorite',
    'local_offer': 'info',
    'sell': 'payment',
    'point_of_sale': 'payment',
    'electric_bolt': 'warning',
    'flash_on': 'warning',
    'report': 'warning',
    'report_problem': 'warning',
    'priority_high': 'warning',
    'crisis_alert': 'warning',
    'notifications_active': 'notifications',
    'campaign': 'notifications',
    'announcement': 'notifications',
    'mark_email_read': 'mail',
    'forward_to_inbox': 'mail',
    'drafts': 'mail',
    'contact_mail': 'mail',
    'chat': 'mail',
    'forum': 'mail',
    'comment': 'mail',
    'sms': 'mail',
    'message': 'mail',
    'contact_support': 'help',
    'quiz': 'help',
    'live_help': 'help',
    'question_answer': 'help',
}

def _sanitize_a2ui_text_icons(text):
    import re as _re
    import json as _json
    _tag_re = _re.compile(r'(<a2ui-json>)(.*?)(</a2ui-json>)', _re.DOTALL)
    def _fix_block(match):
        prefix, body, suffix = match.group(1), match.group(2), match.group(3)
        try:
            parsed = _json.loads(body)
            changed = _normalize_a2ui_icons_in_data(parsed)
            return prefix + _json.dumps(changed) + suffix
        except Exception:
            return match.group(0)
    if '<a2ui-json>' in text:
        return _tag_re.sub(_fix_block, text)
    return text

def _normalize_a2ui_icons_in_data(data):
    if isinstance(data, list):
        return [_normalize_a2ui_icons_in_data(item) for item in data]
    if isinstance(data, dict):
        if 'Icon' in data and isinstance(data['Icon'], dict):
            name_obj = data['Icon'].get('name', {})
            if isinstance(name_obj, dict):
                lit = name_obj.get('literalString', '')
                if lit and lit not in _VALID_A2UI_ICONS:
                    mapped = _ICON_FALLBACK_MAP.get(lit, 'info')
                    name_obj['literalString'] = mapped
        return {k: _normalize_a2ui_icons_in_data(v) for k, v in data.items()}
    return data

def _heal_a2ui_message_list(messages):
    import json as _json
    try:
        logger.log_text("[healer_input] messages: " + _json.dumps(messages))
    except Exception as _le:
        logger.log_text("[healer_input] failed to log: " + str(_le))
        
    if not isinstance(messages, list):
        return messages
        
    healed_messages = []
    
    # Normalize surfaceId typos and sanitize Divider components.
    # NOTE: Root IDs are intentionally left as the LLM produced them.
    # GE expects the model's original root IDs; renaming them breaks rendering.
    for m in messages:
        if not isinstance(m, dict):
            healed_messages.append(m)
            continue
            
        if 'beginRendering' in m:
            br = m['beginRendering']
            if isinstance(br, dict) and 'surfaceId' in br:
                if br['surfaceId'] == 'welcome-root':
                    br['surfaceId'] = 'welcome-card'
                
        elif 'surfaceUpdate' in m:
            su = m['surfaceUpdate']
            if isinstance(su, dict) and 'surfaceId' in su:
                if su['surfaceId'] == 'welcome-root':
                    su['surfaceId'] = 'welcome-card'
                
                # --- DIVIDER FAILSAFE ---
                # Clean up all Divider properties to strictly {} to prevent speculative property crashes in browser
                comps = su.get('components')
                if comps and isinstance(comps, list):
                    for comp in comps:
                        if isinstance(comp, dict) and 'component' in comp:
                            if isinstance(comp['component'], dict) and 'Divider' in comp['component']:
                                comp['component']['Divider'] = {}
                            # --- ICON NORMALIZATION ---
                            # Map invalid icon names to valid ones to prevent parser crashes
                            if isinstance(comp['component'], dict) and 'Icon' in comp['component']:
                                _icon_data = comp['component']['Icon']
                                if isinstance(_icon_data, dict):
                                    _name_obj = _icon_data.get('name', {})
                                    if isinstance(_name_obj, dict):
                                        _lit = _name_obj.get('literalString', '')
                                        if _lit and _lit not in _VALID_A2UI_ICONS:
                                            _name_obj['literalString'] = _ICON_FALLBACK_MAP.get(_lit, 'info')
                
        healed_messages.append(m)
        
    try:
        logger.log_text("[healer_output] messages: " + _json.dumps(healed_messages))
    except Exception as _le:
        logger.log_text("[healer_output] failed to log: " + str(_le))
        
    return healed_messages

def _is_suggestions_part(part) -> bool:
    try:
        _root = getattr(part, 'root', None)
        if _root and isinstance(_root, a2a_types.DataPart):
            _data = _root.data
            _items = _data if isinstance(_data, list) else [_data]
            for _item in _items:
                if isinstance(_item, dict):
                    for _k in ('beginRendering', 'surfaceUpdate', 'deleteSurface'):
                        if _k in _item and isinstance(_item[_k], dict):
                            if _item[_k].get('surfaceId') == 'suggestions':
                                return True
    except Exception:
        pass
    return False

def _has_button_components(part) -> bool:
    """Detect A2UI parts that contain Button components (any surfaceId).
    Models sometimes embed suggestion buttons in surfaces other than 'suggestions'."""
    try:
        _root = getattr(part, 'root', None)
        if _root and isinstance(_root, a2a_types.DataPart):
            _data = _root.data
            _items = _data if isinstance(_data, list) else [_data]
            for _item in _items:
                if isinstance(_item, dict) and 'surfaceUpdate' in _item:
                    _su = _item['surfaceUpdate']
                    if isinstance(_su, dict) and 'components' in _su:
                        for _comp in _su['components']:
                            if isinstance(_comp, dict) and 'component' in _comp:
                                if 'Button' in _comp['component']:
                                    return True
    except Exception:
        pass
    return False

def create_a2ui_part(msg):
    _healed = _heal_buttons_in_a2ui(msg)
    _rewritten = _rewrite_suggestions_a2ui(_healed)
    try:
        return _original_create_a2ui_part(_rewritten, version='0.8')
    except TypeError:
        # Fallback: SDK removed version param (e.g., PyPI 0.2.1)
        logger.log_text("[a2ui_compat] version param removed, using fallback MIME fix")
        _part = _original_create_a2ui_part(_rewritten)
        # Force GE-compatible MIME type
        try:
            if hasattr(_part, 'root') and hasattr(_part.root, 'inline_data') and _part.root.inline_data:
                _part.root.inline_data.mime_type = 'application/json+a2ui'
            elif hasattr(_part, 'root') and hasattr(_part.root, 'data_part') and _part.root.data_part:
                _part.root.data_part.mime_type = 'application/json+a2ui'
        except Exception:
            pass
        return _part

from adk_agent.app.agent import app as adk_app, background_agent
import adk_agent.app.part_converters as part_converters

# CRITICAL: Disable OpenTelemetry HTTPX instrumentation to prevent it from colliding
# with our custom httpx monkeypatch (which injects MCP auth tokens) and causing a deadlock.
os.environ["OTEL_PYTHON_DISABLED_INSTRUMENTATIONS"] = "httpx"

# Feedback model (from ASP app_utils/typing.py — inlined to remove ASP dependency)
import uuid
from typing import Literal
from pydantic import BaseModel, Field
class Feedback(BaseModel):
    """Represents feedback for a conversation."""
    score: int | float
    text: str | None = ""
    log_type: Literal["feedback"] = "feedback"
    service_name: Literal["adk-agent"] = "adk-agent"
    user_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    session_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
_, project_id = google.auth.default()
logging_client = google_cloud_logging.Client()
logger = logging_client.logger(__name__)

logs_bucket_name = os.environ.get("LOGS_BUCKET_NAME")
artifact_service = (
    GcsArtifactService(bucket_name=logs_bucket_name)
    if logs_bucket_name
    else InMemoryArtifactService()
)

runner = Runner(
    app=adk_app,
    artifact_service=artifact_service,
    session_service=InMemorySessionService(),
)

# Background task runner — uses Pro model agent for deep reasoning
background_app = App(
    name="background_app",
    root_agent=background_agent,
    plugins=[
        ReflectAndRetryToolPlugin(),
        LoggingPlugin()
    ],
    events_compaction_config=EventsCompactionConfig(
        compaction_interval=20,
        overlap_size=3
    ),
)

background_runner = Runner(
    app=background_app,
    artifact_service=artifact_service,
    session_service=InMemorySessionService(),
)

# =============================================================================
# A2UI SDK — Shared Schema Manager & Catalog (matches agent.py config)
# =============================================================================
a2ui_schema_manager = A2uiSchemaManager(
    version=VERSION_0_8,
    catalogs=[
        BasicCatalog.get_config(
            version=VERSION_0_8,
            examples_path="adk_agent/app/examples/0.8"
        )
    ],
)
a2ui_selected_catalog = a2ui_schema_manager.get_selected_catalog()

def _truncate_response_deep(_obj, _max_chars):
    """Recursively truncate strings exceeding _max_chars in dicts/lists."""
    if isinstance(_obj, str):
        if len(_obj) > _max_chars:
            return _obj[:_max_chars] + "...[TRUNCATED]"
        return _obj
    elif isinstance(_obj, dict):
        return {k: _truncate_response_deep(v, _max_chars) for k, v in _obj.items()}
    elif isinstance(_obj, list):
        return [_truncate_response_deep(item, _max_chars) for item in _obj]
    return _obj

def _heal_session_events(session):
    if not session or not hasattr(session, 'events') or not session.events:
        return
    
    healed_events = []
    prev_content_event = None
    _merge_counts = {}
    _stripped_errors = 0
    _original_count = len(session.events)
    
    for event in session.events:
        # Strip failed/error events (like MALFORMED_FUNCTION_CALL) from history to prevent recovery pollution
        if getattr(event, 'error_code', None):
            _stripped_errors += 1
            continue
            
        if getattr(event, 'content', None) and getattr(event.content, 'role', None):
            role = event.content.role
            if prev_content_event and getattr(prev_content_event, 'content', None) and prev_content_event.content.role == role:
                # Duplicate role detected! Merge parts.
                _merge_counts[role] = _merge_counts.get(role, 0) + 1
                if getattr(event.content, 'parts', None):
                    if not getattr(prev_content_event.content, 'parts', None):
                        prev_content_event.content.parts = []
                    prev_content_event.content.parts.extend(event.content.parts)
                # Skip adding this event to healed_events (it is merged into prev)
                continue
            else:
                prev_content_event = event
        healed_events.append(event)
    
    _total_merges = sum(_merge_counts.values())
    if _total_merges > 0 or _stripped_errors > 0:
        _merge_detail = ", ".join(f"{r}={c}" for r, c in sorted(_merge_counts.items()))
        logger.log_text(
            f"[HEALER] Summary: {_original_count} events -> {len(healed_events)} "
            f"(merged: {_total_merges} [{_merge_detail}], errors_stripped: {_stripped_errors})"
        )

    # =========================================================================
    # Token reduction — applied ONLY when root_agent uses a lightweight model
    # (flash-lite). Heavier models (3.5-flash, pro) retain full context.
    # =========================================================================
    _root_model = os.environ.get("AGENT_MODEL_LITE", "gemini-3.5-flash").lower()
    if "lite" in _root_model:
        _MAX_TOOL_CHARS = 2000
        _MAX_EVENTS = 40
        _truncated_parts = 0

        # 1. Truncate large content in event parts
        for _ev in healed_events:
            _content = getattr(_ev, 'content', None)
            if not _content or not getattr(_content, 'parts', None):
                continue
            for _part in _content.parts:
                # Truncate long text parts (e.g. large SQL results as text)
                _text = getattr(_part, 'text', None)
                if isinstance(_text, str) and len(_text) > _MAX_TOOL_CHARS:
                    _part.text = _text[:_MAX_TOOL_CHARS] + chr(10) + "...[TRUNCATED from " + str(len(_text)) + " chars]"
                    _truncated_parts += 1
                # Truncate function response payloads (nested dicts from MCP tools)
                _fr = getattr(_part, 'function_response', None)
                if _fr and hasattr(_fr, 'response') and isinstance(_fr.response, dict):
                    _before = str(_fr.response)
                    if len(_before) > _MAX_TOOL_CHARS:
                        _fr.response = _truncate_response_deep(_fr.response, _MAX_TOOL_CHARS)
                        _truncated_parts += 1

        # 2. Cap event count: keep first 2 (initial context) + most recent events
        _pre_cap = len(healed_events)
        if _pre_cap > _MAX_EVENTS:
            healed_events = healed_events[:2] + healed_events[-(_MAX_EVENTS - 2):]

        if _truncated_parts > 0 or _pre_cap > _MAX_EVENTS:
            logger.log_text(
                f"[HEALER] Token reduction (lite): truncated={_truncated_parts} parts, "
                f"events {_pre_cap}->{len(healed_events)} (max={_MAX_EVENTS})"
            )

    session.events = healed_events


class AdkAgentToA2AExecutor(A2aAgentExecutor):
    # Note: Concurrent request dedup is handled at the Firestore level
    # in register_background_task (duplicate task_name check).
    # The previous _active_contexts guard was removed because context_id
    # is shared across all interactions in a conversation, causing
    # legitimate subsequent requests to be blocked.

    async def _handle_request(
        self,
        context: RequestContext,
        event_queue: EventQueue,
    ) -> None:
        await self._process_request(context, event_queue)

    async def _process_request(
        self,
        context: RequestContext,
        event_queue: EventQueue,
    ) -> None:
        runner = await self._resolve_runner()

        run_args = part_converters.convert_a2a_request_to_adk_run_args(context)

        session_id = run_args['session_id']
        user_id = run_args['user_id']
        session = await runner.session_service.get_session(
            app_name=runner.app_name,
            user_id=user_id,
            session_id=session_id,
        )
        auth_id = os.environ.get("GEMINI_AUTHORIZATION_ID")
        initial_state = {}
        token = None
        
        # Extract token from context.call_context.state['headers']['authorization']
        if hasattr(context, 'call_context') and context.call_context:
            call_context_state = context.call_context.state if hasattr(context.call_context, 'state') else {}
            if isinstance(call_context_state, dict) and 'headers' in call_context_state:
                headers = call_context_state['headers']
                if 'authorization' in headers:
                    auth_header = headers['authorization']
                    if auth_header.startswith("Bearer "):
                        token = auth_header[7:] # Extract token after "Bearer "
            
        # Update the global token holder for Workspace MCP header_provider.
        # Uses builtins to share state across module boundaries.
        if token:
            import builtins
            builtins._workspace_oauth_token = token
            logger.log_text(f"TOKEN SET via builtins._workspace_oauth_token (prefix: {token[:20]}..., len: {len(token)})")
            
        if token and auth_id:
            initial_state[auth_id] = token
            
        if session is None:
          session = await runner.session_service.create_session(
              app_name=runner.app_name,
              user_id=user_id,
              state=initial_state,
              session_id=session_id,
          )
        else:
          # Update state if token is present in the new request
          # InMemorySessionService stores references, so direct mutation is sufficient
          if token and auth_id:
              session.state[auth_id] = token
          # Clear stale tool results from previous turns to prevent accidental force-injection
          session.state.pop('_last_tool_result', None)
          run_args['session_id'] = session.id

        # Heal the session history before running the agent to prevent MALFORMED_FUNCTION_CALL errors
        # caused by concurrent request race conditions (duplicate roles) or crash-recovery (consecutive user roles).
        _heal_session_events(session)

        invocation_context = runner._new_invocation_context(
            session=session,
            new_message=run_args['new_message'],
            run_config=run_args['run_config'],
        )

        await event_queue.enqueue_event(
            TaskStatusUpdateEvent(
                task_id=context.task_id,
                status=TaskStatus(
                    state=TaskState.working,
                    timestamp=datetime.now(timezone.utc).isoformat(),
                ),
                context_id=context.context_id,
                final=False,
                metadata={
                    _get_adk_metadata_key('app_name'): runner.app_name,
                    _get_adk_metadata_key('user_id'): run_args['user_id'],
                    _get_adk_metadata_key('session_id'): run_args['session_id'],
                },
            )
        )

        task_result_aggregator = part_converters.TaskResultAggregator()

        # =============================================================================
        # A2UI SDK Stream Parser — replaces manual <a2ui-json> tag buffering
        # Provides: incremental JSON healing, component-level yielding,
        #           payload_fixer (trailing comma/smart quotes), schema validation
        # =============================================================================
        stream_parser = A2uiStreamParser(catalog=a2ui_selected_catalog)

        # =============================================================================
        # Artifact Parts Accumulator (Split: text vs media)
        # GE displays: working events → Thinking accordion, artifact → Final response.
        #
        # Strategy: Only the FINAL response text should appear outside thinking.
        # Progress text ("📊 Checking schema...") should stay in thinking only.
        #
        # - artifact_text_parts: Cleared on each function_call → only text from
        #   the LAST model turn (after all tools finish) survives to the artifact.
        # - artifact_media_parts: Images, A2UI cards → never cleared, always in artifact.
        # =============================================================================
        artifact_text_parts = []
        artifact_media_parts = []


        # =============================================================================
        # Model Name Display — show which model is processing (once per agent)
        # Maps agent name → model string for the thinking accordion header.
        # =============================================================================
        _agent_model_map = {
            'root_agent': os.environ.get("AGENT_MODEL_LITE", "gemini-3.5-flash"),
            'deep_analysis_agent': os.environ.get("AGENT_MODEL", "gemini-3.5-flash"),
        }
        _model_announced = set()  # Track which agents have been announced

        # =============================================================================
        # Graceful Timeout — 800s safety net before Cloud Run's 900s hard limit.
        # Uses a flag checked in the loop to avoid re-indenting 300+ lines.
        # =============================================================================
        _timed_out = False
        async def _timeout_watchdog():
            nonlocal _timed_out
            await asyncio.sleep(800)
            _timed_out = True
        _watchdog_task = asyncio.create_task(_timeout_watchdog())

        # =============================================================================
        # MALFORMED_FUNCTION_CALL Auto-Retry
        # The lite model sometimes fails to generate valid tool calls after errors.
        # Instead of immediately showing an error to the user, retry once with
        # a healed session. run_async can be safely re-invoked on the same session.
        # =============================================================================
        _max_malformed_retries = 1
        _malformed_retries = 0
        _malformed_should_retry = False

        async for adk_event in runner.run_async(**run_args):
          if _timed_out:
              logger.log_text("⏱️ Agent processing timed out after 800s — sending graceful error to user.")
              timeout_part = a2a_types.Part(root=a2a_types.TextPart(
                  text="⏱️ The analysis timed out due to its complexity. Please try again — the request may succeed on a retry as resources become available."
              ))
              artifact_text_parts.clear()
              artifact_text_parts.append(timeout_part)
              break
          # --- Model name announcement (once per agent) ---
          _evt_agent = getattr(adk_event, 'author', None)
          if _evt_agent and _evt_agent not in _model_announced and _evt_agent in _agent_model_map:
              _model_announced.add(_evt_agent)
              _model_label = _agent_model_map[_evt_agent]
              _model_msg = f"🧠 Model: {_model_label}"
              _model_event = TaskStatusUpdateEvent(
                  task_id=context.task_id,
                  context_id=context.context_id,
                  status=TaskStatus(
                      state=TaskState.working,
                      message=Message(
                          message_id=str(uuid.uuid4()),
                          role=Role.agent,
                          parts=[a2a_types.Part(root=a2a_types.TextPart(text=_model_msg))],
                      ),
                      timestamp=datetime.now(timezone.utc).isoformat(),
                  ),
                  final=False,
              )
              task_result_aggregator.process_event(_model_event)
              await event_queue.enqueue_event(_model_event)

          if hasattr(adk_event, 'error_code') and adk_event.error_code:
              _err_code_str = str(adk_event.error_code)
              # --- MALFORMED_FUNCTION_CALL recovery ---
              # The model sometimes generates invalid tool calls (bad schema,
              # mixed text + function_call). Instead of failing hard, provide
              # a user-friendly retry message so the conversation can continue.
              if 'MALFORMED_FUNCTION_CALL' in _err_code_str:
                  # --- Auto-retry: heal session and re-invoke run_async ---
                  if _malformed_retries < _max_malformed_retries:
                      _malformed_retries += 1
                      logger.log_text("MALFORMED_FUNCTION_CALL detected - auto-retrying (" + str(_malformed_retries) + "/" + str(_max_malformed_retries) + ")")
                      # Re-fetch session and heal to remove the failed event
                      session = await runner.session_service.get_session(
                          app_name=runner.app_name, user_id=run_args['user_id'], session_id=run_args['session_id']
                      )
                      _heal_session_events(session)
                      # Reset stream parser for clean retry
                      stream_parser = A2uiStreamParser(catalog=a2ui_selected_catalog)
                      _malformed_should_retry = True
                      break  # Break inner async for loop to retry run_async

                  # --- Max retries exhausted: show recovery message ---
                  logger.log_text("MALFORMED_FUNCTION_CALL detected - retries exhausted - event: " + str(adk_event) + " - vars: " + str(getattr(adk_event, '__dict__', 'N/A')) + " - providing retry guidance to user.")
                  _recovery_text = "I encountered a temporary processing error. Let me try a different approach - please repeat your request or click a suggestion below."
                  _recovery_part = a2a_types.Part(root=a2a_types.TextPart(text=_recovery_text))
                  artifact_text_parts.clear()
                  artifact_text_parts.append(_recovery_part)

                  # Programmatically inject fallback suggestion chips so the user can actually "click a suggestion below" to recover!
                  _fallback_suggestions = [
                      { 'beginRendering': { 'surfaceId': 'suggestions', 'root': 'root' } },
                      { 'surfaceUpdate': { 'surfaceId': 'suggestions', 'components': [
                          { 'id': 'root', 'component': { 'Row': { 'children': { 'explicitList': ['fb_chip1', 'fb_chip2'] }, 'distribution': 'spaceEvenly', 'alignment': 'center' } } },
                          { 'id': 'fb_chip1', 'component': { 'Button': { 'child': 'fb_chip1Lbl', 'action': { 'name': 'sendText', 'context': [{ 'key': 'text', 'value': { 'literalString': 'Please try the last analysis step again' } }] } } } },
                          { 'id': 'fb_chip1Lbl', 'component': { 'Text': { 'text': { 'literalString': '🔄 Try Again' }, 'usageHint': 'body' } } },
                          { 'id': 'fb_chip2', 'component': { 'Button': { 'child': 'fb_chip2Lbl', 'action': { 'name': 'sendText', 'context': [{ 'key': 'text', 'value': { 'literalString': 'Hello' } }] } } } },
                          { 'id': 'fb_chip2Lbl', 'component': { 'Text': { 'text': { 'literalString': '🏠 Restart' }, 'usageHint': 'body' } } }
                      ] } }
                  ]
                  for _item in _fallback_suggestions:
                      fb_ui_part = create_a2ui_part(_item)
                      artifact_media_parts.append(fb_ui_part)
                  # Emit as working status so the user sees it immediately
                  _recovery_evt = TaskStatusUpdateEvent(
                      task_id=context.task_id,
                      context_id=context.context_id,
                      status=TaskStatus(
                          state=TaskState.working,
                          message=Message(
                              message_id=str(uuid.uuid4()),
                              role=Role.agent,
                              parts=[_recovery_part],
                          ),
                          timestamp=datetime.now(timezone.utc).isoformat(),
                      ),
                      final=False,
                  )
                  task_result_aggregator.process_event(_recovery_evt)
                  await event_queue.enqueue_event(_recovery_evt)
                  continue
              a2a_event = TaskStatusUpdateEvent(
                      task_id=context.task_id,
                      context_id=context.context_id,
                      status=TaskStatus(
                          state=TaskState.failed,
                          message=Message(
                              role=Role.agent,
                              parts=[a2a_types.Part(root=a2a_types.TextPart(text=f"Error: {adk_event.error_code}"))],
                              message_id=str(uuid.uuid4())
                          ),
                          timestamp=datetime.now(timezone.utc).isoformat(),
                      ),
                      final=True
                  )
              task_result_aggregator.process_event(a2a_event)
              await event_queue.enqueue_event(a2a_event)
              break

          content = getattr(adk_event, 'content', None)
          if content and hasattr(content, 'parts'):
              # Pre-scan: buffer model text when function_call follows (combine into single status)
              _event_has_fc = any(getattr(p, 'function_call', None) for p in content.parts)
              _event_progress_text = ''
              for part in content.parts:
                  if part.text:
                      # --- Detect code execution blocks (AgentEngineSandboxCodeExecutor) ---
                      # This executor uses text-based delimiters instead of executable_code parts.
                      # Detect tool_code / python and tool_output fenced code blocks and emit
                      # status events so they appear in the thinking accordion.
                      import re as _ce_re
                      _ce_fence = chr(96) * 3
                      _ce_code_pattern = _ce_re.compile(_ce_fence + r'(?:tool_code|python)' + chr(92) + 's*' + chr(92) + 'n(.*?)' + _ce_fence, _ce_re.DOTALL)
                      _ce_output_pattern = _ce_re.compile(_ce_fence + r'tool_output' + chr(92) + 's*' + chr(92) + 'n(.*?)' + _ce_fence, _ce_re.DOTALL)
                      _ce_code_matches = _ce_code_pattern.findall(part.text)
                      _ce_output_matches = _ce_output_pattern.findall(part.text)
                      for _ce_code_block in _ce_code_matches:
                          _ce_code_text = chr(10).join(["🐍 Code Execution (Python)", _ce_code_block.strip()])
                          _ce_code_evt = TaskStatusUpdateEvent(
                              task_id=context.task_id,
                              context_id=context.context_id,
                              status=TaskStatus(
                                  state=TaskState.working,
                                  message=Message(
                                      message_id=str(uuid.uuid4()),
                                      role=Role.agent,
                                      parts=[a2a_types.Part(root=a2a_types.TextPart(text=_ce_code_text))],
                                  ),
                                  timestamp=datetime.now(timezone.utc).isoformat(),
                              ),
                              final=False,
                          )
                          task_result_aggregator.process_event(_ce_code_evt)
                          await event_queue.enqueue_event(_ce_code_evt)
                      for _ce_out_block in _ce_output_matches:
                          _ce_out_text = chr(10).join(["✅ Code Execution Result", _ce_out_block.strip()])
                          _ce_out_evt = TaskStatusUpdateEvent(
                              task_id=context.task_id,
                              context_id=context.context_id,
                              status=TaskStatus(
                                  state=TaskState.working,
                                  message=Message(
                                      message_id=str(uuid.uuid4()),
                                      role=Role.agent,
                                      parts=[a2a_types.Part(root=a2a_types.TextPart(text=_ce_out_text))],
                                  ),
                                  timestamp=datetime.now(timezone.utc).isoformat(),
                              ),
                              final=False,
                          )
                          task_result_aggregator.process_event(_ce_out_evt)
                          await event_queue.enqueue_event(_ce_out_evt)
                      # Capture model's progress text for function_call context
                      if _event_has_fc:
                          _event_progress_text = part.text.strip()
                      # SDK handles: tag detection, JSON buffering, healing,
                      # validation, and component-level incremental yielding
                      _fallback_recovered_a2ui = False
                      try:
                          _chunk_text = _sanitize_a2ui_text_icons(part.text) if '<a2ui-json>' in part.text else part.text
                          response_parts = stream_parser.process_chunk(_chunk_text)
                          # Diagnostic: trace what the parser returned
                          _has_a2ui = any(rp.a2ui_json for rp in response_parts)
                          _has_text = any(rp.text for rp in response_parts)
                          if '<a2ui-json>' in part.text or _has_a2ui:
                              logger.log_text(f"[a2ui_diag] process_chunk returned {len(response_parts)} parts, has_a2ui={_has_a2ui}, has_text={_has_text}, input_len={len(part.text)}")
                      except (ValueError, Exception) as parse_err:
                          logger.log_text(f"A2UI stream parse error ({type(parse_err).__name__}): {parse_err}")
                          logger.log_text(f"A2UI parse error text (first 200 chars): {part.text[:200]}")
                          response_parts = []
                          _fallback_recovered_a2ui = False

                          # -------------------------------------------------------
                          # CRITICAL FALLBACK: Extract A2UI JSON via regex when
                          # the stream parser fails (e.g. malformed JSON).
                          # Without this, both text AND A2UI are lost from the
                          # final artifact and trapped inside "thinking".
                          # -------------------------------------------------------
                          import re as _re
                          _a2ui_pattern = _re.compile(r'<a2ui-json>(.*?)</a2ui-json>', _re.DOTALL)
                          _raw = part.text
                          _matches = _a2ui_pattern.findall(_raw)
                          # Strip A2UI blocks from text to get plain text
                          _plain = _a2ui_pattern.sub('', _raw).strip()

                          if _plain:
                              fallback_text_part = a2a_types.Part(root=a2a_types.TextPart(text=_plain))
                              artifact_text_parts.append(fallback_text_part)

                          for _m in _matches:
                              try:
                                  import json as _json
                                  _parsed = _json.loads(_m)
                                  # A2UI JSON is always a list — iterate each dict element
                                  _items = _parsed if isinstance(_parsed, list) else [_parsed]
                                  _items = _heal_a2ui_message_list(_items)
                                  for _item in _items:
                                      if isinstance(_item, dict):
                                          fb_ui_part = create_a2ui_part(_item)
                                          artifact_media_parts.append(fb_ui_part)
                                          _fallback_recovered_a2ui = True
                                  _fb_keys = [list(i.keys())[0] if isinstance(i, dict) and i else '?' for i in _items]
                                  logger.log_text(f"A2UI fallback: recovered {len(_items)} A2UI component(s) via regex, keys={_fb_keys}")
                              except Exception as _je:
                                  logger.log_text(f"A2UI fallback: regex-extracted JSON invalid: {_je}")

                          # Also stream the fallback text to the user immediately
                          _fallback_parts = []
                          if _plain:
                              _fallback_parts.append(fallback_text_part)
                          for _m in _matches:
                              try:
                                  _parsed = _json.loads(_m)
                                  _f_items = _parsed if isinstance(_parsed, list) else [_parsed]
                                  _f_items = _heal_a2ui_message_list(_f_items)
                                  for _f_item in _f_items:
                                      if isinstance(_f_item, dict):
                                          _fallback_parts.append(create_a2ui_part(_f_item))
                              except Exception:
                                  pass
                          if not _fallback_parts and _raw:
                              _fallback_parts = [a2a_types.Part(root=a2a_types.TextPart(text=_raw))]
                              artifact_text_parts.append(_fallback_parts[0])
                          if _fallback_parts:
                              a2a_event = TaskStatusUpdateEvent(
                                      task_id=context.task_id,
                                      context_id=context.context_id,
                                      status=TaskStatus(
                                          state=TaskState.working,
                                          message=Message(message_id=str(uuid.uuid4()), role=Role.agent, parts=_fallback_parts),
                                          timestamp=datetime.now(timezone.utc).isoformat(),
                                      ),
                                      final=False
                                  )
                              task_result_aggregator.process_event(a2a_event)
                              await event_queue.enqueue_event(a2a_event)
                          # Reset parser state to avoid cascading failures
                          try:
                              stream_parser._buffer = ''
                              stream_parser._found_delimiter = False
                          except Exception:
                              pass

                      for rp in response_parts:
                          synthetic_parts = []
                          if rp.text:
                              # Robust Failsafe: Block raw Python dict/list repr leaks from reaching the chat
                              _trimmed = rp.text.strip()
                              _is_repr = _trimmed.startswith('{') or _trimmed.startswith('[')
                              if _is_repr and ("'content':" in _trimmed or "'parts':" in _trimmed):
                                  logger.log_text(f"[leak_failsafe] 🛡️ Blocked raw Python response dict leak: {_trimmed[:100]}...")
                                  continue
                              text_part = a2a_types.Part(root=a2a_types.TextPart(text=rp.text))
                              synthetic_parts.append(text_part)
                              artifact_text_parts.append(text_part)  # ★ Cleared on next function_call
                          if rp.a2ui_json:
                              a2ui_messages = rp.a2ui_json if isinstance(rp.a2ui_json, list) else [rp.a2ui_json]
                              a2ui_messages = _heal_a2ui_message_list(a2ui_messages)
                              # Note: "💡 Next Actions" header is injected as text in the final
                              # artifact assembly, not via A2UI (GE suggestions surface ignores
                              # non-Button components).
                              for msg in a2ui_messages:
                                  ui_part = create_a2ui_part(msg)
                                  synthetic_parts.append(ui_part)
                                  artifact_media_parts.append(ui_part)  # ★ Never cleared
                          if synthetic_parts:
                              # Skip sending text-only events to Thinking when function_call
                              # follows in the same event — text will be combined into the
                              # function_call status instead for a cohesive display.
                              _skip_text_event = _event_has_fc and not any(rp.a2ui_json for rp in response_parts)
                              if not _skip_text_event:
                                  a2a_event = TaskStatusUpdateEvent(
                                          task_id=context.task_id,
                                          context_id=context.context_id,
                                          status=TaskStatus(
                                              state=TaskState.working,
                                              message=Message(message_id=str(uuid.uuid4()), role=Role.agent, parts=synthetic_parts),
                                              timestamp=datetime.now(timezone.utc).isoformat(),
                                          ),
                                          final=False
                                      )
                                  task_result_aggregator.process_event(a2a_event)
                                  await event_queue.enqueue_event(a2a_event)

                      # -------------------------------------------------------
                      # POST-SUCCESS SAFETY NET: The A2uiStreamParser may
                      # silently drop A2UI JSON (returns text-only parts even
                      # when input contains <a2ui-json> tags, with empty buffer
                      # afterwards). When this happens, extract A2UI ourselves.
                      # -------------------------------------------------------
                      _parser_found_a2ui = any(rp.a2ui_json for rp in response_parts)
                      if '<a2ui-json>' in part.text and not _parser_found_a2ui and not _fallback_recovered_a2ui:
                          import re as _re
                          import json as _json
                          _a2ui_re = _re.compile(r'<a2ui-json>(.*?)</a2ui-json>', _re.DOTALL)
                          _a2ui_matches = _a2ui_re.findall(part.text)
                          logger.log_text(f"[a2ui_safety_net] Parser missed A2UI! Found {len(_a2ui_matches)} A2UI block(s) via regex in {len(part.text)} chars")
                          
                          # Strip A2UI blocks from the already accumulated text parts to prevent double-rendering
                          if artifact_text_parts:
                              _last_text_part = artifact_text_parts[-1]
                              _lt_root = getattr(_last_text_part, 'root', None)
                              _lt_text = getattr(_lt_root, 'text', '') if _lt_root else ''
                              if _lt_text:
                                  _cleaned_text = _a2ui_re.sub('', _lt_text).strip()
                                  if _cleaned_text:
                                      artifact_text_parts[-1] = a2a_types.Part(root=a2a_types.TextPart(text=_cleaned_text))
                                  else:
                                      artifact_text_parts.pop()

                          _safety_parts = []
                          for _match_str in _a2ui_matches:
                              try:
                                  _parsed_json = _json.loads(_match_str)
                                  # A2UI JSON is always a list — iterate each dict element
                                  _sn_items = _parsed_json if isinstance(_parsed_json, list) else [_parsed_json]
                                  _sn_items = _heal_a2ui_message_list(_sn_items)
                                  for _sn_item in _sn_items:
                                      if isinstance(_sn_item, dict):
                                          _ui_part = create_a2ui_part(_sn_item)
                                          _safety_parts.append(_ui_part)
                                          artifact_media_parts.append(_ui_part)
                                  _sn_keys = [list(i.keys())[0] if isinstance(i, dict) and i else '?' for i in _sn_items]
                                  logger.log_text(f"[a2ui_safety_net] Recovered {len(_sn_items)} A2UI component(s) via regex, keys={_sn_keys}")
                              except Exception as _e:
                                  logger.log_text(f"[a2ui_safety_net] Failed to parse regex-extracted JSON: {_e}")
                          if _safety_parts:
                              a2a_event = TaskStatusUpdateEvent(
                                      task_id=context.task_id,
                                      context_id=context.context_id,
                                      status=TaskStatus(
                                          state=TaskState.working,
                                          message=Message(message_id=str(uuid.uuid4()), role=Role.agent, parts=_safety_parts),
                                          timestamp=datetime.now(timezone.utc).isoformat(),
                                      ),
                                      final=False
                                  )
                              task_result_aggregator.process_event(a2a_event)
                              await event_queue.enqueue_event(a2a_event)

                      # -------------------------------------------------------
                      # SAFETY NET 2 (Robust): Detect untagged A2UI JSON.
                      # Uses json.JSONDecoder().raw_decode() instead of regex
                      # to handle both JSON arrays and individual objects.
                      # This covers models that omit <a2ui-json> tags and/or
                      # JSON array brackets [].
                      # -------------------------------------------------------
                      if not _parser_found_a2ui and '<a2ui-json>' not in part.text:
                          import json as _json2
                          _a2ui_keys = ('"beginRendering"', '"surfaceUpdate"', '"surfaceId"', '"deleteSurface"')
                          if any(k in part.text for k in _a2ui_keys):
                              logger.log_text(f"[a2ui_robust_safety] Scanning untagged A2UI in {len(part.text)} chars")

                              _pos = 0
                              _extracted_spans = []
                              _untagged_parts = []

                              while _pos < len(part.text):
                                  # Find the next potential JSON start character
                                  _start_brace = part.text.find('{', _pos)
                                  _start_bracket = part.text.find('[', _pos)

                                  if _start_brace == -1 and _start_bracket == -1:
                                      break

                                  if _start_bracket == -1:
                                      _start_pos = _start_brace
                                  elif _start_brace == -1:
                                      _start_pos = _start_bracket
                                  else:
                                      _start_pos = min(_start_brace, _start_bracket)

                                  _open_char = part.text[_start_pos]
                                  _close_char = '}' if _open_char == '{' else ']'
                                  
                                  _end_pos = _find_balanced_block(part.text, _start_pos, _open_char, _close_char)
                                  if _end_pos == -1:
                                      _pos = _start_pos + 1
                                      continue
                                      
                                  _sub_str = part.text[_start_pos:_end_pos]
                                  _obj = _parse_loose_json(_sub_str)

                                  if _obj is not None:
                                      # Validate: is this an A2UI component structure?
                                      _is_a2ui = False
                                      if isinstance(_obj, dict):
                                          _is_a2ui = any(k in _obj for k in ("beginRendering", "surfaceUpdate", "dataModelUpdate", "deleteSurface")) or ("id" in _obj and "component" in _obj)
                                      elif isinstance(_obj, list):
                                          _is_a2ui = any(
                                              isinstance(i, dict) and (
                                                  any(k in i for k in ("beginRendering", "surfaceUpdate", "dataModelUpdate", "deleteSurface"))
                                                  or ("id" in i and "component" in i)
                                              ) for i in _obj
                                          )

                                      if _is_a2ui:
                                          _items = _obj if isinstance(_obj, list) else [_obj]
                                          _items = _heal_a2ui_message_list(_items)
                                          for _item in _items:
                                              if isinstance(_item, dict):
                                                  _ui_p = create_a2ui_part(_item)
                                                  _untagged_parts.append(_ui_p)
                                                  artifact_media_parts.append(_ui_p)
                                          _extracted_spans.append((_start_pos, _end_pos))
                                          _ut_keys = [list(i.keys())[0] if isinstance(i, dict) and i else '?' for i in _items]
                                          logger.log_text(f"[a2ui_robust_safety] Recovered {len(_items)} component(s), keys={_ut_keys}")
                                          _pos = _end_pos
                                      else:
                                          _pos = _start_pos + 1
                                  else:
                                      _pos = _start_pos + 1

                              # Reconstruct clean text by removing extracted spans
                              if _extracted_spans:
                                  _clean_text = ""
                                  _last_idx = 0
                                  for _s, _e in _extracted_spans:
                                      _clean_text += part.text[_last_idx:_s]
                                      _last_idx = _e
                                  _clean_text += part.text[_last_idx:]
                                  # Clean up empty list items/commas left behind by extraction
                                  import re as _re_clean
                                  _clean_text = _re_clean.sub(r',\\s*(?=\\s*,)', '', _clean_text)
                                  _clean_text = _re_clean.sub(r'([\\[{])\\s*,', r'\\1', _clean_text)
                                  _clean_text = _re_clean.sub(r',\\s*([\\]}])', r'\\1', _clean_text)
                                  # Collapse multiple empty lines (using chr(10) to avoid backslash-n hazard)
                                  _clean_text = _re_clean.sub(chr(10) + r'\\s*' + chr(10), chr(10), _clean_text)
                                  _extracted_text = _clean_text.strip()
                              else:
                                  _extracted_text = part.text

                              # Emit recovered A2UI parts as a working status update
                              if _untagged_parts:
                                  _ut_event = TaskStatusUpdateEvent(
                                      task_id=context.task_id,
                                      context_id=context.context_id,
                                      status=TaskStatus(
                                          state=TaskState.working,
                                          message=Message(message_id=str(uuid.uuid4()), role=Role.agent, parts=_untagged_parts),
                                          timestamp=datetime.now(timezone.utc).isoformat(),
                                      ),
                                      final=False,
                                  )
                                  task_result_aggregator.process_event(_ut_event)
                                  await event_queue.enqueue_event(_ut_event)
                                  
                              # Emit remaining clean text (if any) and prevent duplication
                              if _extracted_spans:
                                  _clean_text_final = _extracted_text
                                  if _clean_text_final:
                                      # Pop the raw dirty text part that was appended upstream at L10082
                                      if artifact_text_parts:
                                          artifact_text_parts.pop()
                                          
                                      _ct_part = a2a_types.Part(root=a2a_types.TextPart(text=_clean_text_final))
                                      artifact_text_parts.append(_ct_part)
                  else:
                      # Non-text parts (images, function calls) — unchanged
                      synthetic_parts = part_converters.convert_genai_part_to_a2a_parts(part)
                      if synthetic_parts:
                          # ★ Accumulate images for artifact, clear text on tool calls
                          if part.inline_data:
                              artifact_media_parts.extend(synthetic_parts)
                          elif part.function_call:
                              # --- Tool call status (TextPart → Thinking accordion) ---
                              _fc_name = part.function_call.name
                              _fc_args = part.function_call.args or {}
                              if _fc_name.startswith('transfer_to_') or _fc_name == 'transfer_to_agent':
                                  _fc_target = _fc_args.get('agent_name', 'sub-agent')
                                  _fc_status_text = f"🔄 Delegating to {_fc_target}..."
                              elif _fc_name == 'adk_request_credential':
                                  _fc_status_text = None
                              else:
                                  # Extract context from args for detailed status
                                  _fc_detail = ''
                                  if _fc_name in ('execute_sql', 'query', 'run_query', 'execute_query'):
                                      _sql = _fc_args.get('query', _fc_args.get('sql', _fc_args.get('statement', '')))
                                      if _sql:
                                          _fc_detail = _sql.replace(chr(10), ' ')
                                  elif _fc_name == 'generate_image':
                                      _prompt = _fc_args.get('prompt', '')
                                      if _prompt:
                                          _fc_detail = _prompt
                                  else:
                                      # Generic: show all key args
                                      _arg_previews = []
                                      for _k, _v in _fc_args.items():
                                          _arg_previews.append(f"{_k}={str(_v)}")
                                      _fc_detail = ', '.join(_arg_previews)
                                  # Combine: tool name + model's progress text (summary) + technical detail
                                  _fc_lines = [f"🔧 {_fc_name}"]
                                  if _event_progress_text:
                                      _fc_lines.append(_event_progress_text)
                                  if _fc_detail:
                                      _fc_lines.append(_fc_detail)
                                  _fc_status_text = chr(10).join(_fc_lines)
                              if _fc_status_text:
                                  _fc_text_evt = TaskStatusUpdateEvent(
                                      task_id=context.task_id,
                                      context_id=context.context_id,
                                      status=TaskStatus(
                                          state=TaskState.working,
                                          message=Message(
                                              message_id=str(uuid.uuid4()),
                                              role=Role.agent,
                                              parts=[a2a_types.Part(root=a2a_types.TextPart(text=_fc_status_text))],
                                          ),
                                          timestamp=datetime.now(timezone.utc).isoformat(),
                                      ),
                                      final=False,
                                  )
                                  task_result_aggregator.process_event(_fc_text_evt)
                                  await event_queue.enqueue_event(_fc_text_evt)
                              # ★ Special handling: adk_request_credential → show auth URL to user
                              if part.function_call.name == 'adk_request_credential':
                                  fc_args = part.function_call.args or {}
                                  logger.log_text(f"[auth_flow] adk_request_credential detected, args keys: {list(fc_args.keys())}")
                                  # Deep extraction: authConfig.exchangedAuthCredential.oauth2.authUri
                                  auth_url = ''
                                  def _deep_get(obj, *keys, default=''):
                                      cur = obj
                                      for k in keys:
                                          if cur is None:
                                              return default
                                          if isinstance(cur, dict):
                                              cur = cur.get(k)
                                          elif hasattr(cur, k):
                                              cur = getattr(cur, k, None)
                                          else:
                                              return default
                                      return str(cur) if cur else default
                                  auth_url = _deep_get(fc_args, 'authConfig', 'exchangedAuthCredential', 'oauth2', 'authUri')
                                  if not auth_url:
                                      auth_url = _deep_get(fc_args, 'authConfig', 'exchangedAuthCredential', 'oauth2', 'auth_uri')
                                  # Recursive fallback: find any string starting with http in nested structure
                                  if not auth_url:
                                      def _find_url(obj, depth=0):
                                          if depth > 8:
                                              return ''
                                          if isinstance(obj, str) and obj.startswith('http'):
                                              return obj
                                          if isinstance(obj, dict):
                                              for v in obj.values():
                                                  r = _find_url(v, depth + 1)
                                                  if r:
                                                      return r
                                          elif hasattr(obj, '__dict__'):
                                              for v in vars(obj).values():
                                                  r = _find_url(v, depth + 1)
                                                  if r:
                                                      return r
                                          return ''
                                      auth_url = _find_url(fc_args)
                                  logger.log_text(f"[auth_flow] resolved auth_url present: {bool(auth_url)}, url_start: {auth_url[:80] if auth_url else 'N/A'}")
                                  if auth_url:
                                      # Extract service name from auth URL domain
                                      try:
                                          from urllib.parse import urlparse
                                          _domain = urlparse(auth_url).netloc.replace('www.', '').split('.')[0].capitalize()
                                      except Exception:
                                          _domain = "External Service"
                                      auth_text = f"🔐 Authentication required. Please click the link below to authorize access.\\n\\n[Authorize with {_domain}]({auth_url})\\n\\nAfter completing authorization, please send your message again."
                                      auth_part = a2a_types.Part(root=a2a_types.TextPart(text=auth_text))
                                      artifact_text_parts.clear()
                                      artifact_text_parts.append(auth_part)
                                      # Send as final response (don't clear)
                                      a2a_event = TaskStatusUpdateEvent(
                                              task_id=context.task_id,
                                              context_id=context.context_id,
                                              status=TaskStatus(
                                                  state=TaskState.working,
                                                  message=Message(message_id=str(uuid.uuid4()), role=Role.agent, parts=[auth_part]),
                                                  timestamp=datetime.now(timezone.utc).isoformat(),
                                              ),
                                              final=False
                                          )
                                      task_result_aggregator.process_event(a2a_event)
                                      await event_queue.enqueue_event(a2a_event)
                                      continue
                                  else:
                                      # auth_url not found in args — show generic auth-in-progress message
                                      auth_text = "🔐 Authentication is being processed. Please wait a moment and try again."
                                      auth_part = a2a_types.Part(root=a2a_types.TextPart(text=auth_text))
                                      artifact_text_parts.clear()
                                      artifact_text_parts.append(auth_part)
                                      a2a_event = TaskStatusUpdateEvent(
                                              task_id=context.task_id,
                                              context_id=context.context_id,
                                              status=TaskStatus(
                                                  state=TaskState.working,
                                                  message=Message(message_id=str(uuid.uuid4()), role=Role.agent, parts=[auth_part]),
                                                  timestamp=datetime.now(timezone.utc).isoformat(),
                                              ),
                                              final=False
                                          )
                                      task_result_aggregator.process_event(a2a_event)
                                      await event_queue.enqueue_event(a2a_event)
                                      continue
                              # Tool invocation detected → previous text was just progress.
                              # Note: A2UI blocks from the same event are already captured
                              # in artifact_media_parts by process_chunk() above since text
                              # parts are processed before function_call parts in the loop.
                              #
                              # EXCEPTION: transfer_to_agent is ADK's internal agent-
                              # delegation mechanism, not a real tool call. Text emitted
                              # alongside it (e.g., deep_analysis_agent's full report)
                              # is the actual user-facing analysis, not progress text.
                              # Clearing it here would trap the report in thinking.
                              # EXCEPTION 2: register_background_task - the LLM
                              # often emits the full user confirmation alongside the
                              # function_call. Clearing traps it in thinking.
                              _is_transfer = part.function_call.name.startswith('transfer_to_') or part.function_call.name == 'transfer_to_agent'
                              _preserve = _is_transfer or part.function_call.name == 'register_background_task'
                              if not _preserve:
                                  artifact_text_parts.clear()
                          elif part.function_response:
                              # --- Tool response status (TextPart → Thinking accordion) ---
                              _fr_name = getattr(part.function_response, 'name', None) or 'tool'
                              _is_transfer = _fr_name.startswith('transfer_to_') or _fr_name == 'transfer_to_agent'
                              if not _is_transfer and _fr_name != 'adk_request_credential':
                                  _fr_text_evt = TaskStatusUpdateEvent(
                                      task_id=context.task_id,
                                      context_id=context.context_id,
                                      status=TaskStatus(
                                          state=TaskState.working,
                                          message=Message(
                                              message_id=str(uuid.uuid4()),
                                              role=Role.agent,
                                              parts=[a2a_types.Part(root=a2a_types.TextPart(text=f"✅ {_fr_name}"))],
                                          ),
                                          timestamp=datetime.now(timezone.utc).isoformat(),
                                      ),
                                      final=False,
                                  )
                                  task_result_aggregator.process_event(_fr_text_evt)
                                  await event_queue.enqueue_event(_fr_text_evt)
                          elif part.executable_code:
                              # --- Code execution: show the code being executed ---
                              _exec_code = getattr(part.executable_code, 'code', '') or ''
                              _exec_lang = getattr(part.executable_code, 'language', 'PYTHON') or 'PYTHON'
                              _ce_lines = [f"🐍 Code Execution ({_exec_lang})"]
                              if _exec_code:
                                  _ce_lines.append(_exec_code.replace(chr(10), chr(10)))
                              _ce_status_text = chr(10).join(_ce_lines)
                              _ce_text_evt = TaskStatusUpdateEvent(
                                  task_id=context.task_id,
                                  context_id=context.context_id,
                                  status=TaskStatus(
                                      state=TaskState.working,
                                      message=Message(
                                          message_id=str(uuid.uuid4()),
                                          role=Role.agent,
                                          parts=[a2a_types.Part(root=a2a_types.TextPart(text=_ce_status_text))],
                                      ),
                                      timestamp=datetime.now(timezone.utc).isoformat(),
                                  ),
                                  final=False,
                              )
                              task_result_aggregator.process_event(_ce_text_evt)
                              await event_queue.enqueue_event(_ce_text_evt)
                              artifact_text_parts.clear()
                          elif part.code_execution_result:
                              # --- Code execution result: show output ---
                              _ce_outcome = getattr(part.code_execution_result, 'outcome', '') or ''
                              _ce_output = getattr(part.code_execution_result, 'output', '') or ''
                              logger.log_text(f"[code_exec] outcome={repr(_ce_outcome)} type={type(_ce_outcome).__name__} output_len={len(_ce_output)}")
                              _ce_icon = "❌" if any(kw in str(_ce_outcome).upper() for kw in ('FAILED', 'ERROR', 'DEADLINE')) else "✅"
                              _cr_lines = [f"{_ce_icon} Code Execution Result"]
                              if _ce_output:
                                  _cr_lines.append(_ce_output)
                              _cr_status_text = chr(10).join(_cr_lines)
                              _cr_text_evt = TaskStatusUpdateEvent(
                                  task_id=context.task_id,
                                  context_id=context.context_id,
                                  status=TaskStatus(
                                      state=TaskState.working,
                                      message=Message(
                                          message_id=str(uuid.uuid4()),
                                          role=Role.agent,
                                          parts=[a2a_types.Part(root=a2a_types.TextPart(text=_cr_status_text))],
                                      ),
                                      timestamp=datetime.now(timezone.utc).isoformat(),
                                  ),
                                  final=False,
                              )
                              task_result_aggregator.process_event(_cr_text_evt)
                              await event_queue.enqueue_event(_cr_text_evt)
                          if not part.inline_data:
                              a2a_event = TaskStatusUpdateEvent(
                                      task_id=context.task_id,
                                      context_id=context.context_id,
                                      status=TaskStatus(
                                          state=TaskState.working,
                                          message=Message(message_id=str(uuid.uuid4()), role=Role.agent, parts=synthetic_parts),
                                          timestamp=datetime.now(timezone.utc).isoformat(),
                                      ),
                                      final=False
                                  )
                              task_result_aggregator.process_event(a2a_event)
                              await event_queue.enqueue_event(a2a_event)

        # --- MALFORMED_FUNCTION_CALL Auto-Retry ---
        # If a retry was triggered, run a second event loop pass with healed session.
        if _malformed_should_retry:
            logger.log_text("MALFORMED_FUNCTION_CALL - restarting run_async after session healing")
            _malformed_should_retry = False
            async for adk_event in runner.run_async(**run_args):
              if _timed_out:
                  break
              if hasattr(adk_event, 'error_code') and adk_event.error_code:
                  _err2 = str(adk_event.error_code)
                  if 'MALFORMED_FUNCTION_CALL' in _err2:
                      # Second MALFORMED — exhausted retries, show recovery message
                      logger.log_text("MALFORMED_FUNCTION_CALL - retry also failed, showing recovery message")
                      _recovery_text = "I encountered a temporary processing error. Let me try a different approach - please repeat your request or click a suggestion below."
                      _recovery_part = a2a_types.Part(root=a2a_types.TextPart(text=_recovery_text))
                      artifact_text_parts.clear()
                      artifact_text_parts.append(_recovery_part)
                      _fallback_suggestions = [
                          { 'beginRendering': { 'surfaceId': 'suggestions', 'root': 'root' } },
                          { 'surfaceUpdate': { 'surfaceId': 'suggestions', 'components': [
                              { 'id': 'root', 'component': { 'Row': { 'children': { 'explicitList': ['fb_chip1', 'fb_chip2'] }, 'distribution': 'spaceEvenly', 'alignment': 'center' } } },
                              { 'id': 'fb_chip1', 'component': { 'Button': { 'child': 'fb_chip1Lbl', 'action': { 'name': 'sendText', 'context': [{ 'key': 'text', 'value': { 'literalString': 'Please try the last analysis step again' } }] } } } },
                              { 'id': 'fb_chip1Lbl', 'component': { 'Text': { 'text': { 'literalString': '🔄 Try Again' }, 'usageHint': 'body' } } },
                              { 'id': 'fb_chip2', 'component': { 'Button': { 'child': 'fb_chip2Lbl', 'action': { 'name': 'sendText', 'context': [{ 'key': 'text', 'value': { 'literalString': 'Hello' } }] } } } },
                              { 'id': 'fb_chip2Lbl', 'component': { 'Text': { 'text': { 'literalString': '🏠 Restart' }, 'usageHint': 'body' } } }
                          ] } }
                      ]
                      for _item in _fallback_suggestions:
                          fb_ui_part = create_a2ui_part(_item)
                          artifact_media_parts.append(fb_ui_part)
                      continue
              # Process normal events in retry loop (text, function_call, etc.)
              content = getattr(adk_event, 'content', None)
              if content and hasattr(content, 'parts'):
                  for part in content.parts:
                      if hasattr(part, 'text') and part.text:
                          _final_response = getattr(adk_event, 'is_final_response', lambda: False)
                          if callable(_final_response) and _final_response():
                              artifact_text_parts.append(a2a_types.Part(root=a2a_types.TextPart(text=part.text)))
                      if hasattr(part, 'function_call') and part.function_call:
                          artifact_text_parts.clear()

        # Cancel the timeout watchdog now that the event loop has finished
        _watchdog_task.cancel()

        # =============================================================================
        # Drain the A2UI stream parser's internal buffer.
        # A2uiStreamParser does NOT have a flush() method. Instead, after the
        # stream ends we must handle any text remaining in _buffer:
        #   - If _found_delimiter is True, we have an incomplete <a2ui-json> block
        #     (close tag never arrived). Process the raw JSON fragment.
        #   - If _found_delimiter is False, trailing conversational text remains.
        # =============================================================================

        try:
            remaining = getattr(stream_parser, '_buffer', '')
            if remaining:
                if getattr(stream_parser, '_found_delimiter', False):
                    # Incomplete A2UI block — process as if close tag arrived
                    drain_parts = stream_parser.process_chunk('</a2ui-json>')
                else:
                    # Trailing conversational text
                    drain_parts = [ResponsePart(text=remaining)]
                    stream_parser._buffer = ''

                for rp in drain_parts:
                    if rp.text:
                        text_part = a2a_types.Part(root=a2a_types.TextPart(text=rp.text))
                        artifact_text_parts.append(text_part)
                    if rp.a2ui_json:
                        a2ui_messages = rp.a2ui_json if isinstance(rp.a2ui_json, list) else [rp.a2ui_json]
                        a2ui_messages = _heal_a2ui_message_list(a2ui_messages)
                        for msg in a2ui_messages:
                            ui_part = create_a2ui_part(msg)
                            artifact_media_parts.append(ui_part)
        except Exception as drain_err:
            logger.log_text(f"A2UI stream parser drain error: {drain_err}")

        # =============================================================================
        # Final Artifact — contains ALL accumulated user-facing parts
        # GE displays artifact content OUTSIDE the thinking accordion.
        # Without this, only the last streamed chunk appears as the "final response"
        # and all preceding text is trapped inside thinking.
        # =============================================================================
        # Combine: final response text + all media (images, A2UI)
        # --- Re-order media parts ---
        _normal_media = []
        _suggestion_media = []
        for _mp in artifact_media_parts:
            if _is_suggestions_part(_mp):
                _suggestion_media.append(_mp)
            else:
                _normal_media.append(_mp)

        # --- Inject "💡 Next Actions" header above suggestion chips ---
        # GE's suggestions surface only renders Button components, silently ignoring
        # Text/Column/Row layout in the surface. So the header must be appended to
        # the last TextPart. GE renders text parts ABOVE data parts, so the header
        # naturally appears right above the suggestion chips.
        # Note: Models may use surfaceId='suggestions' OR embed buttons in other
        # surfaces. We detect any surface containing Button components as suggestions.
        _has_any_buttons = _suggestion_media or any(
            _is_suggestions_part(_mp) or _has_button_components(_mp)
            for _mp in artifact_media_parts
        )
        if _has_any_buttons and artifact_text_parts:
            _last_text = artifact_text_parts[-1]
            _ltr = getattr(_last_text, 'root', None)
            if _ltr and hasattr(_ltr, 'text'):
                _ltr.text = _ltr.text.rstrip() + chr(10) + chr(10) + "---" + chr(10) + chr(10) + "**💡 Next Actions**" + chr(10)

        artifact_parts = artifact_text_parts + _normal_media + _suggestion_media

        # --- DIAGNOSTIC: Log final artifact composition ---
        def _part_type_label(p):
            _r = getattr(p, 'root', None)
            if _r is None:
                return 'none'
            if hasattr(_r, 'text'):
                return 'text'
            if hasattr(_r, 'data'):
                _d = _r.data
                if isinstance(_d, dict):
                    for _dk in ('beginRendering', 'surfaceUpdate', 'deleteSurface'):
                        if _dk in _d:
                            return _dk + ':' + str(_d[_dk].get('surfaceId', '?'))
                return 'data'
            if hasattr(_r, 'inline_data'):
                return 'inline_data'
            return 'other'
        _part_labels = [_part_type_label(p) for p in artifact_parts]
        logger.log_text(f"[final_artifact] text={len(artifact_text_parts)} normal_media={len(_normal_media)} suggestion_media={len(_suggestion_media)} total={len(artifact_parts)}")
        logger.log_text(f"[final_artifact_parts] {_part_labels}")

        if (
            task_result_aggregator.task_state == TaskState.working
            and artifact_parts
        ):
          await event_queue.enqueue_event(
              TaskArtifactUpdateEvent(
                  task_id=context.task_id,
                  last_chunk=True,
                  context_id=context.context_id,
                  artifact=Artifact(
                      artifact_id=str(uuid.uuid4()),
                      parts=artifact_parts,  # ★ Final text + all media
                  ),
              )
          )
          await event_queue.enqueue_event(
              TaskStatusUpdateEvent(
                  task_id=context.task_id,
                  status=TaskStatus(
                      state=TaskState.completed,
                      timestamp=datetime.now(timezone.utc).isoformat(),
                  ),
                  context_id=context.context_id,
                  final=True,
              )
          )
        elif (
            task_result_aggregator.task_state == TaskState.working
            and task_result_aggregator.task_status_message is not None
            and task_result_aggregator.task_status_message.parts
        ):
          # Fallback: use last message if no artifact parts accumulated
          await event_queue.enqueue_event(
              TaskArtifactUpdateEvent(
                  task_id=context.task_id,
                  last_chunk=True,
                  context_id=context.context_id,
                  artifact=Artifact(
                      artifact_id=str(uuid.uuid4()),
                      parts=task_result_aggregator.task_status_message.parts,
                  ),
              )
          )
          await event_queue.enqueue_event(
              TaskStatusUpdateEvent(
                  task_id=context.task_id,
                  status=TaskStatus(
                      state=TaskState.completed,
                      timestamp=datetime.now(timezone.utc).isoformat(),
                  ),
                  context_id=context.context_id,
                  final=True,
              )
          )
        else:
          await event_queue.enqueue_event(
              TaskStatusUpdateEvent(
                  task_id=context.task_id,
                  status=TaskStatus(
                      state=task_result_aggregator.task_state,
                      timestamp=datetime.now(timezone.utc).isoformat(),
                      message=task_result_aggregator.task_status_message,
                  ),
                  context_id=context.context_id,
                  final=True,
              )
          )

request_handler = DefaultRequestHandler(
    agent_executor=AdkAgentToA2AExecutor(runner=runner, use_legacy=True), task_store=InMemoryTaskStore()
)

A2A_RPC_PATH = f"/a2a/{adk_app.name}"

def _build_static_agent_card() -> AgentCard:
    """Build a static AgentCard WITHOUT connecting to MCP servers.

    AgentCardBuilder.build() connects to ALL MCP toolsets to discover tools,
    which can hang indefinitely (especially stdio-based custom MCP servers
    like Redmine). This causes A2A routes to never be registered.

    Instead, we create a static AgentCard with a generic skill. MCP tool
    connections happen LAZILY when the first user request invokes a tool —
    this is handled automatically by the ADK runtime.
    """
    from a2a.types import AgentSkill

    # Advertise A2UI capability via SDK extension helper
    a2ui_extension = get_a2ui_agent_extension(
        version="0.8",
        supported_catalog_ids=a2ui_schema_manager.supported_catalog_ids,
    )

    return AgentCard(
        name=adk_app.name,
        description=adk_app.root_agent.description or f"Agent {adk_app.name}",
        url=f"{os.getenv('APP_URL', 'http://0.0.0.0:8000')}{A2A_RPC_PATH}",
        version=os.getenv("AGENT_VERSION", "0.1.0"),
        capabilities=AgentCapabilities(
            streaming=True,
            pushNotifications=True,
            extensions=[a2ui_extension],
        ),
        defaultInputModes=["text/plain"],
        defaultOutputModes=["text/plain", "application/json"],
        skills=[
            AgentSkill(
                id="general",
                name="General Skill",
                description="Handles general queries using BigQuery, Maps, Firestore, and other data sources.",
                tags=[],
            )
        ],
    )

@asynccontextmanager
async def lifespan(app_instance: FastAPI) -> AsyncIterator[None]:
    # CRITICAL: Register A2A routes IMMEDIATELY with a static agent card.
    # Do NOT call AgentCardBuilder.build() — it connects to ALL MCP servers
    # to discover tools, which hangs on slow/broken MCP connections and
    # prevents A2A routes from ever being registered.
    # MCP tool connections happen LAZILY on first user request.
    agent_card = _build_static_agent_card()
    a2a_app = A2AFastAPIApplication(agent_card=agent_card, http_handler=request_handler)
    a2a_app.add_routes_to_app(
        app_instance,
        agent_card_url=f"{A2A_RPC_PATH}{AGENT_CARD_WELL_KNOWN_PATH}",
        rpc_url=A2A_RPC_PATH,
        extended_agent_card_url=f"{A2A_RPC_PATH}{EXTENDED_AGENT_CARD_PATH}",
    )
    # --- Dependency Compatibility Check (read-only, log-only) ---
    try:
        import importlib.metadata as _meta
        import inspect as _insp
        _dep_issues = []
        # A2UI: version parameter must exist for GE compatibility
        _a2ui_sig = _insp.signature(_original_create_a2ui_part)
        if 'version' not in _a2ui_sig.parameters:
            _dep_issues.append("a2ui-agent-sdk: 'version' param missing from create_a2ui_part")
        # ADK: warn on untested major version
        try:
            _adk_v = _meta.version('google-adk')
            if int(_adk_v.split('.')[0]) >= 2:
                _dep_issues.append("google-adk " + _adk_v + ": untested major version")
        except Exception:
            pass
        if _dep_issues:
            for _di in _dep_issues:
                logger.log_text("[dep_check] WARNING " + _di)
        else:
            logger.log_text("[dep_check] All critical dependencies compatible")
    except Exception as _dep_err:
        logger.log_text("[dep_check] check failed: " + str(_dep_err))

    yield

app = FastAPI(
    title="tmp-ref-run",
    description="API for interacting with the Agent tmp-ref-run",
    lifespan=lifespan,
)

# --- Token Extraction Middleware ---
# ADK's A2aAgentExecutor now delegates to an internal ExecutorImpl, making
# _handle_request overrides ineffective. Instead, capture the OAuth token
# at the HTTP middleware level before the request reaches ADK.
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
import builtins

class TokenExtractionMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        token = None
        auth_id = os.environ.get("GEMINI_AUTHORIZATION_ID", "")
        
        # Strategy 1: Authorization header (Gemini Enterprise passes user token here)
        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
            logger.log_text(f"MIDDLEWARE: ✅ Token from Authorization header (prefix={token[:25]}..., len={len(token)})")
        
        # Strategy 2: x-authorization header (fallback)
        if not token:
            x_auth = request.headers.get("x-authorization", "")
            if x_auth.startswith("Bearer "):
                token = x_auth[7:]
                logger.log_text(f"MIDDLEWARE: ✅ Token from x-authorization header (prefix={token[:25]}..., len={len(token)})")
        
        # Strategy 3: Parse JSON body for call_context.state.headers.authorization
        if not token and request.url.path.startswith("/a2a/"):
            try:
                body = await request.body()
                if body:
                    import json
                    body_json = json.loads(body)
                    # Try JSON-RPC params.context or direct context
                    ctx = None
                    if 'params' in body_json and isinstance(body_json['params'], dict):
                        ctx = body_json['params'].get('context', {})
                    elif 'context' in body_json:
                        ctx = body_json.get('context', {})
                    
                    if ctx and isinstance(ctx, dict):
                        state = ctx.get('state', {})
                        if isinstance(state, dict):
                            # Check for auth_id key directly
                            if auth_id and auth_id in state:
                                token = state[auth_id]
                                logger.log_text(f"MIDDLEWARE: ✅ Token from body context.state['{auth_id}'] (prefix={str(token)[:25]}..., len={len(str(token))})")
                            # Check for headers.authorization in state
                            elif 'headers' in state and isinstance(state['headers'], dict):
                                h_auth = state['headers'].get('authorization', '')
                                if h_auth.startswith("Bearer "):
                                    token = h_auth[7:]
                                    logger.log_text(f"MIDDLEWARE: ✅ Token from body state.headers.authorization (prefix={token[:25]}..., len={len(token)})")
            except Exception as e:
                logger.log_text(f"MIDDLEWARE: ⚠️ Body parse error: {type(e).__name__}: {e}")
        
        if token:
            builtins._workspace_oauth_token = token
            # Also store in a request-scoped way via state
            request.state.oauth_token = token
        else:
            if request.url.path.startswith("/a2a/"):
                logger.log_text(f"MIDDLEWARE: ❌ No token found in request to {request.url.path}. Headers: {list(request.headers.keys())}")
        
        response = await call_next(request)
        return response

class DisableBufferingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if response.headers.get('content-type') == 'text/event-stream':
            response.headers['X-Accel-Buffering'] = 'no'
            response.headers['Cache-Control'] = 'no-cache, no-transform'
        return response

app.add_middleware(DisableBufferingMiddleware)
app.add_middleware(TokenExtractionMiddleware)

# =============================================================================
# Background Task Worker & Trigger Endpoints (Long-Running Agent Orchestration)
# =============================================================================
import asyncio as _bg_asyncio
from contextlib import nullcontext as _nullcontext

# --- Mitigation #3: Concurrency limit for background tasks ---
_WORKER_SEMAPHORE = _bg_asyncio.Semaphore(2)  # Max 2 concurrent background tasks

# --- Mitigation #4: OpenTelemetry tracing for worker visibility ---
try:
    from opentelemetry import trace as _otel_trace
    _worker_tracer = _otel_trace.get_tracer("background_worker")
except ImportError:
    _worker_tracer = None


def _fs_update_with_retry(_ref, _data, _max_retries=3):
    """Firestore update with exponential backoff for critical state transitions."""
    import time as _time, logging as _rlog
    for _attempt in range(_max_retries):
        try:
            _ref.update(_data)
            return True
        except Exception as _e:
            if _attempt == _max_retries - 1:
                _rlog.getLogger("bg_worker").error("Firestore update FAILED after %d retries: %s", _max_retries, str(_e)[:300])
                return False
            _wait = (2 ** _attempt) + 0.5
            _rlog.getLogger("bg_worker").warning("Firestore retry %d/%d in %.1fs: %s", _attempt + 1, _max_retries, _wait, str(_e)[:200])
            _time.sleep(_wait)


@app.post("/execute_task")
async def execute_task(request: Request):
    """Internal worker endpoint. Reads task config from Firestore,
    runs the agent, writes result back. Fire-and-forget from LRFT.
    Also handles Pub/Sub push messages from Cloud Scheduler."""
    import builtins, traceback as _tb
    import datetime as _dt
    import base64 as _b64, json as _bjson, logging as _wlog
    _wlogger = _wlog.getLogger("bg_worker")
    _body = await request.json()

    # --- Support both direct calls and Pub/Sub push messages ---
    # Direct call (from LRFT/localhost): {"task_id": "...", "demo_id": "..."}
    # Pub/Sub push (from Cloud Scheduler): {"message": {"data": "base64..."}}
    if "message" in _body and isinstance(_body.get("message"), dict):
        _msg_data = _body["message"].get("data", "")
        if _msg_data:
            try:
                _decoded = _bjson.loads(_b64.b64decode(_msg_data).decode("utf-8"))
                _task_id = _decoded.get("task_id", "")
                _demo_id = _decoded.get("demo_id", "")
                _wlogger.warning("execute_task: Pub/Sub trigger task_id=%s demo_id=%s", _task_id, _demo_id)
            except Exception as _parse_err:
                _wlogger.error("execute_task: Failed to parse Pub/Sub data: %s", str(_parse_err))
                _task_id = ""
                _demo_id = ""
        else:
            _task_id = ""
            _demo_id = ""
    else:
        _task_id = _body.get("task_id", "")
        _demo_id = _body.get("demo_id", "")

    _fs = getattr(builtins, '_firestore_client', None)
    if not _fs or not _task_id or not _demo_id:
        _wlogger.error("execute_task: Missing config (fs=%s, task_id=%s, demo_id=%s)", bool(_fs), repr(_task_id), repr(_demo_id))
        return {"status": "error", "message": "Missing config"}

    _exec_ref = _fs.collection(_demo_id + "_task_executions").document(_task_id)
    _def_ref = _fs.collection(_demo_id + "_task_definitions").document(_task_id)

    _def_doc = _def_ref.get()
    if not _def_doc.exists:
        return {"status": "error", "message": "Definition not found"}
    _def_data = _def_doc.to_dict()
    _task_prompt = _def_data.get("task_prompt", "")
    _task_name = _def_data.get("task_name", "unknown")

    # --- Mitigation #3: Acquire semaphore before execution ---
    async with _WORKER_SEMAPHORE:

        # --- Mitigation #4: Create OTel span for Cloud Trace visibility ---
        _span_ctx = _worker_tracer.start_as_current_span(
            "background_task." + _task_name,
            attributes={"task_id": _task_id, "task_name": _task_name}
        ) if _worker_tracer else _nullcontext()

        with _span_ctx:
            # Ensure execution document exists (scheduled tasks don't pre-create one)
            _exec_snap = _exec_ref.get()
            _current = _exec_snap.to_dict() if _exec_snap.exists else None

            # Check if cancelled before starting
            if _current and _current.get("status") == "cancelled":
                return {"status": "cancelled", "task_id": _task_id}

            # Idempotency guard: skip if already completed or failed
            # (prevents result-topic Pub/Sub re-triggers from overwriting status)
            if _current and _current.get("status") in ("completed", "failed"):
                _wlogger.warning("execute_task: task %s already %s, skipping re-execution", _task_id, _current.get("status"))
                return {"status": _current.get("status"), "task_id": _task_id}

            # Update status to working — use set(merge=True) so it works for
            # both pre-existing docs (immediate tasks) and new docs (scheduled tasks)
            _now = _dt.datetime.now(_dt.timezone.utc).isoformat()
            _exec_ref.set({
                "task_id": _task_id,
                "definition_id": _task_id,
                "status": "working",
                "started_at": _now,
                "progress_pct": 10,
                "log_tail": "",
                "result_summary": "",
                "completed_at": "",
                "reported_to_user": False,
            }, merge=True)
            _wlogger.warning("execute_task: STARTING task=%s name=%s prompt_len=%d prompt_head=%s", _task_id, _task_name, len(_task_prompt), repr(_task_prompt[:200]))

            try:
                # Run agent with task prompt using the background runner (Pro model)
                _runner = background_runner
                _session_id = "task-" + _task_id
                _user_id = "background-worker"
                # Delete existing session if present (scheduled task re-execution safety)
                _existing_session = await _runner.session_service.get_session(
                    app_name=_runner.app_name,
                    user_id=_user_id,
                    session_id=_session_id,
                )
                if _existing_session:
                    await _runner.session_service.delete_session(
                        app_name=_runner.app_name,
                        user_id=_user_id,
                        session_id=_session_id,
                    )
                await _runner.session_service.create_session(
                    app_name=_runner.app_name,
                    user_id=_user_id,
                    session_id=_session_id,
                )
                from google.genai import types as _genai_types

                # The background_agent has execution directives baked into
                # its system prompt — no need for runtime _exec_directive.
                _full_prompt = _task_prompt

                _results = []
                _tool_calls = []
                _event_count = 0
                _cancel_check_counter = 0
                async for event in _runner.run_async(
                    user_id=_user_id,
                    session_id=_session_id,
                    new_message=_genai_types.Content(
                        role="user",
                        parts=[_genai_types.Part(text=_full_prompt)],
                    ),
                ):
                    _event_count += 1

                    # Track tool calls for diagnostics
                    if event.content and event.content.parts:
                        for _ep in event.content.parts:
                            if hasattr(_ep, 'function_call') and _ep.function_call:
                                _fc_name = _ep.function_call.name if _ep.function_call.name else "unknown"
                                _tool_calls.append(_fc_name)
                                _wlogger.warning("execute_task: TOOL_CALL task=%s tool=%s", _task_id, _fc_name)
                            if hasattr(_ep, 'function_response') and _ep.function_response:
                                _fr_name = _ep.function_response.name if _ep.function_response.name else "unknown"
                                _wlogger.warning("execute_task: TOOL_RESULT task=%s tool=%s", _task_id, _fr_name)

                    # Cooperative cancellation check (every 10 events to reduce Firestore reads)
                    _cancel_check_counter += 1
                    if _cancel_check_counter % 10 == 0:
                        try:
                            _check_snap = _exec_ref.get()
                            _check = _check_snap.to_dict() if _check_snap.exists else {}
                            if _check.get("status") == "cancelled":
                                _wlogger.warning("execute_task: CANCELLED task=%s after %d events", _task_id, _event_count)
                                return {"status": "cancelled", "task_id": _task_id}
                        except Exception:
                            pass  # Check failure should not stop task execution

                    if event.is_final_response() and event.content and event.content.parts:
                        for _p in event.content.parts:
                            if hasattr(_p, 'text') and _p.text:
                                _results.append(_p.text)

                _result_text = chr(10).join(_results) if _results else "No output"
                # Strip A2UI blocks from result — they are session-specific UI artifacts
                # that become meaningless when stored and replayed later.
                import re as _re_strip
                _result_text = _re_strip.sub(r'<a2ui-json>.*?</a2ui-json>', '', _result_text, flags=_re_strip.DOTALL).strip()
                _completed_at = _dt.datetime.now(_dt.timezone.utc).isoformat()

                # Warn if no tool calls were made — the agent likely just planned/described
                if not _tool_calls:
                    _wlogger.warning("execute_task: NO_TOOL_CALLS task=%s events=%d — agent may not have executed operations", _task_id, _event_count)

                _final_status = "completed"
                _fs_update_with_retry(_exec_ref, {
                    "status": _final_status,
                    "progress_pct": 100,
                    "result_summary": _result_text[:2000],
                    "completed_at": _completed_at,
                    "reported_to_user": False,
                    "tool_calls": _tool_calls[:50],
                    "event_count": _event_count,
                })
                _wlogger.warning("execute_task: COMPLETED task=%s events=%d tools=%s result_len=%d", _task_id, _event_count, repr(_tool_calls[:10]), len(_result_text))

                # Send A2A push notification if configured
                await _send_push_notification(_fs, _demo_id, _task_id, _final_status, _result_text[:500])

                # Publish to result topic for trigger EP notification
                try:
                    from google.cloud import pubsub_v1
                    import json as _pjson
                    _publisher = pubsub_v1.PublisherClient()
                    _project = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
                    _topic = "projects/" + _project + "/topics/" + _demo_id + "-task-results"
                    _publisher.publish(_topic, _pjson.dumps({"task_id": _task_id, "demo_id": _demo_id, "status": _final_status}).encode("utf-8"))
                except Exception:
                    pass

                return {"status": _final_status, "task_id": _task_id}

            except Exception as _e:
                _wlogger.error("execute_task: FAILED task=%s error=%s", _task_id, str(_e)[:500])
                _fs_update_with_retry(_exec_ref, {
                    "status": "failed",
                    "log_tail": str(_e)[:500],
                    "completed_at": _dt.datetime.now(_dt.timezone.utc).isoformat(),
                })
                await _send_push_notification(_fs, _demo_id, _task_id, "failed", str(_e)[:200])
                return {"status": "failed", "error": str(_e)[:200]}


async def _send_push_notification(_fs, _demo_id, _task_id, _status, _message):
    """Sends A2A push notification if client configured a webhook."""
    if not _fs or not _demo_id:
        return
    try:
        _config_ref = _fs.collection(_demo_id + "_task_push_configs").document(_task_id)
        _config_doc = _config_ref.get()
        if not _config_doc.exists:
            return
        _config = _config_doc.to_dict()
        _webhook_url = _config.get("webhook_url", "")
        if not _webhook_url:
            return

        import httpx as _httpx
        import json as _pjson
        _payload = {
            "jsonrpc": "2.0",
            "method": "tasks/pushNotification",
            "params": {
                "taskId": _task_id,
                "status": {"state": _status, "message": _message[:500]},
            },
        }
        async with _httpx.AsyncClient(timeout=10) as _client:
            await _client.post(_webhook_url, json=_payload)
    except Exception:
        pass


# --- Push Notification Configuration Endpoint (A2A Standard) ---
@app.post("/tasks/pushNotification/set")
async def set_push_notification(request: Request):
    """A2A-compliant endpoint for clients to register push notification webhooks."""
    import builtins
    _body = await request.json()
    _params = _body.get("params", {})
    _task_id = _params.get("taskId", "")
    _config = _params.get("pushNotificationConfig", {})
    _webhook_url = _config.get("url", "")

    _fs = getattr(builtins, '_firestore_client', None)
    _demo_id = os.environ.get("DEMO_ID", "")
    if not _fs or not _demo_id or not _task_id:
        return {"jsonrpc": "2.0", "error": {"code": -32602, "message": "Invalid params"}}

    _fs.collection(_demo_id + "_task_push_configs").document(_task_id).set({
        "task_id": _task_id,
        "webhook_url": _webhook_url,
        "authentication": _config.get("authentication", {}),
    })
    return {"jsonrpc": "2.0", "result": {"taskId": _task_id, "status": "configured"}}


@app.post("/feedback")
def collect_feedback(feedback: Feedback) -> dict[str, str]:
    logger.log_struct(feedback.model_dump(), severity="INFO")
    return {"status": "success"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
__FAST_API_EOF__
  perl -pi -e "s/tmp-ref-run/${dirName}/g" app/fast_api_app.py 2>/dev/null || true

  cd ..

# --- 9. Final Launch & Tips ---


  echo ""
  echo "========================================================="
  echo "🚀 DEPLOYING TO GEMINI ENTERPRISE"
  echo "========================================================="
  
  echo "🤖 Step 1/2: Deploying Main Agent to Cloud Run..."
  cd adk_agent
  
  
  ${ (() => {
    if (!params.importedMcpList || params.importedMcpList.length === 0) return "";
    
    let script = `
# Enable Secret Manager API
echo "Enabling Secret Manager API..."
gcloud services enable secretmanager.googleapis.com
`;

    params.importedMcpList.forEach((mcp, mcpIdx) => {
      // -- Remote Managed MCP (Slack): token already in Secret Manager from provisioning --
      if (mcp.type === 'remote' && mcp.auth_type === 'oauth2_slack') {
        // Slack token stored in Secret Manager during provisioning step
        return;
      }
      // ── Sidecar MCP ──
      const githubUrl = mcp.github_url;
      let repoName = "mcp-server";
      if (githubUrl) {
        const parts = githubUrl.split("/");
        let lastPart = parts[parts.length - 1] || parts[parts.length - 2];
        repoName = lastPart.replace(/\.git$/, "").toLowerCase().replace(/[^a-z0-9-]/g, "-");
      }
      const serviceName = `${dirName}-mcp-${repoName}`;
      // Only show "Provisioning Secrets" message if this MCP actually has secret env vars
      const hasSecrets = mcp.required_env_vars && mcp.required_env_vars.some(v => v.is_secret);
      if (!hasSecrets) return;
      script += `\necho "🔑 Provisioning Secrets for MCP #${mcpIdx + 1} (${repoName})..."\n`;

      mcp.required_env_vars.forEach(v => {
      const rawKey = v.key.toLowerCase().replace(/_/g, "-");
      let secretName = `${serviceName}-${rawKey}`;
      // Uniquify words
      secretName = secretName.split("-").filter((word, pos, arr) => arr.indexOf(word) === pos).join("-");

      if (v.is_secret && v.is_required) {
        // Required secrets: fallback to "UNDEFINED" if not provided
        script += `if [ -z "\$${v.key}" ]; then\n  ${v.key}="UNDEFINED"\nfi\n`;
        script += `if gcloud secrets describe ${secretName} >/dev/null 2>&1; then\n`;
        script += `  echo -n "\$${v.key}" | gcloud secrets versions add ${secretName} --data-file=-\n`;
        script += `else\n`;
        script += `  echo -n "\$${v.key}" | gcloud secrets create ${secretName} --data-file=- --replication-policy="automatic"\n`;
        script += `fi\n`;
      } else if (v.is_secret && !v.is_required) {
        // Optional secrets: only create if user provided a value
        script += `if [ -n "\$${v.key}" ]; then\n`;
        script += `  if gcloud secrets describe ${secretName} >/dev/null 2>&1; then\n`;
        script += `    echo -n "\$${v.key}" | gcloud secrets versions add ${secretName} --data-file=-\n`;
        script += `  else\n`;
        script += `    echo -n "\$${v.key}" | gcloud secrets create ${secretName} --data-file=- --replication-policy="automatic"\n`;
        script += `  fi\n`;
        script += `else\n`;
        script += `  echo "  ⏭️  Skipping optional secret: ${v.key}"\n`;
        script += `fi\n`;
      }
      });
    });
    return script;
  })() }

  # Grant Secret Manager access to default Compute Engine SA (required for --update-secrets)
  COMPUTE_NUM=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
  COMPUTE_SA="\${COMPUTE_NUM}-compute@developer.gserviceaccount.com"
  echo "🔐 Granting Secret Accessor role to Cloud Run service account..."
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \\
    --member="serviceAccount:$COMPUTE_SA" \\
    --role="roles/secretmanager.secretAccessor" \\
    --condition=None --quiet >/dev/null 2>&1 || true

  SERVICE_NAME="${dirName}"

  # --- Pre-create Pub/Sub topics in background (no dependency on SERVICE_URL) ---
  SCHED_TOPIC="${dirName}-sched-tasks"
  RESULT_TOPIC="${dirName}-task-results"
  echo "📨 Pre-creating Pub/Sub topics (parallel with deploy)..."
  gcloud pubsub topics create "$SCHED_TOPIC" --project="$PROJECT_ID" 2>/dev/null &
  gcloud pubsub topics create "$RESULT_TOPIC" --project="$PROJECT_ID" 2>/dev/null &

  DEPLOY_LOG=$(mktemp /tmp/deploy-XXXXXX.log)
  trap "rm -f \$DEPLOY_LOG" EXIT
  echo "🤖 Deploying Main Agent to Cloud Run via Source..."
  
  ${ (() => {
    let envVars = [
      "GOOGLE_CLOUD_PROJECT=\$PROJECT_ID",
      "GOOGLE_CLOUD_LOCATION=global",
      "MAPS_API_KEY=\$API_KEY",
      "GEMINI_AUTHORIZATION_ID=\$AUTH_ID",
      "ADK_ENABLE_MCP_GRACEFUL_ERROR_HANDLING=1",
      `DEMO_ID=${dirName}`
    ];
    let secrets = [];
    let optionalSecrets = [];
    
    if (params.enableWorkspaceMcp) {
      secrets.push(`OAUTH_CLIENT_ID=ge-demo-oauth-client-id:latest`);
      secrets.push(`OAUTH_CLIENT_SECRET=ge-demo-oauth-client-secret:latest`);
    }
    
    if (params.importedMcpList && params.importedMcpList.length > 0) {
      params.importedMcpList.forEach((mcp, mcpIdx) => {
        // ── Remote Managed MCP (Slack) ──
        if (mcp.type === 'remote' && mcp.auth_type === 'oauth2_slack') {
          // Slack MCP: static token from Secret Manager
          secrets.push(`SLACK_ACCESS_TOKEN=${dirName}-slack-token:latest`);
          return;
        }
        // ── Sidecar MCP ──
        const githubUrl = mcp.github_url;
        let repoName = "mcp-server";
        if (githubUrl) {
          const parts = githubUrl.split("/");
          let lastPart = parts[parts.length - 1] || parts[parts.length - 2];
          repoName = lastPart.replace(/\.git$/, "").toLowerCase().replace(/[^a-z0-9-]/g, "-");
        }
        const serviceName = `${dirName}-mcp-${repoName}`;

        mcp.required_env_vars.forEach(v => {
          const rawKey = v.key.toLowerCase().replace(/_/g, "-");
          let secretName = `${serviceName}-${rawKey}`;
          secretName = secretName.split("-").filter((word, pos, arr) => arr.indexOf(word) === pos).join("-");

          if (v.is_secret && v.is_required) {
            // Required secrets: always bind to Cloud Run
            secrets.push(`${v.key}=${secretName}:latest`);
          } else if (v.is_secret && !v.is_required) {
            // Optional secrets: bind only if the secret exists (provisioned above)
            optionalSecrets.push({ key: v.key, secretName: secretName });
          } else {
            envVars.push(`${v.key}=\$${v.key}`);
          }
        });

        // Credential file mount support
        if (mcp.credential_file) {
          const credSuffix = params.importedMcpList.length > 1 ? `-${mcpIdx}` : '';
          envVars.push(`CREDENTIAL_SECRET_NAME_${mcpIdx}=${dirName}-mcp-adc-json${credSuffix}`);
          envVars.push(`CREDENTIAL_ENV_VAR_${mcpIdx}=${mcp.credential_file.env_var_name}`);
        }
      });
    }
    
    let deployCmd = '';

    if (optionalSecrets.length > 0) {
      deployCmd += `\n# Discover provisioned optional secrets\nOPTIONAL_SECRETS=""\n`;
      optionalSecrets.forEach(os => {
        deployCmd += `if gcloud secrets describe ${os.secretName} >/dev/null 2>&1; then\n`;
        deployCmd += `  OPTIONAL_SECRETS="\${OPTIONAL_SECRETS:+\$OPTIONAL_SECRETS,}${os.key}=${os.secretName}:latest"\n`;
        deployCmd += `fi\n`;
      });
      const baseSecrets = secrets.length > 0 ? secrets.join(',') : '';
      deployCmd += `\n# Build final secrets flag\n`;
      if (baseSecrets) {
        deployCmd += `ALL_SECRETS="${baseSecrets}"\n`;
        deployCmd += `if [ -n "\$OPTIONAL_SECRETS" ]; then\n`;
        deployCmd += `  ALL_SECRETS="\$ALL_SECRETS,\$OPTIONAL_SECRETS"\n`;
        deployCmd += `fi\n`;
      } else {
        deployCmd += `ALL_SECRETS="\$OPTIONAL_SECRETS"\n`;
      }
      deployCmd += `\nSECRETS_FLAG=""\nif [ -n "\$ALL_SECRETS" ]; then\n  SECRETS_FLAG="--update-secrets=\$ALL_SECRETS"\nfi\n`;
      deployCmd += `\nCR_ENV_VARS="${envVars.join(",")}"\nif [ "\$VIEWER_DEPLOYED" = "true" ]; then\n  CR_ENV_VARS="\$CR_ENV_VARS,DATA_VIEWER_URL=\$VIEWER_URL"\nfi\nCR_ENV_VARS="\$CR_ENV_VARS,SANDBOX_RESOURCE_NAME=\$SANDBOX_RESOURCE_NAME"\n`;
      deployCmd += `\ngcloud run deploy "\$SERVICE_NAME" \
    --source .. \
    --memory "4Gi" \
    --cpu 2 \
    --no-cpu-throttling \
    --cpu-boost \
    --min-instances 1 \
    --timeout 1800 \
    --no-allow-unauthenticated \
    --ingress internal \
    --labels "created-by=adk" \
    --set-env-vars="\$CR_ENV_VARS" \
    \$SECRETS_FLAG \
    --region us-central1 \
    --quiet > "\$DEPLOY_LOG" 2>&1 &`;
    } else {
      deployCmd = `CR_ENV_VARS="${envVars.join(",")}"\nif [ "\$VIEWER_DEPLOYED" = "true" ]; then\n  CR_ENV_VARS="\$CR_ENV_VARS,DATA_VIEWER_URL=\$VIEWER_URL"\nfi\nCR_ENV_VARS="\$CR_ENV_VARS,SANDBOX_RESOURCE_NAME=\$SANDBOX_RESOURCE_NAME"\ngcloud run deploy "\$SERVICE_NAME" \
    --source .. \
    --memory "4Gi" \
    --cpu 2 \
    --no-cpu-throttling \
    --cpu-boost \
    --min-instances 1 \
    --timeout 1800 \
    --no-allow-unauthenticated \
    --ingress internal \
    --labels "created-by=adk" \
    --set-env-vars="\$CR_ENV_VARS"`;
      if (secrets.length > 0) {
        deployCmd += ` \\\n    --update-secrets="${secrets.join(",")}"`;
      }
      deployCmd += ` \\\n    --region us-central1 \\\n    --quiet > "\$DEPLOY_LOG" 2>&1 &`;
    }

    return deployCmd;
  })() }
  DEPLOY_PID=$!
  printf "   ⏳ Deploying"
  while kill -0 $DEPLOY_PID 2>/dev/null; do
    printf "."
    sleep 5
  done
  echo ""
  wait $DEPLOY_PID
  DEPLOY_EXIT=$?
  if [ $DEPLOY_EXIT -ne 0 ]; then
    echo "   ❌ Cloud Run deployment failed. Build log:"
    echo "---------------------------------------------------------"
    cat "$DEPLOY_LOG"
    echo "---------------------------------------------------------"
    rm -f "$DEPLOY_LOG"
    exit 1
  fi
  echo "   ✅ Cloud Run deployment succeeded."
  rm -f "$DEPLOY_LOG"
  SERVICE_URL=$(gcloud run services list --filter="metadata.name:$SERVICE_NAME" --format="value(status.url)" | head -n 1)

  # --- Background Task Infrastructure: Pub/Sub subscriptions + SELF_URL (parallel) ---
  echo ""
  echo "📨 Finalizing background task infrastructure..."
  # Wait for topic pre-creation to finish before creating subscriptions
  wait 2>/dev/null || true
  echo "  ✅ Pub/Sub topics ready"

  # Create subscriptions and update SELF_URL in parallel (all depend on SERVICE_URL, but not on each other)
  gcloud pubsub subscriptions create "\${SCHED_TOPIC}-push" \\
    --topic="$SCHED_TOPIC" \\
    --push-endpoint="$SERVICE_URL/execute_task" \\
    --push-auth-service-account="$COMPUTE_SA" \\
    --ack-deadline=600 \\
    --project="$PROJECT_ID" 2>/dev/null &
  # NOTE: Result topic push subscription intentionally NOT created here.
  # The result topic is for downstream consumers (e.g. external notifications),
  # NOT for re-triggering /execute_task (which causes session collision).
  gcloud run services update "$SERVICE_NAME" \\
    --update-env-vars="SELF_URL=$SERVICE_URL" \\
    --region us-central1 \\
    --quiet 2>/dev/null &
  wait || true
  echo "  ✅ Pub/Sub push subscriptions created"
  echo "  ✅ SELF_URL env var set"

  # Project-level IAM binding for Discovery Engine SA is assumed to be active.
  # No resource-level binding needed.
  echo ""
  echo "🤖 Step 2/2: Registering Agent to Gemini Enterprise..."
  # Get a fresh access token — use application-default (cloud-platform scope) first, fallback to user credentials
  TOKEN=$(gcloud auth application-default print-access-token 2>/dev/null || gcloud auth print-access-token)
  APP_COUNT=0
  APP_NAMES=()
  APP_DISPLAY_NAMES=()
  APP_LOCS=()
  
  for LOC in "global" "us" "eu"; do
    if [ "$LOC" = "global" ]; then
      ENDPOINT="discoveryengine.googleapis.com"
    else
      ENDPOINT="$LOC-discoveryengine.googleapis.com"
    fi
    JSON=$(curl -s -H "Authorization: Bearer $TOKEN" -H "X-Goog-User-Project: $PROJECT_ID" \
        "https://$ENDPOINT/v1alpha/projects/$PROJECT_ID/locations/$LOC/collections/default_collection/engines")
    
    # Collect names and displayNames of Gemini Enterprise apps
    APPS_INFO=$(echo "$JSON" | python3 -c '
import sys, json
try:
    data = json.load(sys.stdin)
    engines = [e for e in data.get("engines", []) if e.get("searchEngineConfig", {}).get("requiredSubscriptionTier") == "SUBSCRIPTION_TIER_SEARCH_AND_ASSISTANT"]
    for e in engines:
        print(e["name"] + "|" + e["displayName"])
except Exception as e:
    print(f"Python error: {e}", file=sys.stderr)
')
    
    if [ ! -z "$APPS_INFO" ]; then
      while read -r line; do
        if [ ! -z "$line" ]; then
          NAME=$(echo "$line" | cut -d'|' -f1)
          DISPLAY_NAME=$(echo "$line" | cut -d'|' -f2)
          APP_NAMES+=("$NAME")
          APP_DISPLAY_NAMES+=("$DISPLAY_NAME")
          APP_LOCS+=("$LOC")
          APP_COUNT=$((APP_COUNT + 1))
        fi
      done <<< "$APPS_INFO"
    fi
  done
  
  # Create Python script for registration to avoid bash escaping hell
  cat << 'EOF' > register_agent.py
import sys
import json
import urllib.request
import urllib.error

endpoint_loc = sys.argv[1]
project_id = sys.argv[2]
location = sys.argv[3]
app_id = sys.argv[4]
token = sys.argv[5]
agent_name = sys.argv[6]
agent_url = sys.argv[7]
agent_short_name = sys.argv[8]
one_sentence_summary = sys.argv[9]
auth_id = sys.argv[10] if len(sys.argv) > 10 else ""

endpoint = "discoveryengine.googleapis.com" if endpoint_loc == "global" else f"{endpoint_loc}-discoveryengine.googleapis.com"
url = f"https://{endpoint}/v1alpha/projects/{project_id}/locations/{location}/collections/default_collection/engines/{app_id}/assistants/default_assistant/agents"

headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json",
    "X-Goog-User-Project": project_id,
}

data = {
    "name": agent_name,
    "displayName": f"{agent_short_name} ({agent_name})",
    "description": one_sentence_summary,
    "a2aAgentDefinition": {
        "jsonAgentCard": json.dumps({
            "protocolVersion": "1.0",
            "name": agent_name,
            "description": one_sentence_summary,
            "url": agent_url,
            "version": "1.0.0",
            "defaultInputModes": ["text/plain"],
            "defaultOutputModes": ["text/plain", "application/json"],
            "capabilities": {
                "streaming": True,
                "extensions": [
                    {
                        "uri": "https://a2ui.org/a2a-extension/a2ui/v0.8"
                    }
                ]
            },
            "preferredTransport": "JSONRPC",
            "skills": [
                {
                    "id": "general",
                    "name": "General Skill",
                    "description": "Handles general queries",
                    "tags": []
                }
            ]
        })
    }
}

if auth_id:
    if auth_id.startswith("projects/"):
        data["authorizationConfig"] = { "agentAuthorization": auth_id }
    else:
        data["authorizationConfig"] = { "agentAuthorization": f"projects/{project_id}/locations/{location}/authorizations/{auth_id}" }

req = urllib.request.Request(url, data=json.dumps(data).encode("utf-8"), headers=headers)
try:
    with urllib.request.urlopen(req) as response:
        resp_data = json.loads(response.read().decode("utf-8"))
        print("Successfully registered agent:")
        print(json.dumps(resp_data, indent=2))
        agent_name = resp_data.get("name", "")
        agent_id = agent_name.split("/")[-1]
        print(f"AGENT_ID:{agent_id}")



except urllib.error.HTTPError as e:
    print(f"Error registering agent: {e}", file=sys.stderr)
    print(e.read().decode("utf-8"), file=sys.stderr)
    sys.exit(1)
except Exception as e:
    print(f"Unexpected error: {e}", file=sys.stderr)
    sys.exit(1)
EOF

  if [ "$APP_COUNT" = "1" ]; then
    SELECTED_APP_ID=$(echo "\${APP_NAMES[0]}" | awk -F'/' '{print \$NF}')
    SELECTED_LOC="\${APP_LOCS[0]}"
    echo "✅ Found exactly one Gemini Enterprise app ($SELECTED_APP_ID). Automating registration..."

    REG_OUTPUT=$(python3 register_agent.py "$SELECTED_LOC" "$PROJECT_NUMBER" "$SELECTED_LOC" "$SELECTED_APP_ID" "$TOKEN" "${dirName}" "$SERVICE_URL/a2a/app" '${safeShortName}' '${safeSummary}' "$AUTH_ID")
    echo "$REG_OUTPUT"
    AGENT_ID=$(echo "$REG_OUTPUT" | grep "AGENT_ID:" | cut -d':' -f2)
    rm register_agent.py
    
  else
    if [ "$APP_COUNT" = "0" ]; then
      echo "⚠️ No Gemini Enterprise apps found in 'global', 'us', or 'eu'. You might need to create one first."
      echo "After creating an app, you can register the agent manually or re-run the script."
    else
      echo "💡 Found \$APP_COUNT Gemini Enterprise apps across regions:"
      for i in "\${!APP_DISPLAY_NAMES[@]}"; do
        echo "[\$i] \${APP_DISPLAY_NAMES[\$i]} (\${APP_LOCS[\$i]})"
      done
      
      CHOICE=""
      while true; do
        read -p "Select which app to register the agent to (0-\$((APP_COUNT-1))): " CHOICE
        if [[ "\$CHOICE" =~ ^[0-9]+$ ]] && [ "\$CHOICE" -ge 0 ] && [ "\$CHOICE" -lt "\$APP_COUNT" ]; then
          break
        fi
        echo "Invalid selection. Please enter a number between 0 and \$((APP_COUNT-1))."
      done
      
      SELECTED_APP_ID=$(echo "\${APP_NAMES[\$CHOICE]}" | awk -F'/' '{print \$NF}')
      SELECTED_LOC="\${APP_LOCS[\$CHOICE]}"
      
      echo "✅ Selected app: \${APP_DISPLAY_NAMES[\$CHOICE]}. Automating registration..."
      
      REG_OUTPUT=$(python3 register_agent.py "\$SELECTED_LOC" "\$PROJECT_NUMBER" "\$SELECTED_LOC" "\$SELECTED_APP_ID" "\$TOKEN" "${dirName}" "\$SERVICE_URL/a2a/app" '${safeShortName}' '${safeSummary}' "\$AUTH_ID")
      echo "\$REG_OUTPUT"
      AGENT_ID=$(echo "\$REG_OUTPUT" | grep "AGENT_ID:" | cut -d':' -f2)
      rm register_agent.py
    fi
  fi


  
  cd ..
  
  echo "========================================================="
  if [ ! -z "\$AGENT_ID" ]; then
    echo "🎉 Gemini Enterprise Deployment & Registration Complete!"
  else
    echo "⚠️ Gemini Enterprise Deployment Complete (Manual Registration Required)"
  fi
  echo "========================================================="
  echo ""
  echo "🌟 Agent Profile"
  echo "---------------------------------------------------------"
  echo '🤖 Agent Name:   ${safeShortName} (${dirName})'
  echo '📝 Description:  ${safeSummary}'
  echo ""
  echo "🗄️ Data Resources"
  echo "---------------------------------------------------------"
  echo "📂 Demo Asset Directory: ~/${dirName}"
  echo "📊 BigQuery Dataset:    ${datasetId}"
  echo "🔥 Firestore:           ${fsCollection}"
  ${ (params.importedMcpList && params.importedMcpList.length > 0) ? `
  echo ""
  echo "🔌 Custom MCP Servers (${params.importedMcpList.length})"
  echo "---------------------------------------------------------"
${params.importedMcpList.map((mcp, idx) => {
  if (mcp.type === 'remote') {
    return `  echo "  #${idx + 1}: ${mcp.name || 'Remote MCP'} (managed: ${mcp.endpoint_url})"`;
  }
  const rn = mcp.github_url.split('/').pop().replace(/\.git$/, '');
  return `  echo "  #${idx + 1}: ${rn} (port ${9090 + idx})"`;
}).join('\n')}` : '' }
  echo ""
  echo "🔗 Quick Access Links"
  echo "---------------------------------------------------------"
  if [ ! -z "\$AGENT_ID" ]; then
    echo "💬 Start Chatting in Gemini Enterprise:"
    echo "   👉 https://console.cloud.google.com/gemini-enterprise/locations/\$SELECTED_LOC/engines/\$SELECTED_APP_ID/overview/dashboard?&project=\$PROJECT_ID"
    echo "   💡 Click the 'Preview' button at the top to launch Gemini Enterprise, then select 'Agents' from the left menu to start chatting with your deployed agent."
    echo ""
  else
    echo "💻 Gemini Enterprise Console:"
    echo "   👉 https://console.cloud.google.com/gemini-enterprise/overview?&project=\$PROJECT_ID"
    echo ""
  fi
  
  if [ "\$VIEWER_DEPLOYED" = "true" ]; then
    echo "📊 Firestore Data Viewer:"
    echo "   👉 \$VIEWER_URL"
    echo ""
  else
    echo "📊 Firestore Data Viewer: Not Deployed (Skipped or restricted by Org Policy)"
    echo ""
  fi

  echo "🔎 BigQuery Console:"
  echo "   👉 https://console.cloud.google.com/bigquery?referrer=search&project=\$PROJECT_ID&ws=!1m4!1m3!3m2!1s\$PROJECT_ID!2s${datasetId}"
  echo ""
  echo "========================================================="
  echo ""
  echo "💡 Next Steps:"
  echo "• Copy the demo prompts from the Web UI and try them in the Chat URL!"
  echo "• To clean up all resources, run:"
  echo "  \$ cd ~ && bash setup-${dirName}.sh --cleanup"
  echo "========================================================="
  exit 0


`;

  return fullScript;
}

// ===========================================
// Domain Research (Company Lookup)
// ===========================================

/**
 * Researches a company by its domain name using Gemini + Google Search grounding.
 * Returns company info, business challenges, workflows, and a suggested agent goal.
 * @param {string} domain - Customer domain (e.g., "toyota.co.jp")
 * @returns {Object} Structured company research results
 */
function researchCompanyByDomain(domain) {
  if (!domain || typeof domain !== 'string') {
    return { success: false, error: 'Domain is required.' };
  }

  // Normalize domain
  domain = domain.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/.*$/, '');

  // Determine response language from TLD
  const tldLangMap = {
    '.co.jp': '日本語', '.jp': '日本語', '.ne.jp': '日本語', '.or.jp': '日本語', '.ac.jp': '日本語',
    '.de': 'Deutsch', '.fr': 'Français', '.es': 'Español', '.it': 'Italiano',
    '.cn': '中文', '.tw': '中文', '.kr': '한국어', '.br': 'Português',
    '.ru': 'Русский', '.nl': 'Nederlands', '.se': 'Svenska', '.fi': 'Suomi',
    '.in': 'English', '.co.uk': 'English', '.com.au': 'English',
    '.com': 'English', '.io': 'English', '.ai': 'English', '.org': 'English', '.net': 'English'
  };

  let responseLang = 'English';
  // Match longest TLD first (e.g., .co.jp before .jp)
  const sortedTlds = Object.keys(tldLangMap).sort((a, b) => b.length - a.length);
  for (const tld of sortedTlds) {
    if (domain.endsWith(tld)) {
      responseLang = tldLangMap[tld];
      break;
    }
  }

  const prompt = `You are a business analyst researching a company for an AI agent demo preparation.
Research the company behind the domain "${domain}" using the latest available information from the internet.

**RESPONSE LANGUAGE**: Respond entirely in ${responseLang}.

Provide the following information in a structured JSON format:
1. **companyName**: Official company name
2. **companySummary**: Brief company overview (industry, scale, main business areas, headquarters location) in 2-3 sentences
3. **industry**: Primary industry classification (e.g., "Manufacturing", "Retail", "Financial Services")
4. **businessChallenges**: Array of 3-5 key business challenges the company is likely facing based on their industry, recent news, and market position
5. **workflows**: Array of 5-8 key business workflows/processes, each with:
   - "name": Workflow name
   - "automatable": boolean — whether this workflow is a good candidate for AI agent automation
   - "reason": Brief reason why it is or isn't suitable for agent automation
6. **suggestedGoal**: A detailed business scenario description (3-5 sentences) suitable as input for an AI agent demo generator. This should:
   - Reference the actual company name and industry
   - Focus on the MOST automatable workflow(s) identified above
   - Describe a specific, actionable business problem that an AI agent could solve
   - Include realistic operational context (data sources, stakeholders, KPIs)
   - Follow the theme of "Autonomous Action and Core System Optimization" — the agent should detect events, analyze data, and actively update core systems

**IMPORTANT**:
- Use REAL, factual information about this company. Do NOT hallucinate or invent details.
- If you cannot find sufficient information about the company, set "success" to false and provide an error message.
- Focus on workflows where AI agents can provide the most business value through automation.

Output pure JSON only (no code blocks, no markdown):
{
  "companyName": "...",
  "companySummary": "...",
  "industry": "...",
  "businessChallenges": ["...", "..."],
  "workflows": [
    {"name": "...", "automatable": true, "reason": "..."},
    {"name": "...", "automatable": false, "reason": "..."}
  ],
  "suggestedGoal": "..."
}`;

  try {
    // Direct API call with flash-lite model for speed + higher token limit
    let location = CONFIG.LOCATION || 'global';
    const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
    const researchModel = 'gemini-3.1-flash-lite';
    const url = `https://${host}/v1/projects/${CONFIG.PROJECT_ID}/locations/${location}/publishers/google/models/${researchModel}:generateContent`;
    
    const payload = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ googleSearch: {} }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 65535 }
    };
    const apiResponse = UrlFetchApp.fetch(url, {
      method: 'POST',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    if (apiResponse.getResponseCode() !== 200) {
      throw new Error('AI Search Error: ' + apiResponse.getContentText().substring(0, 200));
    }
    
    // Google Search grounding can return text across multiple parts — concatenate all
    const candidate = JSON.parse(apiResponse.getContentText()).candidates[0];
    const allText = candidate.content.parts
      .filter(p => p.text)
      .map(p => p.text)
      .join('');
    
    console.log('[RESEARCH] Raw response length: ' + allText.length);
    
    let jsonStr = allText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
      // Attempt to extract JSON from response
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        console.error('[RESEARCH] Failed to parse. Raw text: ' + jsonStr.substring(0, 500));
        throw new Error('Failed to parse research results. The AI response did not contain valid JSON.');
      }
    }

    // Validate required fields
    if (!parsed.companyName || !parsed.suggestedGoal) {
      return { success: false, error: 'Could not find sufficient information for domain: ' + domain };
    }

    return {
      success: true,
      companyName: parsed.companyName,
      companySummary: parsed.companySummary || '',
      industry: parsed.industry || '',
      businessChallenges: parsed.businessChallenges || [],
      workflows: parsed.workflows || [],
      suggestedGoal: parsed.suggestedGoal
    };
  } catch (e) {
    console.error('[RESEARCH] Error for domain ' + domain + ':', e.message);
    return { success: false, error: 'Research failed: ' + e.message };
  }
}

/**
 * Regenerates a business scenario (suggestedGoal) based on user-selected workflows.
 * Called when the user customizes the workflow selection after domain research,
 * ensuring the Business Scenario section stays consistent with the selected workflows.
 * @param {Object} companyInfo - { companyName, industry, companySummary }
 * @param {Array} selectedWorkflows - [{ name, reason }, ...]
 * @returns {Object} { success: boolean, goal: string, error?: string }
 */
function regenerateGoalForWorkflows(companyInfo, selectedWorkflows) {
  if (!companyInfo || !selectedWorkflows || selectedWorkflows.length === 0) {
    return { success: false, error: 'Company info and at least one workflow are required.' };
  }

  const responseLang = /[\u3000-\u9fff\uff00-\uffef]/.test(companyInfo.companySummary) ? '日本語' : 'English';

  const prompt = `You are a business analyst creating an AI agent demo scenario.

Given the company and selected workflows below, write a detailed business scenario (3-5 sentences) suitable as input for an AI agent demo generator.

## Company
- Name: ${companyInfo.companyName}
- Industry: ${companyInfo.industry}
- Overview: ${companyInfo.companySummary}

## Selected Workflows for AI Agent Automation
${selectedWorkflows.map(w => `- ${w.name}: ${w.reason}`).join('\n')}

## Instructions
- Reference the actual company name and industry
- Focus ONLY on the selected workflows above — do NOT introduce unrelated workflows
- Describe a specific, actionable business problem that an AI agent could solve
- Include realistic operational context (data sources, stakeholders, KPIs)
- Theme: "Autonomous Action and Core System Optimization" — the agent should detect events, analyze data, and actively update core systems
- Write entirely in ${responseLang}

Output ONLY the scenario text. No JSON, no code blocks, no explanations.`;

  try {
    let location = CONFIG.LOCATION || 'global';
    const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
    const model = 'gemini-3.1-flash-lite';
    const url = `https://${host}/v1/projects/${CONFIG.PROJECT_ID}/locations/${location}/publishers/google/models/${model}:generateContent`;

    const payload = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 1024 }
    };
    const response = UrlFetchApp.fetch(url, {
      method: 'POST',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      throw new Error('AI Error: ' + response.getContentText().substring(0, 200));
    }

    const text = JSON.parse(response.getContentText()).candidates[0].content.parts[0].text.trim();
    return { success: true, goal: text };
  } catch (e) {
    console.error('[REGEN-GOAL] Error:', e.message);
    return { success: false, error: e.message };
  }
}

// ===========================================
// Vertex AI & Utilities
// ===========================================

function callVertexAIWithRetry(prompt) { return executeWithRetry(() => callVertexAI(prompt)); }

function callVertexAI(prompt) {
  let location = CONFIG.LOCATION || 'global';
  const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
  const url = `https://${host}/v1/projects/${CONFIG.PROJECT_ID}/locations/${location}/publishers/google/models/${CONFIG.MODEL}:generateContent`;
  
  const payload = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 65535 } };
  const response = UrlFetchApp.fetch(url, { method: 'POST', contentType: 'application/json', headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() }, payload: JSON.stringify(payload), muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error(`AI Error: ${response.getContentText()}`);
  return JSON.parse(response.getContentText()).candidates[0].content.parts[0].text;
}

/**
 * Calls Vertex AI with Google Search grounding enabled.
 * Used for discovering real BigQuery public dataset IDs.
 */
function callVertexAIWithSearch(prompt) {
  let location = CONFIG.LOCATION || 'global';
  const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
  const searchModel = 'gemini-3.1-flash-lite';
  const url = `https://${host}/v1/projects/${CONFIG.PROJECT_ID}/locations/${location}/publishers/google/models/${searchModel}:generateContent`;
  
  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ googleSearch: {} }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 2048 }
  };
  const response = UrlFetchApp.fetch(url, {
    method: 'POST',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) throw new Error(`AI Search Error: ${response.getContentText()}`);
  return JSON.parse(response.getContentText()).candidates[0].content.parts[0].text;
}


/**
 * Calls Vertex AI gemini-3-pro-image-preview model in global region to generate an image.
 * Returns an object containing base64Data and mimeType.
 * @param {string} prompt Highly detailed image generation prompt in English.
 * @returns {object} { base64Data: string, mimeType: string }
 */
function generateImageBase64WithRetry(prompt) {
  return executeWithRetry(() => generateImageBase64(prompt));
}

function generateImageBase64(prompt) {
  const host = 'aiplatform.googleapis.com';
  const url = `https://${host}/v1/projects/${CONFIG.PROJECT_ID}/locations/global/publishers/google/models/gemini-3-pro-image:generateContent`;
  
  const payload = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt }
        ]
      }
    ],
    generationConfig: {
      responseModalities: ["IMAGE"]
    }
  };
  
  console.log('[ImageGen] Calling global gemini-3-pro-image. Prompt length: ' + prompt.length);
  
  const response = UrlFetchApp.fetch(url, {
    method: 'POST',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  
  if (response.getResponseCode() !== 200) {
    console.error(`[ImageGen Error] Code: ${response.getResponseCode()}, Body: ${response.getContentText()}`);
    throw new Error(`Image Gen Error: ${response.getContentText()}`);
  }
  
  const json = JSON.parse(response.getContentText());
  if (!json.candidates || json.candidates.length === 0 || !json.candidates[0].content.parts) {
    throw new Error("No candidates or parts returned from Image Gen API.");
  }
  
  let base64Data = null;
  let mimeType = 'image/jpeg';
  
  for (const part of json.candidates[0].content.parts) {
    if (part.inlineData) {
      base64Data = part.inlineData.data;
      mimeType = part.inlineData.mimeType || mimeType;
      break;
    }
  }
  
  if (!base64Data) {
    throw new Error("No inlineData found in the response parts.");
  }
  
  console.log('[ImageGen] SUCCESS! Got base64 data, length: ' + base64Data.length + ', mimeType: ' + mimeType);
  return { base64Data: base64Data, mimeType: mimeType };
}


function executeWithRetry(fn) {
  let lastError;
  for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
    try { return fn(); } catch (error) { lastError = error; Utilities.sleep(CONFIG.RETRY_DELAY_MS * attempt); }
  }
  throw lastError;
}






function updateSystemInstruction(setupScript, newBusinessInstruction, technicalInstruction) {
  const fullInstruction = `${newBusinessInstruction}\n\n${technicalInstruction}`;
  const escaped = fullInstruction.replace(/\\/g, '\\\\').replace(/'/g, "'\\''").replace(/\n/g, '\\n');
  return setupScript.replace(/(1\.\s+\*\*BigQuery toolset:\*\*.*?\n)([\s\S]*?)(\n\s+2\.\s+\*\*Maps Toolset:\*\*)/, `$1${escaped}$3`);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Generates a text-based PDF from content using DocumentApp.
 * @param {string} content - The content to written into the PDF.
 * @param {string} fileName - The name of the generated PDF file.
 * @returns {object} { success: boolean, base64: string, error?: string }
 */
function generatePdfFromServer(content, fileName) {
  try {
    const doc = DocumentApp.create('Temp PDF Generation');
    const body = doc.getBody();
    
    function applyBold(element, text) {
      if (!text) return;
      const parts = text.split('**');
      if (parts.length <= 1) return;
      
      let newText = '';
      const boldRanges = [];
      
      for (let i = 0; i < parts.length; i++) {
        if (i % 2 === 1) { // It's a bold part
          const start = newText.length;
          newText += parts[i];
          const end = newText.length - 1;
          boldRanges.push({start, end});
        } else {
          newText += parts[i];
        }
      }
      
      element.setText(newText);
      const textElement = element.editAsText();
      boldRanges.forEach(range => {
        textElement.setBold(range.start, range.end, true);
      });
    }
    
    const lines = content.split('\n');
    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) {
        body.appendParagraph('');
        return;
      }
      
      if (trimmed.startsWith('# ')) {
        const p = body.appendParagraph(trimmed.substring(2)).setHeading(DocumentApp.ParagraphHeading.HEADING1);
        applyBold(p, trimmed.substring(2));
      } else if (trimmed.startsWith('## ')) {
        const p = body.appendParagraph(trimmed.substring(3)).setHeading(DocumentApp.ParagraphHeading.HEADING2);
        applyBold(p, trimmed.substring(3));
      } else if (trimmed.startsWith('### ')) {
        const p = body.appendParagraph(trimmed.substring(4)).setHeading(DocumentApp.ParagraphHeading.HEADING3);
        applyBold(p, trimmed.substring(4));
      } else if (trimmed.startsWith('- ')) {
        const li = body.appendListItem(trimmed.substring(2));
        applyBold(li, trimmed.substring(2));
      } else if (trimmed.startsWith('[CHART:')) {
        const match = trimmed.match(/\[CHART:\s*(BAR|PIE|LINE)?,?\s*([^,\]]+),\s*([^\]]+)\]/i);
        if (match) {
          const type = (match[1] || 'BAR').toUpperCase();
          const title = match[2].trim();
          const dataStr = match[3].trim();
          const pairs = dataStr.split(',').map(p => p.trim());
          
          const dataTable = Charts.newDataTable();
          dataTable.addColumn(Charts.ColumnType.STRING, "Item");
          dataTable.addColumn(Charts.ColumnType.NUMBER, "Value");
          
          pairs.forEach(p => {
             const parts = p.split('=');
             if (parts.length === 2) {
               dataTable.addRow([parts[0].trim(), parseFloat(parts[1].trim()) || 0]);
             }
          });
          
          let builder;
          if (type === 'PIE') {
             builder = Charts.newPieChart();
          } else if (type === 'LINE') {
             builder = Charts.newLineChart();
          } else {
             builder = Charts.newBarChart();
          }
          
          const chart = builder
               .setDataTable(dataTable.build())
               .setTitle(title)
               .setDimensions(600, 300)
               .build();
          
          const imageBlob = chart.getAs('image/png');
          body.appendImage(imageBlob);
        } else {
           const p = body.appendParagraph(trimmed);
           applyBold(p, trimmed);
        }
      } else {
        const p = body.appendParagraph(trimmed);
        applyBold(p, trimmed);
      }
    });
    
    doc.saveAndClose();
    
    const pdfBlob = doc.getAs('application/pdf');
    pdfBlob.setName(fileName);
    
    const base64 = Utilities.base64Encode(pdfBlob.getBytes());
    
    DriveApp.getFileById(doc.getId()).setTrashed(true);
    
    return { success: true, base64: base64 };
  } catch (e) {
    console.error('PDF generation failed:', e.message);
    return { success: false, error: e.message };
  }
}

// =============================================================================
// MCP Server Importer Backend
// =============================================================================

function analyzeMcpRepository(repoUrl) {
  try {
    console.log("1. Starting GitHub repository retrieval: " + repoUrl);
    const repoData = parseGithubUrl(repoUrl);
    
    const defaultBranch = getDefaultBranch(repoData.owner, repoData.repo);
    
    const tree = getRepositoryFiles(repoData.owner, repoData.repo, defaultBranch);
    const filesToLoad = [];
    const priorityFiles = ["readme.md", "package.json", "pyproject.toml", "requirements.txt", ".env.example"];
    
    tree.forEach(item => {
      if (item.type === "blob") {
        const lowerPath = item.path.toLowerCase();
        const baseName = lowerPath.split('/').pop();
        if (priorityFiles.includes(baseName) || baseName === "readme" || baseName.endsWith("readme.md")) {
          filesToLoad.push(item.path);
        }
      }
    });

    const entrypointCandidates = ["main.py", "server.py", "app.py", "index.js", "index.ts", "index.py", "run.py"];
    
    // First pass: Look for obvious entrypoint files
    tree.forEach(item => {
      if (item.type === "blob") {
        const lowerPath = item.path.toLowerCase();
        const baseName = lowerPath.split('/').pop();
        if (entrypointCandidates.includes(baseName) && !lowerPath.includes("test") && !lowerPath.includes("node_modules")) {
          if (!filesToLoad.includes(item.path)) {
            filesToLoad.push(item.path);
          }
        }
      }
    });

    // Second pass: Fill up to 8 source files if needed
    let sourceLoaded = filesToLoad.filter(p => p.endsWith(".py") || p.endsWith(".js") || p.endsWith(".ts")).length;
    for (const item of tree) {
      if (item.type === "blob" && sourceLoaded < 8) {
        const path = item.path;
        if ((path.endsWith(".py") || path.endsWith(".ts") || path.endsWith(".js")) && 
            !path.includes("test") && !path.includes("node_modules") && !path.includes(".venv")) {
          if (!filesToLoad.includes(path)) {
            filesToLoad.push(path);
            sourceLoaded++;
          }
        }
      }
    }

    if (filesToLoad.length === 0) {
      filesToLoad.push("README.md", "package.json", "pyproject.toml", "requirements.txt", ".env.example");
      filesToLoad.push("main.py", "server.py", "app.py", "src/main.py", "src/server.py");
      let pkgName = repoData.repo.replace(/-/g, "_");
      filesToLoad.push(`${pkgName}/main.py`, `src/${pkgName}/main.py`, `src/${pkgName}/server.py`);
    }

    let combinedContent = "";
    for (const filename of filesToLoad) {
      const fileText = fetchFileFromGithub(repoData.owner, repoData.repo, defaultBranch, filename);
      if (fileText) {
        combinedContent += `\n\n--- FILE: ${filename} ---\n${fileText}`;
      }
    }

    if (!combinedContent) {
      throw new Error("Necessary configuration files were not found in the repository.");
    }

    console.log("2. Starting analysis by Gemini...");
    const analysisResult = callGeminiApi(combinedContent, repoUrl);
    
    const parsed = JSON.parse(analysisResult);
    if (!parsed.is_supported) {
       parsed.unsupported_reason += " [Context len: " + combinedContent.length + ", Head: " + combinedContent.substring(0, 200).replace(/\n/g, " ") + "]";
    }
    return {
      success: true,
      data: parsed
    };

  } catch (error) {
    console.error(error);
    return {
      success: false,
      message: error.toString()
    };
  }
}

function parseGithubUrl(url) {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) throw new Error("Invalid GitHub URL");
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}

function getGithubHeaders() {
  const headers = {};
  if (CONFIG.GITHUB_TOKEN) {
    headers['Authorization'] = `token ${CONFIG.GITHUB_TOKEN}`;
  }
  return headers;
}

function getRepositoryFiles(owner, repo, branch) {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  try {
    const response = UrlFetchApp.fetch(apiUrl, { 
      muteHttpExceptions: true,
      headers: getGithubHeaders()
    });
    if (response.getResponseCode() === 200) {
      const json = JSON.parse(response.getContentText());
      return json.tree || [];
    }
  } catch (e) {}
  return [];
}

function getDefaultBranch(owner, repo) {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;
  try {
    const response = UrlFetchApp.fetch(apiUrl, { 
      muteHttpExceptions: true,
      headers: getGithubHeaders()
    });
    if (response.getResponseCode() === 200) {
      const json = JSON.parse(response.getContentText());
      return json.default_branch || "main";
    }
  } catch (e) {}
  return "main";
}

function fetchFileFromGithub(owner, repo, defaultBranch, path) {
  const branches = [defaultBranch, "main", "master", "HEAD"];
  for (const branch of branches) {
    const apiUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
    try {
      const response = UrlFetchApp.fetch(apiUrl, { 
        muteHttpExceptions: true,
        headers: getGithubHeaders()
      });
      if (response.getResponseCode() === 200) {
        return response.getContentText();
      }
    } catch (e) {
      // Continue to next branch
    }
  }
  return null;
}

function callGeminiApi(contextContent, url) {
  const token = ScriptApp.getOAuthToken(); 
  const projectId = CONFIG.PROJECT_ID;
  const region = CONFIG.LOCATION || 'global';

  const host = region === 'global' ? 'aiplatform.googleapis.com' : `${region}-aiplatform.googleapis.com`;
  const endpoint = `https://${host}/v1/projects/${projectId}/locations/${region}/publishers/google/models/gemini-3.1-flash-lite:generateContent`;

  const prompt = `You are an AI expert determining if custom MCP Servers can be safely provisioned on standard Cloud Run.
Review the collected files enclosed in the <REPOSITORY_CONTEXT> tag below.

Based ONLY on those files, answer:
1. MUST be written in Python or Node.js/TypeScript.
2. MUST NOT require complex OAuth browser validations (unless refresh-token variable is valid).
3. Native binary dependencies rule:
   - If the server FUNDAMENTALLY requires heavy native binaries for ALL core functionality (e.g., FFmpeg, ImageMagick), set is_supported to false.
   - If the server has dependencies that download heavy native binaries during install (e.g., puppeteer, sharp, node-sass) but the core functionality works WITHOUT them (only some optional tools are affected), set is_supported to true, set npm_ignore_scripts to true, and list the affected tools in degraded_tools with a brief reason.

If valid:
- Set is_supported to true.
- Set 'language' based on the PRIMARY dependency/build file:
    - pyproject.toml, setup.py, or requirements.txt (as the main dependency source) → "python"
    - package.json with JS/TS source files → "nodejs"
    - If BOTH exist, determine by the server's main entrypoint file extension (.py → "python", .js/.ts → "nodejs").
    Must be exactly one of: "python" or "nodejs" (lowercase, no other values).
- Specify the correct 'entrypoint' — a shell command that starts the MCP server in STDIO mode when run from the repository root directory (/app/custom_mcp/).
  
  ENTRYPOINT RULES BY LANGUAGE:
  
  [Python with FastMCP library]:
  - FastMCP is identified by import statements: 'from mcp.server.fastmcp import FastMCP' or 'from fastmcp import FastMCP', and the server object is created with 'FastMCP(...)' (e.g., 'mcp = FastMCP("my-server")').
  - CRITICAL: If you see 'from mcp.server import Server' or 'Server(name=...)', this is a PLAIN mcp.Server, NOT FastMCP. You MUST use the [Python without FastMCP] rules below instead.
  - You MUST NOT use the CLI entrypoint (e.g. 'redmine-mcp-server').
  - Output ONLY the Python module path and object name in the format '<module_path>:<mcp_object>' (e.g., 'redmine_mcp_server.redmine_handler:mcp').
  - Our system will automatically wrap this as: python -c "from <module_path> import <mcp_object>; <mcp_object>.run(transport='stdio')"
  - Analyze the Python code to find the FastMCP object. If you cannot find the exact instantiation but see it imported (e.g., 'from .redmine_handler import mcp'), DEDUCE the module path from the package name in pyproject.toml and the import statement.
  - NEVER output the CLI command if it is a FastMCP project.
  
  [Python without FastMCP (plain mcp.Server)]:
  - This applies when the server uses 'from mcp.server import Server' or similar non-FastMCP patterns.
  - Output the standard python command (e.g., 'python -m my_server' or 'python src/main.py').
  - NEVER output the '<module_path>:<object>' format for plain mcp.Server projects.
  
  [Node.js / TypeScript]:
  - Check package.json for: 1) "bin" field → the binary name, 2) "main" field → the entry file, 3) "scripts.start" → how to run.
  - If a "bin" field exists (e.g., {"mcp-server-redmine": "dist/index.js"}), output: 'node dist/index.js'
  - If no "bin" but dist/build directory has index.js, output: 'node dist/index.js' or 'node build/index.js'
  - The command must be a direct 'node <file>' command, NOT 'npx' or 'npm start' (these may not work in the container).
  - The TypeScript source MUST be compiled first (npm run build). Our system handles the build step separately.

- Set transport_mode to "stdio" (our system handles protocol bridging automatically).
- List ONLY the ESSENTIAL environment variables needed for a basic, functional deployment in required_env_vars. Ignore advanced configurations, fine-tuning parameters (e.g., cleanup intervals, SSL paths, port binds), and alternative authentication methods if a primary/recommended one (like an API Key) is available. Focus on getting the server running at a basic level. For each variable, determine if it is REQUIRED or OPTIONAL for that basic function.
- Predict the key capabilities or tools provided by this server based on the code and README (e.g., 'Create Redmine tickets', 'Search issues').
- credential_file: Set ONLY when file-based authentication is the SOLE or PRIMARY method to make the server functional. Examples where credential_file SHOULD be set:
  - Google service account JSON via GOOGLE_APPLICATION_CREDENTIALS (the only way to authenticate)
  - SSH private key file required for Git operations (no alternative)
  Examples where credential_file should be null:
  - Client certificate (PFX/P12) that is an OPTIONAL alternative to username/password auth
  - TLS/SSL certificates used only in specific network configurations
  - Any file-based auth that is conditional (e.g., only used when a specific env var is set, guarded by "if" checks in code)
  Rule: If the server can authenticate and function normally with ONLY environment variable values (API keys, tokens, username/password), set credential_file to null — even if the code also supports optional file-based auth.
  When credential_file is set, provide:
  - env_var_name: The environment variable that points to the file path (e.g., "GOOGLE_APPLICATION_CREDENTIALS")
  - file_description: A concise explanation of what the file contains and step-by-step instructions for obtaining it

If invalid or files are definitely missing context to specify an entrypoint, set is_supported to false and state why under unsupported_reason.

<REPOSITORY_CONTEXT>
${contextContent}
</REPOSITORY_CONTEXT>
`;

  const requestBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          is_supported: { type: "BOOLEAN" },
          unsupported_reason: { type: "STRING" },
          language: { type: "STRING", enum: ["python", "nodejs"] },
          entrypoint: { type: "STRING" },
          transport_mode: { type: "STRING" },
          required_env_vars: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                key: { type: "STRING" },
                description: { type: "STRING" },
                is_secret: { type: "BOOLEAN" },
                is_required: { type: "BOOLEAN" }
              },
              required: ["key", "description", "is_secret", "is_required"]
            }
          },
          capabilities: {
            type: "ARRAY",
            items: { type: "STRING" }
          },
          npm_ignore_scripts: { type: "BOOLEAN" },
          degraded_tools: {
            type: "ARRAY",
            items: { type: "STRING" }
          },
          credential_file: {
            type: "OBJECT",
            nullable: true,
            properties: {
              env_var_name: { type: "STRING" },
              file_description: { type: "STRING" }
            },
            required: ["env_var_name", "file_description"]
          }
        },
        required: ["is_supported", "unsupported_reason", "language", "entrypoint", "transport_mode", "required_env_vars", "capabilities", "npm_ignore_scripts", "degraded_tools"]
      }
    }
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + token },
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: false
  };

  const response = UrlFetchApp.fetch(endpoint, options);
  const resJson = JSON.parse(response.getContentText());
  
  return resJson.candidates[0].content.parts[0].text;
}

/**
 * Service endpoint for Magic Wand. Expands and refines scenario statement using gemini-3.1-flash-lite.
 * Robustly handles raw inputs, templates, and edited Markdown scenarios from domain research.
 * Features 3-retry loop with exponential backoff to handle transient rate limits (429) and server errors (5xx).
 * @param {string} rawGoal - The user's current scenario text.
 * @returns {Object} Optimized result containing the structured Markdown.
 */
function optimizeGoalWithMagicWand(rawGoal) {
  let location = CONFIG.LOCATION || 'global';
  const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
  const model = 'gemini-3.1-flash-lite';
  const url = `https://${host}/v1/projects/${CONFIG.PROJECT_ID}/locations/${location}/publishers/google/models/${model}:generateContent`;

  const prompt = `You are an expert prompt engineer and business analyst. 
Your task is to take a raw, simple, or loosely defined business scenario, OR a partially structured business scenario (which might contain company details and selected target workflows from prior research), and optimize/expand it into a **perfectly structured, high-density professional Business Scenario prompt** in Markdown format.

Input to Optimize:
\"\"\"
${rawGoal}
\"\"\"

**CRITICAL MULTILINGUAL RULE (MANDATORY)**: 
1. **Language Detection**: Analyze the \"Input to Optimize\" above and detect its primary language (e.g., English, Japanese, German, French, Spanish, Chinese, Korean, etc.).
2. **Output Language Consistency**: You MUST generate the entire optimized Markdown output in the EXACT SAME language and script as the input. Even if the companies, brands, or locations mentioned in the input are culturally or geographically associated with a specific country or language, you MUST NOT output in that associated language unless the actual input text itself is written using that language's script. Always strictly match the literal language and script of the input text.
3. **Header Translation**: You MUST translate the four standard section headers (Title, Target Role, Business Scenario, Operational Challenge) to match the detected language naturally and professionally. Do NOT leave headers in English if the input is in another language, and do NOT translate them to Japanese/English if the input is in a third language.
4. **Examples Localization**: Locally adapt all names, currency units, and business terminology in the instructions to match the detected language's cultural context (e.g., use JPY/Japanese names for Japanese, EUR/European names for German/French, USD/English names for English).

Requirements for the Structured Output:
1.  **Structure Integrity**: Ensure the output contains exactly the four translated Markdown headers defined above.
    - **Header 1 (Title)**: If the input already has a company name and industry (e.g., '# SMCC (Finance)'), KEEP and preserve it. If not, create a realistic company name and vertical appropriate to the language context.
    - **Header 2 (Role)**: Identify a specific, professional job title appropriate to the role.
    - **Header 3 (Scenario)**: Provide a rich, realistic business context. If the input already has a scenario, expand it with realistic domain details, KPIs, and background.
    - **Header 4 (Challenge)**: Describe a clear, high-value operational challenge for an autonomous AI agent. It MUST specify:
        - A clear trigger event.
        - Explicit business rules and numeric thresholds appropriate to the domain (e.g., CPA limit, price discrepancy threshold).
        - Clear conditional paths (what is auto-process vs. what requires human approval).
        - Data systems involved (BigQuery/external files, Firestore operational database, Google Sheets).
        - **High-fidelity Assets & Multi-modal Integration**: Intelligently design the challenge to utilize the platform's asset generation capabilities:
            1. **Visual/HITL Triggers**: If the workflow involves any paper forms, manual applications, receipts, shipping box damages, visual inspection anomalies, or legacy physical processes, explicitly mandate a **JPEG image asset** (e.g. handwritten fax order, scanned invoice, damaged package photograph) as the primary trigger, requiring the agent to use multimodal vision before routing to Firestore for Human-in-the-Loop (HITL) manager approval.
            2. **Structured Ledgers**: Integrate transactional logs, excel data dumps, or raw CSV exports as **Excel/CSV/TSV files** that the agent must parse (using TSV/CSV delimiter logic) and reconcile against the DB.
            3. **Executive Reports & Interactive Cards**: Design the workflow to output professional, structured reports (saved to the operational database/Firestore) and rich interactive UI cards (using A2UI) as the final outcome or human review package.
        *NOTE*: If the input already lists target workflows or specific steps, respect them and build the operational challenge specifically around those workflows.
2.  **Operational/Database Focus**: ALWAYS frame the scenario as a database-driven workflow where the agent reads from analytical sources (BigQuery/external files) and **writes back status updates, high-risk alerts, or proposed changes to the operational database (Firestore)** to keep the real-time console updated.
3.  **No Fictional Placeholders**: Use realistic brand names, locations, and values appropriate to the language context. Do NOT use generic placeholders like \"Product A\", \"Company XYZ\", etc.

Return ONLY the raw Markdown text in the detected language. Do not include any code block wrappers (triple backticks), code fences, or preamble.`;

  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 8192 }
  };

  const fetchOptions = {
    method: 'POST',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  let response;
  let lastError;
  const maxRetries = 3;
  let delayMs = 1000;

  for (let i = 0; i < maxRetries; i++) {
    try {
      response = UrlFetchApp.fetch(url, fetchOptions);
      const code = response.getResponseCode();
      if (code === 200) {
        const result = JSON.parse(response.getContentText()).candidates[0].content.parts[0].text;
        return { success: true, optimizedGoal: result.trim() };
      }
      
      lastError = new Error(`AI Optimization API Error (HTTP ${code}): ${response.getContentText()}`);
      
      // Only retry on transient errors (429 Rate Limit, 5xx Server Errors)
      if (code !== 429 && code < 500) {
        break; // Fatal error (400, 403, etc.), don't retry
      }
    } catch (e) {
      lastError = e;
    }
    
    if (i < maxRetries - 1) {
      Utilities.sleep(delayMs);
      delayMs *= 2; // Exponential backoff
    }
  }

  return { success: false, error: lastError ? lastError.message : "AI Optimization failed after retries" };
}

