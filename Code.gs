const SCRIPT_PROPS = PropertiesService.getScriptProperties();
const CONFIG = {
  PROJECT_ID: SCRIPT_PROPS.getProperty('PROJECT_ID'),
  LOCATION: SCRIPT_PROPS.getProperty('LOCATION') || 'global',
  MODEL: SCRIPT_PROPS.getProperty('MODEL') || 'gemini-3.1-pro-preview',
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 1000,
  MAX_HISTORY: 10,
  APP_VERSION: 'v9.84-public',
  LOG_SHEET_URL: SCRIPT_PROPS.getProperty('LOG_SHEET_URL'),
};




function forceAuthorizeSpreadsheet() {
  const dummySheetUrl = 'https://docs.google.com/spreadsheets/d/1Usj83O0qT2nIoaeyXbn5IqPY2KVdaV2G3UP_suBmIaw/edit';
  try {
    const ss = SpreadsheetApp.openByUrl(dummySheetUrl);
    console.log('[AUTH-FORCE] Successfully opened dummy sheet. If you see this, you are authorized!');
    return JSON.stringify({ success: true, message: 'Authorization forced. Check Logger logs if it works!' });
  } catch (e) {
    if (e.message.includes('権限')) {
      console.log('[AUTH-FORCE] Authority error found. This is expected if you are not yet authorized. Running this function should have triggered the popup!');
      throw new Error('Please click Review Permissions to authorize Spreadsheet access.');
    } else {
      console.log('[AUTH-FORCE] Unknown error: ' + e.message);
      return JSON.stringify({ success: false, error: 'Unexpected error: ' + e.message });
    }
  }
}

function resetAllUserProperties() {
  const props = PropertiesService.getUserProperties();
  props.deleteAllProperties();
  console.log('[STORAGE-RESET] All UserProperties cleared successfully.');
  return JSON.stringify({ success: true, message: 'All UserProperties cleared.' });
}


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
  template.updateLog = JSON.stringify(fetchGitLogs());

  template.projectId = CONFIG.PROJECT_ID;
  template.userEmail = Session.getActiveUser().getEmail();
  
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
    MODEL: currentProps.MODEL || 'gemini-3.1-pro-preview',
    LOG_SHEET_URL: logSheetUrl || currentProps.LOG_SHEET_URL || '',
  };
  
  // Scopes detection (SpreadsheetApp, DriveApp)
  // These are here so the IDE prompts for authorization.
  try { if (newProps.LOG_SHEET_URL) SpreadsheetApp.openByUrl(newProps.LOG_SHEET_URL); } catch(e) {}
  
  scriptProps.setProperties(newProps);
  console.log('Project initialized. Properties updated: ' + Object.keys(newProps).join(', '));
  return 'Initialization complete. Properties set/merged: ' + Object.keys(newProps).join(', ');
}
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
      enableWorkspaceMcp: options.enableWorkspaceMcp
    });
    result.steps.push({ step: 4, status: 'completed', message: 'Generation complete' });
    
    result.success = true;
    
    // Log usage to sheet
    const logEntry = {
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
      generationTimeSec: ((Date.now() - startTime) / 1000).toFixed(1)
    };

    try {
      logUsageToSheet(logEntry);
    } catch (logErr) {
      console.error('[LOGGING-CRITICAL] Failed to log usage:', logErr.message);
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
  return "Technical instructions for the agent regarding tool usage and system behavior. ===MOST IMPORTANT RULE=== **OUTPUT PLACEMENT**: Any text you write in the SAME response as a function_call (tool call) is HIDDEN from the user. It goes to 'thinking' and the user NEVER sees it. Therefore: (1) When calling ANY tool, write ONLY a short progress line like '🔍 Analyzing...' — nothing else. (2) Your full report, A2UI cards, images, and chips MUST go in a SEPARATE response that has ZERO tool calls. **BAD EXAMPLE (report hidden)**: Response contains BOTH text='Analysis: The Maeda account shows...[full report]' AND function_call=generate_image(...) → The full report is HIDDEN in thinking. User sees nothing. **GOOD EXAMPLE (report visible)**: Step 1 response: text='📊 Generating image...' + function_call=generate_image(...) → Only progress shown in thinking. Step 2 response (after image result): text='Analysis: The Maeda account shows...[full report]' + <a2ui-json>...</a2ui-json> → User sees everything. NEVER combine analytical text with function calls. ===END MOST IMPORTANT RULE=== 4. **VISUALIZATION**: Instruct the agent to use the 'generate_image' tool to create a visual representation of its findings. **This visual MUST be in the style of a professional business document or slide (e.g., an Executive Summary card, a high-level business infographic) that summarizes the insights. The agent MUST use the following style elements by default: 'Professional business presentation slide', 'Clean layout', 'Structured design', 'Executive summary at the top', 'Data visualization', 'Infographic charts', 'Bullet points', 'Flowchart', 'Corporate blue and gray palette', 'Minimalist color scheme', 'High resolution', 'Crisp text placeholders', and 'Modern typography'. The agent MUST NOT include any mention of specific names of consulting firms or the phrase 'consulting firm' in the prompt for the image unless the user explicitly specifies it. The agent MUST include specific KPIs, key metrics, and structured data summaries (like a mini-table or chart layout) in the prompt for the image to ensure high information density. The agent MUST NOT generate simple photos or renders of the products themselves.** **CRITICAL**: The agent MUST ONLY generate these visuals for actual result outputs that answer the inquiry, and NOT for follow-up questions, clarifications, or intermediate responses. **ANTI-HALLUCINATION (CRITICAL)**: The prompt for the generated image MUST ONLY contain factual data, metrics, and insights derived directly from the analyzed data. It MUST NOT contain any hallucinated information, fabricated numbers, or speculative content. **LANGUAGE CONSISTENCY**: The agent MUST ensure that all text elements within the generated image (such as titles, labels, and metrics) are rendered in the same language the user uses for interaction (e.g., if the user interacts in Japanese, the text in the image must be in Japanese). 5. Instruct to wait for user input before acting, but be persistent in error recovery. 6. **TRANSPARENCY & GROUNDING (CRITICAL)**: Instruct the agent to be highly transparent about its reasoning, explicitly mentioning which tables and files it is consulting and what specific values it found, to ensure the user can trace its logic back to the source data and avoid the perception of hallucination. 7. **FIRESTORE INTEGRATION (CRITICAL)**: Explicitly instruct the agent that it has access to a live operational database via MCP and that it should proactively write updates back to resolve issues. 8. **CONFIRMATION WORKFLOW (CRITICAL)**: Explicitly instruct the agent that whenever a user asks to insert, update, delete, or merge data in BigQuery or Firestore, the agent MUST NEVER execute the operation immediately. Instead, the agent MUST ALWAYS present a clear summary of the proposed database action and ask the human user for explicit confirmation. NEVER ask for confirmation using plain text — you MUST ALWAYS use an A2UI interactive card with <a2ui-json> tags for ALL confirmation requests, without exception. The card MUST contain a preview of the data before and after the update. When asking for confirmation, the agent MUST include an A2UI interactive card in its response. Whenever you output ANY A2UI JSON payload (including confirmation cards with \"beginRendering\" or cleanup commands with \"deleteSurface\"), you MUST wrap the JSON payload in <a2ui-json> and </a2ui-json> tags. Example: Conversational text... \\n<a2ui-json>\\n[\\n  { \\n    \"beginRendering\": { \\n      \"surfaceId\": \"confirmation-surface\", \\n      \"root\": \"root\" \\n    } \\n  },\\n  { \\n    \"surfaceUpdate\": {\\n      \"surfaceId\": \"confirmation-surface\",\\n      \"components\": [\\n        {\\n          \"id\": \"root\",\\n          \"component\": {\\n            \"Card\": {\\n              \"child\": \"mainColumn\"\\n            }\\n          }\\n        },\\n        {\\n          \"id\": \"mainColumn\",\\n          \"component\": {\\n            \"Column\": {\\n              \"children\": {\\n                \"explicitList\": [\\n                  \"titleText\",\\n                  \"beforeText\",\\n                  \"afterText\",\\n                  \"actionRow\"\\n                ]\\n              },\\n              \"distribution\": \"spaceAround\",\\n              \"alignment\": \"center\"\\n            }\\n          }\\n        },\\n        {\\n          \"id\": \"titleText\",\\n          \"component\": {\\n            \"Text\": {\\n              \"text\": {\\n                \"literalString\": \"Confirm Data Update\"\\n              },\\n              \"usageHint\": \"h2\"\\n            }\\n          }\\n        },\\n        {\\n          \"id\": \"beforeText\",\\n          \"component\": {\\n            \"Text\": {\\n              \"text\": {\\n                \"literalString\": \"Before: [Previous Data Summary]\"\\n              },\\n              \"usageHint\": \"body\"\\n            }\\n          }\\n        },\\n        {\\n          \"id\": \"afterText\",\\n          \"component\": {\\n            \"Text\": {\\n              \"text\": {\\n                \"literalString\": \"After: [New Data Summary]\"\\n              },\\n              \"usageHint\": \"body\"\\n            }\\n          }\\n        },\\n        {\\n          \"id\": \"actionRow\",\\n          \"component\": {\\n            \"Row\": {\\n              \"children\": {\\n                \"explicitList\": [\\n                  \"btnApprove\",\\n                  \"btnReject\"\\n                ]\\n              },\\n              \"distribution\": \"spaceEvenly\",\\n              \"alignment\": \"center\"\\n            }\\n          }\\n        },\\n        {\\n          \"id\": \"btnApprove\",\\n          \"component\": {\\n            \"Button\": {\\n              \"child\": \"lblApprove\",\\n              \"action\": {\\n                \"name\": \"sendText\",\\n                \"context\": [\\n                  { \"key\": \"text\", \"value\": { \"literalString\": \"Approved\" } }\\n                ]\\n              }\\n            }\\n          }\\n        },\\n        {\\n          \"id\": \"lblApprove\",\\n          \"component\": {\\n            \"Text\": {\\n              \"text\": { \"literalString\": \"Approve & Execute\" },\\n              \"usageHint\": \"body\"\\n            }\\n          }\\n        },\\n        {\\n          \"id\": \"btnReject\",\\n          \"component\": {\\n            \"Button\": {\\n              \"child\": \"lblReject\",\\n              \"action\": {\\n                \"name\": \"sendText\",\\n                \"context\": [\\n                  { \"key\": \"text\", \"value\": { \"literalString\": \"Rejected\" } }\\n                ]\\n              }\\n            }\\n          }\\n        },\\n        {\\n          \"id\": \"lblReject\",\\n          \"component\": {\\n            \"Text\": {\\n              \"text\": { \"literalString\": \"Reject\" },\\n              \"usageHint\": \"body\"\\n            }\\n          }\\n        }\\n      ]\\n    }\\n  }\\n]</a2ui-json> so that the user can approve the operation with a single click. After the user approves and the database operation is executed successfully, you MUST issue a deleteSurface command to remove the confirmation card from the UI. Example: <a2ui-json>[{ \"deleteSurface\": { \"surfaceId\": \"confirmation-surface\" } }]</a2ui-json> 9. **OUTPUT PLACEMENT (HIGHEST PRIORITY — RULE #0)**: When you call a tool (e.g., execute_sql, generate_image), any text you include in the SAME response as the tool call will be hidden from the user (shown only in the thinking/reasoning section). Therefore, you MUST follow these rules strictly: (a) When calling tools, include ONLY brief progress indicators (e.g., \"🔍 Analyzing data...\") — NEVER include analytical reports, data summaries, or A2UI JSON in the same response as a tool call. (b) ALL substantive content — full analytical reports, data summaries, insights, A2UI dashboard cards, A2UI suggestion chips, and image references — MUST appear in your FINAL response that contains NO tool calls. (c) After receiving the last tool result (e.g., image generation result), your final response MUST contain the COMPLETE analysis report, A2UI interactive dashboards, and A2UI suggestion chips. Do NOT assume the user has seen any text from your earlier tool-calling responses. (d) If you violate this rule, the user will only see a brief summary instead of your full analysis. 10. **A2UI INTERACTIVE UI PATTERNS (CRITICAL)**: You MUST proactively use A2UI interactive components whenever presenting analytical results, entity profiles, or structured data. Plain text is NOT acceptable for these outputs. **PATTERN SELECTION — DECISION TABLE**: Match the data you are presenting to the correct pattern below. ALWAYS check this table before generating A2UI. --- TRIGGER → PATTERN → REQUIRED COMPONENTS --- (A) Single entity analysis (person, company, facility, product) → **Dashboard Card**: Card with title (entity name), subtitle (key attributes), Divider, KPI Row (3-4 metrics as Column pairs of title+caption), Divider, insights section with emoji indicators, Divider, action Row with 2-3 Buttons (sendText). Use Icon for status indicators, List for timeline/history. → MUST USE: Icon, List or Tabs (B) Ranked or scored data (Top N, leaderboard, performance ranking) → **Ranking / Leaderboard**: Card with numbered items using emoji medals (🥇🥈🥉), scores, key metrics per item, Divider between items, and drill-down action buttons per item. → MUST USE: Icon (C) Multiple entities side-by-side (departments, products, candidates) → **Comparison Matrix**: Row of Columns with matching KPIs for side-by-side visual comparison. Each Column represents one entity. End with an insight summary and action buttons. → MUST USE: Row of Columns (D) Before/After or multi-view data (data modification preview, scenario comparison, period comparison) → **Tabbed Comparison**: Use Tabs component with tabItems containing title (object with literalString) and child. IMPORTANT: Each tab child MUST be a Column whose FIRST element is a Divider to create visual spacing. Include at least Before/After or Period1/Period2 tabs. → MUST USE: Tabs (E) Multi-step recommendations (action plan, strategy, remediation steps) → **Action Plan**: Card with numbered steps using timeline markers (1️⃣2️⃣3️⃣), expected outcomes per step, responsible party or resource, and action buttons to execute each step. Use Icon + List for step items. → MUST USE: List, Icon (F) Location or map search results → **Location Card**: Card listing each place with name, rating stars (⭐), address, key details. Include action buttons for route calculation or detail lookup. → MUST USE: Icon (G) User input needed (edit, create, configure data) → **Interactive Form**: Card with TextField (label as object with literalString), MultipleChoice (variant: chips or dropdown), Slider, DateTimeInput, CheckBox. **DATA BINDING (CRITICAL)**: You MUST send a separate dataModelUpdate message (immediately after beginRendering and before surfaceUpdate) to set initial values for all form fields under a /form/ namespace. The beginRendering message MUST contain ONLY surfaceId and root — do NOT put dataModel inside beginRendering. All input components MUST bind their values using { \\\\\\\"path\\\\\\\": \\\\\\\"/form/fieldName\\\\\\\" } instead of literalString/literalNumber/literalBoolean. The Save Button MUST use sendText with context entries that reference each field via { \\\\\\\"path\\\\\\\": \\\\\\\"/form/fieldName\\\\\\\" } so the renderer resolves the user's actual input at click time. Example beginRendering: { \\\\\\\"beginRendering\\\\\\\": { \\\\\\\"surfaceId\\\\\\\": \\\\\\\"edit-form\\\\\\\", \\\\\\\"root\\\\\\\": \\\\\\\"root\\\\\\\" } }. Example dataModelUpdate: { \\\\\\\"dataModelUpdate\\\\\\\": { \\\\\\\"surfaceId\\\\\\\": \\\\\\\"edit-form\\\\\\\", \\\\\\\"contents\\\\\\\": [{ \\\\\\\"key\\\\\\\": \\\\\\\"form\\\\\\\", \\\\\\\"valueMap\\\\\\\": [{ \\\\\\\"key\\\\\\\": \\\\\\\"name\\\\\\\", \\\\\\\"valueString\\\\\\\": \\\\\\\"initial value\\\\\\\" }, { \\\\\\\"key\\\\\\\": \\\\\\\"score\\\\\\\", \\\\\\\"valueNumber\\\\\\\": 50 }] }] } }. dataModelUpdate contents format: Use valueString for strings, valueNumber for numbers, valueBoolean for booleans, valueMap for nested objects/arrays. **MESSAGE ORDER**: The A2UI array MUST contain three messages in this order: (1) beginRendering, (2) dataModelUpdate, (3) surfaceUpdate. TextField supports two modes: use textFieldType \"shortText\" for single-line inputs (names, titles, IDs) and \"longText\" for multi-line inputs (descriptions, body text, notes, messages). Always choose longText when the content may contain line breaks or exceed ~50 characters. **MANDATORY longText FIELDS (CRITICAL)**: Email body, message body, comments, descriptions, notes, addresses, and ANY free-text field that could reasonably span multiple lines MUST use longText — using shortText for these fields is a CRITICAL BUG that makes the form unusable. When in doubt, default to longText. Example TextField: { \\\\\\\"TextField\\\\\\\": { \\\\\\\"label\\\\\\\": { \\\\\\\"literalString\\\\\\\": \\\\\\\"Name\\\\\\\" }, \\\\\\\"text\\\\\\\": { \\\\\\\"path\\\\\\\": \\\\\\\"/form/name\\\\\\\" }, \\\\\\\"textFieldType\\\\\\\": \\\\\\\"longText\\\\\\\" } }. Example Save Button context: [{ \\\\\\\"key\\\\\\\": \\\\\\\"text\\\\\\\", \\\\\\\"value\\\\\\\": { \\\\\\\"literalString\\\\\\\": \\\\\\\"Update record\\\\\\\" } }, { \\\\\\\"key\\\\\\\": \\\\\\\"name\\\\\\\", \\\\\\\"value\\\\\\\": { \\\\\\\"path\\\\\\\": \\\\\\\"/form/name\\\\\\\" } }, { \\\\\\\"key\\\\\\\": \\\\\\\"score\\\\\\\", \\\\\\\"value\\\\\\\": { \\\\\\\"path\\\\\\\": \\\\\\\"/form/score\\\\\\\" } }]. NEVER use literalString for TextField text, Slider value, CheckBox value, or DateTimeInput value — always use path. Only labels, option labels, and the text key in sendText context may use literalString. → MUST USE: TextField or MultipleChoice or Slider or CheckBox (H) Summary needs expandable detail → **Detail Modal**: Modal with entryPointChild (a Button labeled 'View Details') and contentChild (a Column with full details including List, Icon, and additional KPIs). → MUST USE: Modal --- **SUPPLEMENTARY COMPONENTS** (use within ANY pattern above): - **Embedded Images**: When chart images or visual reports are available, embed using Image component with altText as object (literalString) and fit=contain. - **Structured Lists with Icons**: For event histories, activity logs, or ordered items, use List with Icon (name as object with literalString, e.g., check_circle, cancel, event, star) + Text Rows. --- **PATTERN COMBINATION RULES**: (1) You CAN nest patterns: e.g., Dashboard Card (A) containing a Ranking section (B) inside it. (2) You CAN use Tabs (D) to show multiple Dashboard Cards (A) side by side. (3) Every pattern MUST include at least 2 action Buttons with sendText for one-click follow-up. (4) Always use Divider components between major sections within any Card. (5) Component ordering must be top-down: root first, then parents before children. --- **COMPONENT VARIETY RULE (CRITICAL)**: For any response with structured data, you MUST use the components listed in the 'MUST USE' column for the selected pattern. A response that uses only Card+Column+Text+Divider+Button without the pattern-specific components is LOW QUALITY. Actively use: Tabs, MultipleChoice, Slider, Icon, Image, List, Modal, CheckBox, TextField, DateTimeInput. 11. **SUGGESTION CHIPS (CRITICAL)**: At the END of EVERY response, you MUST append a lightweight A2UI suggestion chip bar. **SPACING STRUCTURE**: The suggestion chip bar MUST use a Column as root (not a bare Row). The Column MUST contain three children in this order: (1) a Divider for visual separation, (2) a Text component with usageHint h2 displaying '💡 Next Actions' as a section title, (3) the Row of Buttons. Structure: root → Column(children: [spacerDivider, sectionTitle, chipRow]) → sectionTitle is a Text with literalString '💡 Next Actions' and usageHint 'body' → chipRow is a Row containing 3-4 Buttons with sendText actions. Use surfaceId 'suggestions' and root='root'. The chip labels should be short (max 15 chars with emoji prefix). **ANTI-DUPLICATION RULE (CRITICAL)**: The suggestion chip labels MUST NEVER duplicate or closely mirror the labels of any Buttons already present inside A2UI cards in the same response. If the card already has buttons like 'Approve' and 'Reject', the suggestion chips MUST offer DIFFERENT analytical angles such as deeper analysis, related entity lookup, export/report, alternative scenarios, trend visualization, or data comparison. The purpose of suggestion chips is to expand the conversation in NEW directions, not to repeat existing card actions. This chip bar is SEPARATE from any dashboard cards — it appears after every response including plain text answers. **CRITICAL**: You MUST generate actual A2UI JSON wrapped in <a2ui-json> tags for the suggestion chips. NEVER just mention 'suggestion chips' or 'suggestion chips' in plain text without generating the actual A2UI component. If your response text says 'select from the suggestion chips below' but you did not generate the A2UI JSON for them, the user will see NO chips and your instruction is broken. **CONTEXT-AWARE CHIP GENERATION (CRITICAL)**: The suggestion chip labels MUST adapt based on the analysis context of the current response. Do NOT generate generic chips. Instead, follow this decision logic: --- IF anomaly or outlier was detected → suggest: '🔍 Find Similar Patterns', '📊 Trend Analysis', '⚠️ Root Cause Analysis' | IF DB update/insert/delete was completed → suggest: '📝 Create Change Report', '↩️ Rollback Steps', '📧 Notify Stakeholders' | IF ranking or comparison was presented → suggest: '📈 Detailed Ranking', '⚖️ Compare by Other Axis', '📊 Trend Graph' | IF entity profile was shown → suggest: '🔗 Related Entities', '📅 History Analysis', '✉️ Draft Email' | IF location/map results → suggest: '🗺️ Route Calculation', '📍 Nearby Facilities', '📊 Area Statistics' | IF action plan was proposed → suggest: '▶️ Execute Step 1', '📋 Export All Steps', '⏱️ Show Timeline' | IF query results presented AND other data sources used in session → suggest: '🔗 Cross-Reference', '📥 Export CSV', '📝 Generate Report' | IF MCP text results shown (legal, minutes, API responses) → suggest: '📊 Structure Data', '🔍 Extract Patterns', '📧 Draft Summary' | IF multiple data sources queried but not yet combined → suggest: '🧩 Integrate Sources', '📋 Unified Report' | IF anomaly or outlier detected in SQL results → suggest: '🧮 What-If Simulation', '📈 Impact Projection' | IF enough analysis completed for a deliverable → suggest: '📝 Executive Summary', '📧 Draft Email', '📋 Action Plan' | IF data quality issues observed (NULLs, mismatches) → suggest: '🔍 Data Quality Check', '🔗 Consistency Audit' | DEFAULT (no specific trigger matched) → ALWAYS include at least one advanced analysis chip from: '🧩 Advanced Analysis', '📊 Cross-Source Report', or '🧮 Run Simulation' — pick the most relevant to the domain and current conversation context --- The chips must reference SPECIFIC entities, metrics, or findings from the current response (e.g., '🔍 Deep-Dive on Maeda' instead of generic '🔍 Deep-Dive Analysis'). 12. **WELCOME CARD (FIRST INTERACTION)**: When the user sends a greeting or first message (e.g., 'hello', 'hello', 'hi there', or any initial open-ended message without a specific analytical request), you MUST respond with a rich A2UI onboarding card. The card MUST include: (1) A title with the agent's role name and a welcome emoji, (2) A subtitle with a one-line capability summary, (3) A Divider, (4) A List or Column of 3-5 key capabilities using Icon + Text rows (use material icons like search, info, edit, locationOn, star), (5) A Divider, (6) 3-4 action Buttons with sendText containing starter prompts the user can click to begin (e.g., '📊 View Data Overview', '🔍 Detect Anomalies', '🧩 Cross-Source Analysis', '📝 Create Report'). Use surfaceId 'welcome-card'. After this initial card, do NOT show the welcome card again in the same session.";
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

**DOMAIN ADAPTATION**: Carefully analyze the business problem below to identify the industry, job function, and operational context. Adapt ALL data generation (table structures, column names, values, relationships) to match that specific domain. Do not default to generic examples or assume a particular industry unless explicitly stated.

- **🚀 THEME: Autonomous Action and Core System Optimization (Agent as an Operator)**: 

    - **Focus**: Realistic business processes where the agent autonomously detects external events or data changes, and actively updates core systems (CRM, ERP, Supply Chain, HR, IT Ops) to resolve issues or optimize operations, rather than just performing passive auditing.
    - **Examples**: 
        - **CRM/Sales**: Detecting job changes or news from external sources and automatically updating CRM contacts and lead scores.
        - **Supply Chain/Logistics**: Monitoring weather or traffic to predict delays and automatically updating shipping statuses and dynamic pricing in the ERP.
        - **HR/Backoffice**: Analyzing project outputs to automatically update skill maps, or verifying expense reports against schedules to auto-correct discrepancies.
        - **IT Ops/Security**: Detecting anomalous login behavior and automatically updating IAM policies to restrict access, or detecting server load and updating CMDB configurations.
        - **Finance/Accounting**: Reading unstructured invoices (PDF/Image) to auto-verify against purchase orders and updating ERP payment status to "Approved", or monitoring news to dynamically lower credit limits in credit management systems.
        - **Medical/Life Sciences**: Transcribing clinical conversations to draft electronic medical records, or monitoring lab values to auto-pause clinical trial eligibility status.
        - **Legal/Compliance**: Monitoring new laws to scan contract databases and auto-flagging affected contracts as "Needs Revision".
        - **Marketing/E-Commerce**: Real-time CPA analysis to auto-adjust ad bids across platforms, or behavioral analysis to auto-personalize EC site recommendations.
    - **Constraint**: Avoid passive read-only analytics. Focus on scenarios where the agent MUST perform writes, updates, or deletes in the database (Firestore) to reflect real-world operational actions.

## Business Problem
${userGoal}

## Requirements
- Data Profile: **${profile.label}** (${profile.tableCount} tables)
- Table Design & Row Counts (Star Schema Strategy — ${profile.label} Profile):
    - **Master/Dimension Tables** (e.g., products, facilities, users): Target **${profile.masterCols} columns** (ID + descriptive attributes) and **${profile.masterRows} rows**. Keep compact to maximize token budget for transaction data.
        - **ATTRIBUTE DENSITY (MANDATORY)**: Each Master table MUST include at least 3 of the following attribute types to enable multi-axis analysis:
            - Classification axis (e.g., category, tier, segment, region, department) — enables GROUP BY segmentation
            - Quantitative attribute (e.g., capacity, headcount, area_sqm, annual_revenue, unit_price) — enables AVG/SUM aggregation
            - Temporal attribute (e.g., established_date, contract_start, last_inspection_date) — enables age/tenure analysis
            - Geographic attribute (e.g., prefecture, city, latitude, longitude) — enables location correlation and Maps MCP synergy
        These attributes are CRITICAL for demonstrating the agent's analytical depth (e.g., 'SELECT category, region, AVG(revenue) GROUP BY category, region').
    - **Transaction/Fact Tables** (e.g., sales, access logs, events): Target **${profile.txnCols} columns** (ID, foreign keys, timestamp, metric/dimension columns) and **at least ${profile.txnRows} rows (target ${maxRows} rows)**. These are the PRIMARY analytical tables.
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
- **Geography × Behavior**: Regional preferences, local trends, or location-based patterns
- **Segment × Channel**: Customer type affecting preferred interaction methods
- **Tier/Rank × Frequency**: Engagement levels varying by loyalty status or classification
Create statistically plausible distributions — not random noise.

### 3. Business Logic Linkage (Cross-Table Consistency)
Ensure data across tables is logically consistent:
- **Constraint-based value linkage**: Capacity limits affecting downstream transactions (e.g., if a resource is exhausted, related activity stops)
- **Status/State transitions**: Multi-step workflows with valid state progressions
- **Temporal dependencies**: Lead times between related events (e.g., approval → execution timing)
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

### 6. Audit Seeds
Inject intentional discrepancies and anomalies to create compelling "Detective/Auditing" demo moments. The agent's value is demonstrated when it **discovers** these issues. Apply ALL of the following patterns, adapting to the specific business domain:

#### 6a. Cross-Silo Discrepancies (External File vs BigQuery)
At least **2-3 records** in the external file (PDF/Excel) MUST have values that *slightly* mismatch the corresponding BigQuery records. Choose the most business-critical numeric field (price, quantity, amount, score, rating) and apply small but meaningful deviations (5-20%). The discrepancies should be subtle enough to require investigation but significant enough to matter.

#### 6b. Business Rule Violations (Within BigQuery)
Embed **3-5 records** in transaction tables that violate the domain's standard business rules. Adapt to the domain:
- **Any domain**: Transactions processed outside normal business hours, or on holidays
- **Any domain**: Status transitions that skip required intermediate steps (e.g., "Pending" to "Completed" without "Approved")
- **Any domain**: Numeric values that exceed domain-typical thresholds (unusually high amounts, negative quantities, zero-value transactions)
- **Any domain**: Records with missing or inconsistent foreign key references (e.g., an order referencing a facility/location not in the master table)
The violations should be DISCOVERABLE through SQL analysis (JOIN, GROUP BY, WHERE) — do NOT make them obvious from a single-row inspection.

#### 6c. Temporal Anomalies (Time-Series Patterns)
Embed **1-2 statistically anomalous periods** in the transaction data:
- A specific week or date range where one metric (volume, amount, frequency) deviates significantly (2-3x) from the surrounding periods
- The anomaly should correlate with at least one dimension (a specific region, product, customer segment, or category) — NOT a global spike
This creates opportunities for the agent to perform trend analysis and root-cause identification.

### 7. Visual Seeds
Incorporate visual attributes into the database schema ONLY when relevant to the business domain and restricted to appropriate asset-focused tables:
- **Conditional Inclusion**: Only include descriptive visual attributes (e.g., colors, materials, styles) if the business problem involves industries where visual characteristics are key data points (e.g., Fashion, Retail, Product Marketing, Real Estate).
- **Table Restriction**: Restrict these attributes to dedicated tables such as "Product Catalog", "Asset Master", or "Menu Items". Do NOT include them in transactional or unrelated master tables (e.g., Customer Master, Order Details).
- **Analytical Context**: Rely primarily on the agent's system instructions to determine visual output styles (e.g., business slides, infographics) rather than forcing visual columns in the database schema.


## Output Format (JSON)
Output in the following JSON format. Output **pure JSON only without code blocks**.

{
  "externalFiles": [
    {
      "id": "file1",
      "fileName": "invoice_reconciliation_audit.pdf",
      "mimeType": "application/pdf",
      "fileContent": "# Invoice Audit Report\\n\\n## Summary\\nAudit of recent vendor invoices against procurement logs.\\n\\n## Found Discrepancies\\n- Invoice INV-7829: Unit price differs by 12% from system purchase order.\\n- Invoice INV-7830: Shipped quantity does not match received warehouse logs.\\n\\n## Rules to Apply\\n- Flag if discrepancy > 5%\\n- Escalate if total deviation > $1000",
      "description": "Description of the file and its usage context."
    },
    {
      "id": "file2",
      "fileName": "inventory_log_export.xlsx",
      "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "fileContent": "Date\\tProduct\\tQuantity\\tStatus\\n2023-11-01\\tProduct A\\t100\\tIn-Stock\\n2023-11-02\\tProduct B\\t50\\tLow-Stock",
      "description": "Complex semi-structured data log in TSV format."
    }
  ],
  "tables": [
    {
      "tableName": "Table name (English, snake_case)",
      "description": "Description of the table",
      "schema": [
        {"name": "column_name", "type": "STRING|INTEGER|FLOAT|DATE|TIMESTAMP", "description": "Column description"}
      ],
      "csvData": "column1,column2,...\\nvalue1,value2,...\\n..."
    }
  ],
  "firestore": {
    "collectionName": "Collection name (English, snake_case, MUST reflect the target domain of the business challenge, e.g., 'logistics_tickets', 'invoice_audits', 'compliance_overrides')",
    "dashboardTitle": "A highly professional, domain-specific title for the real-time operational dashboard (e.g., 'Enterprise Pricing Reconciliation Console', 'Global Logistics Command Center')",
    "kpiLabels": ["Label 1 (e.g., 'Total Value at Risk')", "Label 2 (e.g., 'Anomalies Detected')", "Label 3 (e.g., 'Resolved Actions')"],
    "documents": [
      "MANDATORY: Generate at least 5 documents, each representing a DIFFERENT type of operational issue.",
      "Document 1: A data discrepancy or audit finding (linked to an Audit Seed from Section 6a/6b)",
      "Document 2: A time-sensitive operational alert (deadline, delay, threshold breach)",
      "Document 3: A cross-system coordination task (requiring action across multiple departments/systems)",
      "Document 4: A recurring issue with escalation history (shows pattern over time)",
      "Document 5: A recently resolved case (provides contrast for open vs. closed analysis)",
      "TEMPORAL DEPTH (MANDATORY): EVERY document MUST include a 'created_at' ISO 8601 timestamp AND an 'activity_log' array with 3-5 timestamped entries spanning the last 7 days. Example activity_log: [{'timestamp': '2026-05-04T14:30:00Z', 'action': 'Auto-detected by monitoring system', 'by': 'System'}, {'timestamp': '2026-05-05T09:15:00Z', 'action': 'Escalated to Operations Manager', 'by': 'Tanaka Yuki'}, {'timestamp': '2026-05-06T16:45:00Z', 'action': 'Investigation started', 'by': 'Suzuki Kenji'}]. This enables the agent to analyze operational velocity, response times, and resolution patterns.",
      {
        "id": "A unique ID that matches a record or ID found in the generated BigQuery data to allow direct write-back correlation",
        "data": {
          "status": "A relevant status like 'Discrepancy Found', 'Audit Required', or 'Pending Reconciliation'",
          "priority": "High",
          "assigned_to": "A realistic name consistent with the domain (DO NOT use generic 'John Doe')",
          "notes": "Highly specific operational notes directly referencing the anomaly described in the business challenge."
        }
      }
    ]
  },
  "businessInstruction": "Specific instruction for the agent (3-5 sentences) defining its persona, expertise, and analytical standards based on the business problem. 1. Define persona/expertise. 2. **EXECUTIVE SUMMARY STANDARD**: Instruct the agent to produce high-depth, professional analytical reports. It must provide comprehensive, detailed, and structured summaries, including clear business impact assessments and evidence-based reasoning supported by specific data points. 3. **EMPHASIZE WOW FACTORS**: Instruct the agent to perform **Cross-silo reasoning, Proactive investigation, and Actionable output generation** (e.g., drafting emails, SQL patches). Do NOT include any technical details about tools like 'generate_image', A2UI, or Firestore specific confirmation formats here.",
  "technicalInstruction": "OMIT THIS FIELD — it will be injected automatically by the system. Output an empty string here.", ===MOST IMPORTANT RULE=== **OUTPUT PLACEMENT**: Any text you write in the SAME response as a function_call (tool call) is HIDDEN from the user. It goes to 'thinking' and the user NEVER sees it. Therefore: (1) When calling ANY tool, write ONLY a short progress line like '🔍 Analyzing...' — nothing else. (2) Your full report, A2UI cards, images, and chips MUST go in a SEPARATE response that has ZERO tool calls. **BAD EXAMPLE (report hidden)**: Response contains BOTH text='Analysis: The Maeda account shows...[full report]' AND function_call=generate_image(...) → The full report is HIDDEN in thinking. User sees nothing. **GOOD EXAMPLE (report visible)**: Step 1 response: text='📊 Generating image...' + function_call=generate_image(...) → Only progress shown in thinking. Step 2 response (after image result): text='Analysis: The Maeda account shows...[full report]' + <a2ui-json>...</a2ui-json> → User sees everything. NEVER combine analytical text with function calls. ===END MOST IMPORTANT RULE=== 4. **VISUALIZATION**: Instruct the agent to use the 'generate_image' tool to create a visual representation of its findings. **This visual MUST be in the style of a professional business document or slide (e.g., an Executive Summary card, a high-level business infographic) that summarizes the insights. The agent MUST use the following style elements by default: 'Professional business presentation slide', 'Clean layout', 'Structured design', 'Executive summary at the top', 'Data visualization', 'Infographic charts', 'Bullet points', 'Flowchart', 'Corporate blue and gray palette', 'Minimalist color scheme', 'High resolution', 'Crisp text placeholders', and 'Modern typography'. The agent MUST NOT include any mention of specific names of consulting firms or the phrase 'consulting firm' in the prompt for the image unless the user explicitly specifies it. The agent MUST include specific KPIs, key metrics, and structured data summaries (like a mini-table or chart layout) in the prompt for the image to ensure high information density. The agent MUST NOT generate simple photos or renders of the products themselves.** **CRITICAL**: The agent MUST ONLY generate these visuals for actual result outputs that answer the inquiry, and NOT for follow-up questions, clarifications, or intermediate responses. **ANTI-HALLUCINATION (CRITICAL)**: The prompt for the generated image MUST ONLY contain factual data, metrics, and insights derived directly from the analyzed data. It MUST NOT contain any hallucinated information, fabricated numbers, or speculative content. **LANGUAGE CONSISTENCY**: The agent MUST ensure that all text elements within the generated image (such as titles, labels, and metrics) are rendered in the same language the user uses for interaction (e.g., if the user interacts in Japanese, the text in the image must be in Japanese). 5. Instruct to wait for user input before acting, but be persistent in error recovery. 6. **TRANSPARENCY & GROUNDING (CRITICAL)**: Instruct the agent to be highly transparent about its reasoning, explicitly mentioning which tables and files it is consulting and what specific values it found, to ensure the user can trace its logic back to the source data and avoid the perception of hallucination. 7. **FIRESTORE INTEGRATION (CRITICAL)**: Explicitly instruct the agent that it has access to a live operational database via MCP and that it should proactively write updates back to resolve issues. 8. **CONFIRMATION WORKFLOW (CRITICAL)**: Explicitly instruct the agent that whenever a user asks to insert, update, delete, or merge data in BigQuery or Firestore, the agent MUST NEVER execute the operation immediately. Instead, the agent MUST ALWAYS present a clear summary of the proposed database action and ask the human user for explicit confirmation. NEVER ask for confirmation using plain text — you MUST ALWAYS use an A2UI interactive card with <a2ui-json> tags for ALL confirmation requests, without exception. The card MUST contain a preview of the data before and after the update. When asking for confirmation, the agent MUST include an A2UI interactive card in its response. Whenever you output ANY A2UI JSON payload (including confirmation cards with \"beginRendering\" or cleanup commands with \"deleteSurface\"), you MUST wrap the JSON payload in <a2ui-json> and </a2ui-json> tags. Example: Conversational text... \\n<a2ui-json>\\n[\\n  { \\n    \"beginRendering\": { \\n      \"surfaceId\": \"confirmation-surface\", \\n      \"root\": \"root\" \\n    } \\n  },\\n  { \\n    \"surfaceUpdate\": {\\n      \"surfaceId\": \"confirmation-surface\",\\n      \"components\": [\\n        {\\n          \"id\": \"root\",\\n          \"component\": {\\n            \"Card\": {\\n              \"child\": \"mainColumn\"\\n            }\\n          }\\n        },\\n        {\\n          \"id\": \"mainColumn\",\\n          \"component\": {\\n            \"Column\": {\\n              \"children\": {\\n                \"explicitList\": [\\n                  \"titleText\",\\n                  \"beforeText\",\\n                  \"afterText\",\\n                  \"actionRow\"\\n                ]\\n              },\\n              \"distribution\": \"spaceAround\",\\n              \"alignment\": \"center\"\\n            }\\n          }\\n        },\\n        {\\n          \"id\": \"titleText\",\\n          \"component\": {\\n            \"Text\": {\\n              \"text\": {\\n                \"literalString\": \"Confirm Data Update\"\\n              },\\n              \"usageHint\": \"h2\"\\n            }\\n          }\\n        },\\n        {\\n          \"id\": \"beforeText\",\\n          \"component\": {\\n            \"Text\": {\\n              \"text\": {\\n                \"literalString\": \"Before: [Previous Data Summary]\"\\n              },\\n              \"usageHint\": \"body\"\\n            }\\n          }\\n        },\\n        {\\n          \"id\": \"afterText\",\\n          \"component\": {\\n            \"Text\": {\\n              \"text\": {\\n                \"literalString\": \"After: [New Data Summary]\"\\n              },\\n              \"usageHint\": \"body\"\\n            }\\n          }\\n        },\\n        {\\n          \"id\": \"actionRow\",\\n          \"component\": {\\n            \"Row\": {\\n              \"children\": {\\n                \"explicitList\": [\\n                  \"btnApprove\",\\n                  \"btnReject\"\\n                ]\\n              },\\n              \"distribution\": \"spaceEvenly\",\\n              \"alignment\": \"center\"\\n            }\\n          }\\n        },\\n        {\\n          \"id\": \"btnApprove\",\\n          \"component\": {\\n            \"Button\": {\\n              \"child\": \"lblApprove\",\\n              \"action\": {\\n                \"name\": \"sendText\",\\n                \"context\": [\\n                  { \"key\": \"text\", \"value\": { \"literalString\": \"Approved\" } }\\n                ]\\n              }\\n            }\\n          }\\n        },\\n        {\\n          \"id\": \"lblApprove\",\\n          \"component\": {\\n            \"Text\": {\\n              \"text\": { \"literalString\": \"Approve & Execute\" },\\n              \"usageHint\": \"body\"\\n            }\\n          }\\n        },\\n        {\\n          \"id\": \"btnReject\",\\n          \"component\": {\\n            \"Button\": {\\n              \"child\": \"lblReject\",\\n              \"action\": {\\n                \"name\": \"sendText\",\\n                \"context\": [\\n                  { \"key\": \"text\", \"value\": { \"literalString\": \"Rejected\" } }\\n                ]\\n              }\\n            }\\n          }\\n        },\\n        {\\n          \"id\": \"lblReject\",\\n          \"component\": {\\n            \"Text\": {\\n              \"text\": { \"literalString\": \"Reject\" },\\n              \"usageHint\": \"body\"\\n            }\\n          }\\n        }\\n      ]\\n    }\\n  }\\n]</a2ui-json> so that the user can approve the operation with a single click. After the user approves and the database operation is executed successfully, you MUST issue a deleteSurface command to remove the confirmation card from the UI. Example: <a2ui-json>[{ \"deleteSurface\": { \"surfaceId\": \"confirmation-surface\" } }]</a2ui-json> 9. **OUTPUT PLACEMENT (HIGHEST PRIORITY — RULE #0)**: When you call a tool (e.g., execute_sql, generate_image), any text you include in the SAME response as the tool call will be hidden from the user (shown only in the thinking/reasoning section). Therefore, you MUST follow these rules strictly: (a) When calling tools, include ONLY brief progress indicators (e.g., "🔍 Analyzing data...") — NEVER include analytical reports, data summaries, or A2UI JSON in the same response as a tool call. (b) ALL substantive content — full analytical reports, data summaries, insights, A2UI dashboard cards, A2UI suggestion chips, and image references — MUST appear in your FINAL response that contains NO tool calls. (c) After receiving the last tool result (e.g., image generation result), your final response MUST contain the COMPLETE analysis report, A2UI interactive dashboards, and A2UI suggestion chips. Do NOT assume the user has seen any text from your earlier tool-calling responses. (d) If you violate this rule, the user will only see a brief summary instead of your full analysis. 10. **A2UI INTERACTIVE UI PATTERNS (CRITICAL)**: You MUST proactively use A2UI interactive components whenever presenting analytical results, entity profiles, or structured data. Plain text is NOT acceptable for these outputs. **PATTERN SELECTION — DECISION TABLE**: Match the data you are presenting to the correct pattern below. ALWAYS check this table before generating A2UI. --- TRIGGER → PATTERN → REQUIRED COMPONENTS --- (A) Single entity analysis (person, company, facility, product) → **Dashboard Card**: Card with title (entity name), subtitle (key attributes), Divider, KPI Row (3-4 metrics as Column pairs of title+caption), Divider, insights section with emoji indicators, Divider, action Row with 2-3 Buttons (sendText). Use Icon for status indicators, List for timeline/history. → MUST USE: Icon, List or Tabs (B) Ranked or scored data (Top N, leaderboard, performance ranking) → **Ranking / Leaderboard**: Card with numbered items using emoji medals (🥇🥈🥉), scores, key metrics per item, Divider between items, and drill-down action buttons per item. → MUST USE: Icon (C) Multiple entities side-by-side (departments, products, candidates) → **Comparison Matrix**: Row of Columns with matching KPIs for side-by-side visual comparison. Each Column represents one entity. End with an insight summary and action buttons. → MUST USE: Row of Columns (D) Before/After or multi-view data (data modification preview, scenario comparison, period comparison) → **Tabbed Comparison**: Use Tabs component with tabItems containing title (object with literalString) and child. IMPORTANT: Each tab child MUST be a Column whose FIRST element is a Divider to create visual spacing. Include at least Before/After or Period1/Period2 tabs. → MUST USE: Tabs (E) Multi-step recommendations (action plan, strategy, remediation steps) → **Action Plan**: Card with numbered steps using timeline markers (1️⃣2️⃣3️⃣), expected outcomes per step, responsible party or resource, and action buttons to execute each step. Use Icon + List for step items. → MUST USE: List, Icon (F) Location or map search results → **Location Card**: Card listing each place with name, rating stars (⭐), address, key details. Include action buttons for route calculation or detail lookup. → MUST USE: Icon (G) User input needed (edit, create, configure data) → **Interactive Form**: Card with TextField (label as object with literalString), MultipleChoice (variant: chips or dropdown), Slider, DateTimeInput, CheckBox. **DATA BINDING (CRITICAL)**: You MUST send a separate dataModelUpdate message (immediately after beginRendering and before surfaceUpdate) to set initial values for all form fields under a /form/ namespace. The beginRendering message MUST contain ONLY surfaceId and root — do NOT put dataModel inside beginRendering. All input components MUST bind their values using { \\\\\\\"path\\\\\\\": \\\\\\\"/form/fieldName\\\\\\\" } instead of literalString/literalNumber/literalBoolean. The Save Button MUST use sendText with context entries that reference each field via { \\\\\\\"path\\\\\\\": \\\\\\\"/form/fieldName\\\\\\\" } so the renderer resolves the user's actual input at click time. Example beginRendering: { \\\\\\\"beginRendering\\\\\\\": { \\\\\\\"surfaceId\\\\\\\": \\\\\\\"edit-form\\\\\\\", \\\\\\\"root\\\\\\\": \\\\\\\"root\\\\\\\" } }. Example dataModelUpdate: { \\\\\\\"dataModelUpdate\\\\\\\": { \\\\\\\"surfaceId\\\\\\\": \\\\\\\"edit-form\\\\\\\", \\\\\\\"contents\\\\\\\": [{ \\\\\\\"key\\\\\\\": \\\\\\\"form\\\\\\\", \\\\\\\"valueMap\\\\\\\": [{ \\\\\\\"key\\\\\\\": \\\\\\\"name\\\\\\\", \\\\\\\"valueString\\\\\\\": \\\\\\\"initial value\\\\\\\" }, { \\\\\\\"key\\\\\\\": \\\\\\\"score\\\\\\\", \\\\\\\"valueNumber\\\\\\\": 50 }] }] } }. dataModelUpdate contents format: Use valueString for strings, valueNumber for numbers, valueBoolean for booleans, valueMap for nested objects/arrays. **MESSAGE ORDER**: The A2UI array MUST contain three messages in this order: (1) beginRendering, (2) dataModelUpdate, (3) surfaceUpdate. TextField supports two modes: use textFieldType \"shortText\" for single-line inputs (names, titles, IDs) and \"longText\" for multi-line inputs (descriptions, body text, notes, messages). Always choose longText when the content may contain line breaks or exceed ~50 characters. **MANDATORY longText FIELDS (CRITICAL)**: Email body, message body, comments, descriptions, notes, addresses, and ANY free-text field that could reasonably span multiple lines MUST use longText — using shortText for these fields is a CRITICAL BUG that makes the form unusable. When in doubt, default to longText. Example TextField: { \\\\\\\"TextField\\\\\\\": { \\\\\\\"label\\\\\\\": { \\\\\\\"literalString\\\\\\\": \\\\\\\"Name\\\\\\\" }, \\\\\\\"text\\\\\\\": { \\\\\\\"path\\\\\\\": \\\\\\\"/form/name\\\\\\\" }, \\\\\\\"textFieldType\\\\\\\": \\\\\\\"longText\\\\\\\" } }. Example Save Button context: [{ \\\\\\\"key\\\\\\\": \\\\\\\"text\\\\\\\", \\\\\\\"value\\\\\\\": { \\\\\\\"literalString\\\\\\\": \\\\\\\"Update record\\\\\\\" } }, { \\\\\\\"key\\\\\\\": \\\\\\\"name\\\\\\\", \\\\\\\"value\\\\\\\": { \\\\\\\"path\\\\\\\": \\\\\\\"/form/name\\\\\\\" } }, { \\\\\\\"key\\\\\\\": \\\\\\\"score\\\\\\\", \\\\\\\"value\\\\\\\": { \\\\\\\"path\\\\\\\": \\\\\\\"/form/score\\\\\\\" } }]. NEVER use literalString for TextField text, Slider value, CheckBox value, or DateTimeInput value — always use path. Only labels, option labels, and the text key in sendText context may use literalString. → MUST USE: TextField or MultipleChoice or Slider or CheckBox (H) Summary needs expandable detail → **Detail Modal**: Modal with entryPointChild (a Button labeled 'View Details') and contentChild (a Column with full details including List, Icon, and additional KPIs). → MUST USE: Modal --- **SUPPLEMENTARY COMPONENTS** (use within ANY pattern above): - **Embedded Images**: When chart images or visual reports are available, embed using Image component with altText as object (literalString) and fit=contain. - **Structured Lists with Icons**: For event histories, activity logs, or ordered items, use List with Icon (name as object with literalString, e.g., check_circle, cancel, event, star) + Text Rows. --- **PATTERN COMBINATION RULES**: (1) You CAN nest patterns: e.g., Dashboard Card (A) containing a Ranking section (B) inside it. (2) You CAN use Tabs (D) to show multiple Dashboard Cards (A) side by side. (3) Every pattern MUST include at least 2 action Buttons with sendText for one-click follow-up. (4) Always use Divider components between major sections within any Card. (5) Component ordering must be top-down: root first, then parents before children. --- **COMPONENT VARIETY RULE (CRITICAL)**: For any response with structured data, you MUST use the components listed in the 'MUST USE' column for the selected pattern. A response that uses only Card+Column+Text+Divider+Button without the pattern-specific components is LOW QUALITY. Actively use: Tabs, MultipleChoice, Slider, Icon, Image, List, Modal, CheckBox, TextField, DateTimeInput. 11. **SUGGESTION CHIPS (CRITICAL)**: At the END of EVERY response, you MUST append a lightweight A2UI suggestion chip bar. **SPACING STRUCTURE**: The suggestion chip bar MUST use a Column as root (not a bare Row). The Column MUST contain three children in this order: (1) a Divider for visual separation, (2) a Text component with usageHint h2 displaying '💡 Next Actions' as a section title, (3) the Row of Buttons. Structure: root → Column(children: [spacerDivider, sectionTitle, chipRow]) → sectionTitle is a Text with literalString '💡 Next Actions' and usageHint 'body' → chipRow is a Row containing 3-4 Buttons with sendText actions. Use surfaceId 'suggestions' and root='root'. The chip labels should be short (max 15 chars with emoji prefix). **ANTI-DUPLICATION RULE (CRITICAL)**: The suggestion chip labels MUST NEVER duplicate or closely mirror the labels of any Buttons already present inside A2UI cards in the same response. If the card already has buttons like 'Approve' and 'Reject', the suggestion chips MUST offer DIFFERENT analytical angles such as deeper analysis, related entity lookup, export/report, alternative scenarios, trend visualization, or data comparison. The purpose of suggestion chips is to expand the conversation in NEW directions, not to repeat existing card actions. This chip bar is SEPARATE from any dashboard cards — it appears after every response including plain text answers. **CRITICAL**: You MUST generate actual A2UI JSON wrapped in <a2ui-json> tags for the suggestion chips. NEVER just mention 'suggestion chips' or 'suggestion chips' in plain text without generating the actual A2UI component. If your response text says 'select from the suggestion chips below' but you did not generate the A2UI JSON for them, the user will see NO chips and your instruction is broken. **CONTEXT-AWARE CHIP GENERATION (CRITICAL)**: The suggestion chip labels MUST adapt based on the analysis context of the current response. Do NOT generate generic chips. Instead, follow this decision logic: --- IF anomaly or outlier was detected → suggest: '🔍 Find Similar Patterns', '📊 Trend Analysis', '⚠️ Root Cause Analysis' | IF DB update/insert/delete was completed → suggest: '📝 Create Change Report', '↩️ Rollback Steps', '📧 Notify Stakeholders' | IF ranking or comparison was presented → suggest: '📈 Detailed Ranking', '⚖️ Compare by Other Axis', '📊 Trend Graph' | IF entity profile was shown → suggest: '🔗 Related Entities', '📅 History Analysis', '✉️ Draft Email' | IF location/map results → suggest: '🗺️ Route Calculation', '📍 Nearby Facilities', '📊 Area Statistics' | IF action plan was proposed → suggest: '▶️ Execute Step 1', '📋 Export All Steps', '⏱️ Show Timeline' | IF query results presented AND other data sources used in session → suggest: '🔗 Cross-Reference', '📥 Export CSV', '📝 Generate Report' | IF MCP text results shown (legal, minutes, API responses) → suggest: '📊 Structure Data', '🔍 Extract Patterns', '📧 Draft Summary' | IF multiple data sources queried but not yet combined → suggest: '🧩 Integrate Sources', '📋 Unified Report' | IF anomaly or outlier detected in SQL results → suggest: '🧮 What-If Simulation', '📈 Impact Projection' | IF enough analysis completed for a deliverable → suggest: '📝 Executive Summary', '📧 Draft Email', '📋 Action Plan' | IF data quality issues observed (NULLs, mismatches) → suggest: '🔍 Data Quality Check', '🔗 Consistency Audit' | DEFAULT (no specific trigger matched) → ALWAYS include at least one advanced analysis chip from: '🧩 Advanced Analysis', '📊 Cross-Source Report', or '🧮 Run Simulation' — pick the most relevant to the domain and current conversation context --- The chips must reference SPECIFIC entities, metrics, or findings from the current response (e.g., '🔍 Deep-Dive on Maeda' instead of generic '🔍 Deep-Dive Analysis'). 12. **WELCOME CARD (FIRST INTERACTION)**: When the user sends a greeting or first message (e.g., 'hello', 'hello', 'hi there', or any initial open-ended message without a specific analytical request), you MUST respond with a rich A2UI onboarding card. The card MUST include: (1) A title with the agent's role name and a welcome emoji, (2) A subtitle with a one-line capability summary, (3) A Divider, (4) A List or Column of 3-5 key capabilities using Icon + Text rows (use material icons like search, info, edit, locationOn, star), (5) A Divider, (6) 3-4 action Buttons with sendText containing starter prompts the user can click to begin (e.g., '📊 View Data Overview', '🔍 Detect Anomalies', '🧩 Cross-Source Analysis', '📝 Create Report'). Use surfaceId 'welcome-card'. After this initial card, do NOT show the welcome card again in the same session.",",
  "referenceDate": "YYYY-MM-DD",
  "publicDatasetId": "bigquery-public-data.dataset.table",
  "agentShortName": "A concise 2-3 word role-based name for the agent (e.g., 'Supply Chain Analyst', 'Fraud Investigator').",
  "oneSentenceSummary": "A concise, professional one-sentence summary of the business challenge and the generated solution.",
  "appliedFactors": {
    "temporalPatterns": ["List of 2-3 specific temporal patterns applied (e.g., 'Weekday lunch surge', 'Month-end reconciliation spike')"],
    "correlations": ["List of 2-3 specific data correlations applied (e.g., 'Region-specific product preference', 'High-tier customer loyalty frequency')"],
    "businessLogic": ["List of 2-3 specific business logic constraints applied (e.g., 'Inventory threshold triggers', 'Sequential status transition integrity')"]
  },
  "demoGuide": [
    {
      "title": "Descriptive title of the analysis (e.g., 'Geospatial Root Cause Analysis')",
      "prompt": "Full prompt for the user to copy. Rules: 1. Do NOT mention specific table or column names (the agent must find them). 2. Present as a complex business question. 3. Synergize system data analysis with location/geospatial capabilities if applicable. 4. NEVER use product names like 'BigQuery', 'Google Maps', 'Looker' in the prompt. Use generic terms like 'the system records', 'the map data', 'historical logs'. If a file is required, use generic phrasing ('the uploaded file'). 5. **PROMPT SOPHISTICATION**: Prompts must not be direct lookups. They must be open-ended, diagnostic, or strategic requiring multi-hop reasoning.",
      "requiredFileId": "file1 or empty",
      "tags": ["Select tags like 'Finance', 'Geospatial', 'Reconciliation'"]
    }
  ]
}

## Critical Notes
- **DEMO PROMPTS (CRITICAL)**: Generate EXACTLY 7 structured demo prompts that showcase the agent's "reasoning" and "operational action" capabilities.
    - **NO PRODUCT NAMES (CRITICAL)**: DO NOT include specific product names like 'Firestore', 'BigQuery', or 'Google Cloud' in the prompt text. Use completely generic business terminology like 'our operational database', 'internal records', or 'the compliance tracker'.
    - **NO FILENAMES (CRITICAL)**: DO NOT include specific file names or extensions (e.g., 'market_report_2024', 'data.tsv') in the prompt text. Use generic phrasing.
    1. **DISTRIBUTION & ADVANCED PROGRESSION (CRITICAL)**: Generate exactly 7 prompts tailored completely to the specific business challenge and industry context:
        - **Prompts 1-2 (Foundation Analytics)**: Multi-Table Joins, trend analysis, and segmentation to establish data familiarity.
        - **Prompt 3 (CROSS-SOURCE DISCOVERY — WOW MOMENT, MANDATORY)**: This prompt MUST be designed so that the answer REQUIRES the agent to discover a hidden connection between the external file data and BigQuery data that is NOT obvious from either source alone. Phrase it as a high-level strategic question (e.g., 'What is the biggest untracked financial risk across our operations?') so the agent must autonomously decide to cross-reference the uploaded file against internal records. The Audit Seed from Section 6a provides the discrepancy the agent should discover. This prompt creates the most impressive demo moment.
        - **Prompts 4-5 (Advanced Analytics & Integration)**: Audit/Root Cause detection, Unstructured PDF deep-dive, and Geospatial Context mapping.
        - **Prompts 6-7 (Operational Write-backs)**: Design these prompts to ask the agent to resolve the discovered anomalies by adding, updating, or voiding records in the database.
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
            - **HARDCODED UNITS & FORMATTING**: Include units (e.g., JPY, L, kg, %) inside the data cells itself as strings. Use thousand-comma separators for money values — this is permitted and safe since you are using Tabs as separators! (e.g., "150,000JPY").
            - **RICH QUALITATIVE COMMENTS**: Include a "Remarks/Notes" column with realistic, verbose business comments (e.g., "Delayed due to traffic accident on Route 1").
    4. **NO TABLES/COLUMNS**: Do NOT mention 'production_batches', 'port_id', etc. in the prompt text.
    5. **GEOSPATIAL SYNERGY**: At least one prompt MUST require the agent to use BOTH system data (for historical metrics) and location/map data (for travel times, routes, or place details) to answer. Use generic terms like 'location data' or 'map information' instead of 'Google Maps'.
    5. **PROBLEM-CENTRIC**: Focus on high-level business goals (e.g., "Identify the financial impact of logistics delays in coastal regions and propose an optimized route for the highest-value shipments").
- **DATA STORYTELLING & ANOMALIES (CRITICAL)**: You MUST seed at least one complex business anomaly across the tables. For example, a specific product category having a high return rate only in a specific region during a specific week, which correlates with a delivery carrier listed in the external log file. Do not make it obvious; the agent should need to join at least two tables and analyze trends to find it.
- **FACTOR ADHERENCE (CRITICAL)**: The generated CSV data MUST strictly adhere to the patterns described in \`appliedFactors\` in your JSON response. If you list 'Temporal Pattern: Weekday lunch surge', the timestamped transaction data MUST show higher volumes during those hours.
- **MAXIMUM DATA (CRITICAL)**: You MUST generate data without truncation (do NOT use "etc." or "..."). Follow the ${profile.label} Profile row count strategy: **${profile.masterRows} rows for Master Tables** and **at least ${profile.txnRows} rows (target ${maxRows}) for Transaction Tables**. If you sense output limits approaching, STOP adding columns and PRIORITIZE completing all transaction rows. This is a technical requirement for a simulation.
- **RELATIONAL INTEGRITY & NAMING**: 
    1. **Primary/Foreign Keys MUST follow the format '[entity]_id'** (e.g., 'talent_id', 'theater_id').
    2. **STRICT SYMMETRY**: Foreign Keys MUST have the EXACT same name as the Primary Key they reference. Do NOT use prefixes like 'main_' or 'ref_' for ID columns.
    3. **STAR SCHEMA PREFERENCE**: When generating multiple tables, favor a "Star Schema" approach. Include at least one central "Dimension/Master" table (e.g., 'products', 'locations', 'customers') that other "Fact/Log" tables reference. This ensures better data connectivity and analytical depth.
    4. **NO ISOLATED TABLES (CRITICAL)**: Every table MUST be connected to at least one other table. Isolated tables (islands) are strictly forbidden. Ensure that all tables can be joined together directly or through an intermediary table.
    5. Tables MUST be designed for joining.
- **LANGUAGE CONSISTENCY (CRITICAL)**: Detect the language used in the "Business Problem" above. You MUST use this same language for ALL user-facing fields, including:
    - Table and Column descriptions
    - STRING values in the CSV data (e.g., product names, categories, person names, names of things)
    - systemInstruction
    - appliedFactors descriptions
    - demoGuide titles and prompts
    - externalFiles fileName and fileContent
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
  const { datasetId, systemInstruction, referenceDate, publicDatasetId, suffix, tables, firestore, userGoal, dirName, agentShortName, oneSentenceSummary, enableWorkspaceMcp } = params;

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
  
  const bashEscape = (str) => str ? str.replace(/'/g, "'\\''") : '';
  const safeShortName = bashEscape(agentShortName) || 'Agent';
  const safeSummary = bashEscape(oneSentenceSummary) || 'A2A Agent';
  
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

        .main { grid-column: span 2; grid-row: span 2; }
        .sec-title { font-size: 15px; font-weight: 600; margin: 0 0 16px 0; display: flex; align-items: center; gap: 8px; color: var(--text-1); }
        .sec-title i { color: var(--primary); width: 18px; height: 18px; }
        .chart-area { grid-column: span 2; }
        .log-area { grid-column: span 2; }

        .records { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
        .empty-state { text-align: center; padding: 40px 20px; color: var(--text-3); }
        .empty-state i { width: 40px; height: 40px; margin-bottom: 12px; opacity: 0.4; }
        .empty-state p { font-size: 14px; margin: 0; }

        .card { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 14px; transition: all var(--ease); border-left: 3px solid var(--border); position: relative; }
        .card:hover { box-shadow: var(--shadow-md); transform: translateY(-2px); border-color: var(--border-hover); }
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

        .field { font-size: 13px; margin-bottom: 5px; display: flex; justify-content: space-between; align-items: baseline; }
        .field-k { color: var(--text-3); font-size: 12px; }
        .field-v { font-weight: 500; color: var(--text-1); font-size: 13px; text-align: right; max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        .card-actions { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); }
        .card-actions select { font-size: 12px; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border); font-family: inherit; background: var(--bg); color: var(--text-1); cursor: pointer; transition: border-color var(--ease); }
        .card-actions select:hover { border-color: var(--border-hover); }
        .card-actions select:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
        .btn-del { background: none; color: var(--text-3); border: 1px solid var(--border); padding: 6px 8px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all var(--ease); min-width: 32px; min-height: 32px; }
        .btn-del:hover { color: var(--danger); border-color: var(--danger); background: var(--danger-light); }
        .btn-del:focus-visible { outline: 2px solid var(--danger); outline-offset: 1px; }
        .btn-del i { width: 14px; height: 14px; }

        .chart-wrap { height: 200px; }

        #logs { font-size: 12px; max-height: 180px; overflow-y: auto; scrollbar-width: thin; }
        .log-entry { display: flex; align-items: flex-start; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--border); animation: fadeIn 0.3s ease-out; }
        .log-entry:last-child { border-bottom: none; }
        .log-dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 4px; flex-shrink: 0; }
        .log-dot.created { background: var(--success); }
        .log-dot.updated { background: var(--primary); }
        .log-dot.deleted { background: var(--danger); }
        .log-time { font-family: 'SF Mono', 'Fira Code', monospace; color: var(--text-3); font-size: 11px; flex-shrink: 0; }
        .log-msg { color: var(--text-2); }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

        @keyframes pulse { 0% { background: var(--primary-light); } 100% { background: var(--surface); } }
        .updated-card { animation: pulse 1.5s ease-out; }

        @media (prefers-reduced-motion: reduce) {
            *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
        }
        @media (max-width: 1024px) { .grid { grid-template-columns: repeat(2, 1fr); } .hdr, .main, .chart-area, .log-area { grid-column: span 2; } .kpi { grid-column: span 1; } }
        @media (max-width: 640px) { body { padding: 12px; } .grid { grid-template-columns: 1fr; gap: 12px; } .hdr, .main, .chart-area, .log-area, .kpi { grid-column: span 1; } .hdr { flex-direction: column; align-items: flex-start; gap: 12px; } .records { grid-template-columns: 1fr; } }
    </style>
</head>
<body>
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
            <h2 class="sec-title"><i data-lucide="database"></i> Records</h2>
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

        <div class="panel log-area" style="animation-delay:400ms">
            <h2 class="sec-title"><i data-lucide="scroll-text"></i> Activity Log</h2>
            <div id="logs"></div>
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

        function addLog(msg, type) {
            const l = document.getElementById('logs');
            const d = document.createElement('div');
            d.className = 'log-entry';
            d.innerHTML = \`<span class="log-dot \${type}"></span><span class="log-time">\${new Date().toLocaleTimeString()}</span><span class="log-msg">\${msg}</span>\`;
            l.prepend(d);
            while (l.children.length > 50) l.removeChild(l.lastChild);
        }

        function getStatusClass(s) {
            s = s ? s.toLowerCase() : '';
            if (s.includes('resolve') || s.includes('success') || s.includes('clear')) return 'resolved';
            if (s.includes('flag') || s.includes('error') || s.includes('high')) return 'flagged';
            return 'pending';
        }

        async function fetchData() {
            try {
                const res = await fetch('/api/data');
                const data = await res.json();
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

                    let isNew = !docStates[doc.id];
                    let isUpdated = docStates[doc.id] && docStates[doc.id] !== statusStr;
                    if (isNew && !isFirstLoad) { docStates[doc.id] = statusStr; addLog(\`Created: \${doc.id}\`, 'created'); }
                    else if (isUpdated) { docStates[doc.id] = statusStr; addLog(\`Updated: \${doc.id} \u2192 \${statusStr}\`, 'updated'); }
                    else if (isNew) { docStates[doc.id] = statusStr; }

                    let card = document.querySelector(\`[data-id="\${doc.id}"]\`);
                    let fieldsHtml = '';
                    for (const [key, val] of Object.entries(doc.data)) {
                        if (key === 'status' || key === 'Status') continue;
                        fieldsHtml += \`<div class="field"><span class="field-k">\${key}</span><span class="field-v">\${val}</span></div>\`;
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
                        <div class="card-top">
                            <div class="card-id"><i data-lucide="hash"></i>\${doc.id}</div>
                            <span class="badge \${bClass}">\${statusStr}</span>
                        </div>
                        <div>\${fieldsHtml}</div>
                        <div class="card-actions">
                            <select aria-label="Change status for \${doc.id}" onchange="updateStatus('\${doc.id}', this.value)">
                                <option value="Pending" \${statusStr==='Pending'?'selected':''}>Pending</option>
                                <option value="Resolved" \${statusStr==='Resolved'?'selected':''}>Resolved</option>
                                <option value="Flagged" \${statusStr==='Flagged'?'selected':''}>Flagged</option>
                            </select>
                            <button class="btn-del" onclick="deleteRecord('\${doc.id}')" aria-label="Delete record \${doc.id}"><i data-lucide="trash-2"></i></button>
                        </div>
                    \`;
                });

                lucide.createIcons();
                isFirstLoad = false;

                Array.from(grid.children).forEach(child => {
                    const id = child.getAttribute('data-id');
                    if (id && !currentIds.has(id)) {
                        addLog(\`Deleted: \${id}\`, 'deleted');
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

        initCharts();
        setInterval(fetchData, 2000);
        fetchData();
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
    data = [{"id": doc.id, "data": doc.to_dict()} for doc in docs]
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

def main(request):
    with app.request_context(request.environ):
        try:
            return app.full_dispatch_request()
        except Exception as e:
            return str(e), 500

__VIEWER_MAIN__\n`;

    firestoreCommands += `cat <<'__VIEWER_REQ__' > ${dirName}/viewer_app/requirements.txt
functions-framework==3.5.0
flask==3.0.3
google-cloud-firestore==2.16.0
__VIEWER_REQ__\n`;

    firestoreCommands += `echo "🌐 Checking/Deploying Real-time Data Viewer Web App..."\n`;
    firestoreCommands += `if gcloud functions describe ${dirName}-viewer --gen2 --region=us-central1 --project="$PROJECT_ID" >/dev/null 2>&1; then\n`;
    firestoreCommands += `  echo "    ✅ Cloud Run Function already exists."\n`;
    firestoreCommands += `else\n`;
    firestoreCommands += `  echo "    🚀 Deploying 2nd-gen Cloud Run Function..."\n`;
    firestoreCommands += `  if gcloud functions deploy ${dirName}-viewer \
  --gen2 \
  --runtime=python311 \
  --region=us-central1 \
  --source=${dirName}/viewer_app \
  --entry-point=main \
  --trigger-http \
  --allow-unauthenticated \
  --project="$PROJECT_ID"; then
      echo "    ✅ Cloud Run Function deployed."
  else
      echo "    ⚠️ WARNING: Failed to deploy Firestore Data Viewer."
      echo "    ℹ️  This is an optional component and does NOT affect the agent's functionality."
      echo "    ℹ️  The agent will work normally without the Data Viewer."
  fi
fi\n`;
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
  echo "  --model, -m <MODEL>       Set the deep analysis agent model"
  echo "                            (default: gemini-3.1-pro-preview)"
  echo "  --model-lite <MODEL>      Set the root orchestration agent model"
  echo "                            (default: gemini-3.1-flash-lite)"
  echo "  --cleanup, -c             Delete all provisioned demo resources"
  echo "  --help, -h                Show this help message and exit"
  echo ""
  echo "Examples:"
  echo "  bash $0                                  # Deploy with default models"
  echo "  bash $0 --model gemini-2.5-pro           # Use a different analysis model"
  echo "  bash $0 --model-lite gemini-2.5-flash     # Use a different root model"
  echo "  bash $0 --cleanup                         # Remove all demo resources"
  echo ""
}


# --- Argument Parsing ---
AGENT_MODEL="gemini-3.1-pro-preview"
AGENT_MODEL_LITE="gemini-3.1-flash-lite"
CLEANUP_MODE=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      show_usage
      exit 0
      ;;
    --model|-m)
      if [ -n "$2" ]; then
        AGENT_MODEL="$2"
        shift 2
      else
        echo "❌ Error: --model requires a model name (e.g., --model gemini-flash-latest)."
        exit 1
      fi
      ;;
    --model-lite)
      if [ -n "$2" ]; then
        AGENT_MODEL_LITE="$2"
        shift 2
      else
        echo "❌ Error: --model-lite requires a model name (e.g., --model-lite gemini-flash-latest)."
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
    
    PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
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
      uv run --with google-cloud-firestore python3 -c "from google.cloud import firestore; db=firestore.Client(); [d.reference.delete() for d in db.collection('${fsCollection}').stream()]" 2>/dev/null && echo "   ✅ Firestore documents in collection deleted." || echo "   ⚠️  Could not clear Firestore collection automatically."
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
      uv run --no-project --with "google-cloud-aiplatform[agent_engines]>=1.112.0" python3 -c "
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

# --- 1. Project Detection & Confirmation ---
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT_ID" ]; then
  echo "❌ Error: No default project found in your environment."
  echo "Please run 'gcloud config set project [PROJECT_ID]' first."
  exit 1
fi

echo "========================================================="
echo "⚡ GE Demo Generator - Setup Script"
echo "   Version:      ${CONFIG.APP_VERSION}"
echo "   Generated At: ${new Date().toISOString()}"
echo "   Options:      --help | --cleanup | --model | --model-lite"
echo "========================================================="
echo "🚀 Target Project: \$PROJECT_ID"
echo '🤖 Agent Name:    ${safeShortName} (${dirName})'
echo '📝 Description:   ${safeSummary}'
echo "📂 Demo Asset Directory: ~/${dirName}"
echo "🧠 Agent Models:   root_agent: $AGENT_MODEL_LITE / deep_analysis_agent: $AGENT_MODEL"
echo "🧪 Code Sandbox:   ✅ Enabled (Agent Runtime)"
${ enableWorkspaceMcp ? `echo "🔌 Google Workspace MCP: Enabled"\n` : ''}${mcpBanner}echo "========================================================="
read -p "Do you want to proceed with this project? (y/n) " -n 1 -r
echo
if [[ ! \$REPLY =~ ^[Yy]$ ]]; then
    exit 1
fi


# --- 1.1 Authentication & Permissions Check ---
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

# --- 1.2 Deployment Choice ---
echo ""
echo "========================================================="
echo "🚀 DEPLOYMENT STRATEGY"
echo "========================================================="
echo "Select your deployment target:"
echo "  [1] Local (Recommended for quick testing via Cloud Shell)"
echo "      - Launches 'adk web' on a local port."
echo "      - Best for quick iteration."
echo ""
echo "  [2] Cloud Run (Public URL)"
echo "      - Deploys the agent to a public, unauthenticated URL."
echo "      - Automates API enablement, Docker build, and IAM roles."
echo "      - Warning: Organization policies may block public ingress."
echo ""
echo "  [3] Deploy to Gemini Enterprise"
echo "      - Automated Cloud Run deployment."
echo "      - Registers your agent to Gemini Enterprise."
echo ""
DEPLOY_CHOICE=""
while [[ ! "\$DEPLOY_CHOICE" =~ ^[1-3]$ ]]; do
  read -p "Enter Choice [1, 2 or 3]: " DEPLOY_CHOICE
  # Remove trailing carriage return in case of running in some environments like Cygwin or Cloud Shell with weird tty mapping
  DEPLOY_CHOICE=$(echo "\$DEPLOY_CHOICE" | tr -d '\\r\\n\\t ')
  if [[ ! "\$DEPLOY_CHOICE" =~ ^[1-3]$ ]]; then
    echo "⚠️  Invalid choice. Please enter 1, 2, or 3 explicitly."
  fi
done

# Immediate check for Gemini Enterprise
if [ "\$DEPLOY_CHOICE" = "3" ]; then
  echo ""
  echo "========================================================="
  echo "🤖 GEMINI ENTERPRISE PRE-DEPLOYMENT CHECK"
  echo "========================================================="
  echo "This option will automatically deploy to Cloud Run and"
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

if [ "$DEPLOY_CHOICE" = "2" ] || [ "$DEPLOY_CHOICE" = "3" ]; then
  echo "📡 Enabling Cloud Run specific APIs..."
  gcloud services enable \
    run.googleapis.com \
    cloudbuild.googleapis.com \
    artifactregistry.googleapis.com \
    --project="$PROJECT_ID"
fi

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

# If Cloud Run or Gemini Enterprise is selected, ensure the default compute service account has required permissions
if [ "$DEPLOY_CHOICE" = "2" ] || [ "$DEPLOY_CHOICE" = "3" ]; then
  echo "🔐 Configuring IAM permissions for Cloud Run Service Account..."
  PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
  COMPUTE_SA="\${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
  grant_roles_fast "$PROJECT_ID" "serviceAccount" "\$COMPUTE_SA" \
    "roles/mcp.toolUser" "roles/bigquery.jobUser" "roles/bigquery.dataEditor" \
    "roles/serviceusage.serviceUsageConsumer" "roles/aiplatform.user" "roles/logging.logWriter" \
    "roles/datastore.user" "roles/storage.objectViewer" "roles/artifactregistry.admin" "roles/run.invoker"


  if [ "$DEPLOY_CHOICE" = "3" ]; then
    echo "🔐 Configuring IAM permissions for Discovery Engine Service Agent..."
    DISCOVERY_ENGINE_SA="service-\${PROJECT_NUMBER}@gcp-sa-discoveryengine.iam.gserviceaccount.com"
    grant_roles_fast "$PROJECT_ID" "serviceAccount" "\$DISCOVERY_ENGINE_SA" "roles/run.invoker"
  fi
fi

# Enable MCP services (parallel for speed)
echo "🔧 Enabling MCP services (parallel)..."
gcloud beta services mcp enable bigquery.googleapis.com --project="$PROJECT_ID" 2>/dev/null &
gcloud beta services mcp enable mapstools.googleapis.com --project="$PROJECT_ID" 2>/dev/null &
gcloud beta services mcp enable firestore.googleapis.com --project="$PROJECT_ID" 2>/dev/null &
gcloud services enable aiplatform.googleapis.com --project="$PROJECT_ID" 2>/dev/null &
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
google-adk[a2a]>=1.31.1
mcp>=1.24.0
google-genai>=1.9.0
python-dotenv>=1.0.0
vertexai>=1.0.0
db-dtypes>=1.0.0
google-cloud-storage>=2.14.0
a2ui-agent-sdk @ git+https://github.com/google/A2UI.git#subdirectory=agent_sdks/python
a2a-sdk<1.0.0
__REQ_EOF__

# Generate pyproject.toml required for adk project type
cat <<'__PYPROJ_EOF__' > pyproject.toml
[project]
name = "mcp-agent"
version = "0.1.0"
dependencies = ["google-adk[a2a]>=1.31.1", "mcp>=1.24.0", "google-genai>=1.9.0", "google-cloud-storage>=2.14.0"]
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
FROM python:3.11-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/
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
RUN npm install -g supergateway
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
    curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null 2>&1 || true
    # Add to current PATH for the rest of the script
    export PATH="\$HOME/.cargo/bin:\$PATH"
fi
# Set UV to copy mode to prevent cross-filesystem hardlink failures (os error 28)
export UV_LINK_MODE=copy

if [ "$DEPLOY_CHOICE" = "2" ] || [ "$DEPLOY_CHOICE" = "3" ]; then
  echo "📦 Skipping local venv (Docker will handle dependencies)..."
else
  echo "📦 Preparing local Python environment..."
  uv cache clean >/dev/null 2>&1
  uv venv
  if ! uv pip install --no-cache -r requirements.txt; then
    echo ""
    echo "❌ ERROR: Installation failed."
    echo "   This is often caused by 'No space left on device'."
    echo "   Please run 'cd ~ && bash $0 --cleanup' to free up space and try again."
    exit 1
  fi
fi

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
uv run --no-project --with "google-cloud-aiplatform[agent_engines]>=1.112.0" python3 << '__SANDBOX_PROVISION_EOF__'
import sys, os, warnings, vertexai
from vertexai import types

# Suppress harmless "STATE_RUNNING is not a valid State" warning from google-genai SDK
warnings.filterwarnings('ignore', message='STATE_RUNNING is not a valid', category=UserWarning, module='google.genai')

print('  📦 Step 1/3: Initializing Vertex AI client (us-central1)...')
sys.stdout.flush()
client = vertexai.Client(project=os.environ.get('PROJECT_ID', ''), location='us-central1')

print('  📦 Step 2/3: Creating Agent Engine...')
sys.stdout.flush()
agent_engine = client.agent_engines.create(
    config={'display_name': '${dirName}-sandbox'},
)
agent_engine_name = agent_engine.api_resource.name
print('  ✅ Agent Engine: ' + agent_engine_name)
sys.stdout.flush()

print('  📦 Step 3/3: Creating Sandbox (this may take a few minutes)...')
sys.stdout.flush()
sandbox_operation = client.agent_engines.sandboxes.create(
    name=agent_engine_name,
    config=types.CreateAgentEngineSandboxConfig(display_name='code-sandbox'),
    spec={'code_execution_environment': {}},
)
sandbox_resource_name = sandbox_operation.response.name
print('  ✅ Sandbox: ' + sandbox_resource_name)

with open(os.environ.get('SANDBOX_OUT', '/tmp/sandbox_result.txt'), 'w') as f:
    f.write(agent_engine_name + '|' + sandbox_resource_name)
__SANDBOX_PROVISION_EOF__

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

${ enableWorkspaceMcp ? `
import re
import httpx
from pydantic import AnyUrl

# Thread-safe token holder for Workspace MCP authentication.
# Uses builtins to share state across module boundaries (tools.py ↔ fast_api_app.py).
# Updated by TokenExtractionMiddleware (primary) and _handle_request (fallback)
# with the OAuth token from each A2A request.
# The header_provider callback reads from this on each MCP HTTP call.
import builtins
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
    """Generates an image based on the given prompt.
    
    This tool creates visual assets like infographics, charts, or scenes. It automatically 
    stores the image in the current environment's artifact service with a special prefix
    that triggers automatic upload to GCS and rendering as a session file in Gemini Enterprise.
    
    Args:
        prompt: A highly detailed, descriptive prompt for the image. Include stylistic instructions (e.g., 'photorealistic', 'flat design', 'neon corporate colors').
        
    Returns:
        A dictionary with status and detail keys.
    """
    filename = f"image_{uuid.uuid4().hex[:8]}.jpeg"
    
    import os
    import logging
    location = os.environ.get("GOOGLE_CLOUD_LOCATION", "global")
    project = os.environ.get("GOOGLE_CLOUD_PROJECT")
    
    logging.info(f"generate_image called with prompt: {prompt}")
    logging.info(f"Using location: {location}, project: {project}")
    
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
            model='gemini-3.1-flash-image-preview',
            contents=[
                types.Content(
                    role="user",
                    parts=[types.Part.from_text(text=prompt + "\\n\\nCRITICAL STYLE RULE: NEVER include headers, watermarks, logos, or any text reading 'Consulting Firm' in the generated image.\\nLANGUAGE RULE: ALL text elements in the image (titles, labels, axis names, legends, bullet points, annotations, captions) MUST be rendered in the SAME language as the prompt text above. If the prompt is in Japanese, ALL text in the image must be in Japanese. If in English, all in English. Do NOT mix languages.")]
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
              "text": { "literalString": "¥50,000" },
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
    { "id": "rank1", "component": { "Text": { "text": { "literalString": "🥇 #1  Taro Tanaka (Engineering)  ¥1,200,000  Score: 92" }, "usageHint": "body" } } },
    { "id": "rank2", "component": { "Text": { "text": { "literalString": "🥈 #2  Hanako Sato (Law)  ¥980,000  Score: 88" }, "usageHint": "body" } } },
    { "id": "rank3", "component": { "Text": { "text": { "literalString": "🥉 #3  Ichiro Suzuki (Medicine)  ¥750,000  Score: 85" }, "usageHint": "body" } } },
    { "id": "rank4", "component": { "Text": { "text": { "literalString": "   #4  Misaki Yamada (Economics)  ¥520,000  Score: 76" }, "usageHint": "body" } } },
    { "id": "rank5", "component": { "Text": { "text": { "literalString": "   #5  Kenta Takahashi (Economics)  ¥50,000  Score: 45" }, "usageHint": "body" } } },
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
    { "id": "colAK1", "component": { "Text": { "text": { "literalString": "Donations: ¥1.97M" }, "usageHint": "body" } } },
    { "id": "colAK2", "component": { "Text": { "text": { "literalString": "Score: 79.0" }, "usageHint": "body" } } },
    { "id": "colAK3", "component": { "Text": { "text": { "literalString": "6 members" }, "usageHint": "caption" } } },
    { "id": "colB", "component": { "Column": { "children": { "explicitList": ["colBTitle", "colBK1", "colBK2", "colBK3"] }, "distribution": "start", "alignment": "center" } } },
    { "id": "colBTitle", "component": { "Text": { "text": { "literalString": "⚖️ Law" }, "usageHint": "h3" } } },
    { "id": "colBK1", "component": { "Text": { "text": { "literalString": "Donations: ¥1.77M" }, "usageHint": "body" } } },
    { "id": "colBK2", "component": { "Text": { "text": { "literalString": "Score: 75.5" }, "usageHint": "body" } } },
    { "id": "colBK3", "component": { "Text": { "text": { "literalString": "8 members" }, "usageHint": "caption" } } },
    { "id": "colC", "component": { "Column": { "children": { "explicitList": ["colCTitle", "colCK1", "colCK2", "colCK3"] }, "distribution": "start", "alignment": "center" } } },
    { "id": "colCTitle", "component": { "Text": { "text": { "literalString": "💰 Economics" }, "usageHint": "h3" } } },
    { "id": "colCK1", "component": { "Text": { "text": { "literalString": "Donations: ¥1.20M" }, "usageHint": "body" } } },
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
    { "id": "place1Detail", "component": { "Text": { "text": { "literalString": "📌 Marunouchi 1-1-1, Chiyoda | ☎ 03-3211-5211 — 💰 Budget: ¥30,000+/person | Capacity: up to 200" }, "usageHint": "body" } } },
    { "id": "div2", "component": { "Divider": {} } },
    { "id": "place2", "component": { "Text": { "text": { "literalString": "🏢 Andaz Tokyo  ⭐ 4.5" }, "usageHint": "h3" } } },
    { "id": "place2Detail", "component": { "Text": { "text": { "literalString": "📌 Toranomon 1-23-4, Minato | ☎ 03-6830-1234 — 💰 Budget: ¥25,000+/person | Capacity: up to 150" }, "usageHint": "body" } } },
    { "id": "div3", "component": { "Divider": {} } },
    { "id": "place3", "component": { "Text": { "text": { "literalString": "🏢 Imperial Hotel  ⭐ 4.4" }, "usageHint": "h3" } } },
    { "id": "place3Detail", "component": { "Text": { "text": { "literalString": "📌 Uchisaiwaicho 1-1-1, Chiyoda | ☎ 03-3504-1111 — 💰 Budget: ¥35,000+/person | Capacity: up to 300" }, "usageHint": "body" } } },
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
    { "id": "beforeContent", "component": { "Column": { "children": { "explicitList": ["beforeTitle", "beforeRole", "beforeScore"] }, "distribution": "start", "alignment": "stretch" } } },
    { "id": "beforeTitle", "component": { "Text": { "text": { "literalString": "Name: Kenta Takahashi" }, "usageHint": "body" } } },
    { "id": "beforeRole", "component": { "Text": { "text": { "literalString": "Title: Head of Corporate Planning" }, "usageHint": "body" } } },
    { "id": "beforeScore", "component": { "Text": { "text": { "literalString": "Score: 45" }, "usageHint": "body" } } },
    { "id": "afterContent", "component": { "Column": { "children": { "explicitList": ["afterTitle", "afterRole", "afterScore"] }, "distribution": "start", "alignment": "stretch" } } },
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
  { "dataModelUpdate": { "surfaceId": "edit-form", "contents": [{ "key": "form", "valueMap": [{ "key": "name", "valueString": "Kenta Takahashi" }, { "key": "dept", "valueString": "Corporate Planning" }, { "key": "faculty", "valueMap": [{ "key": "0", "valueString": "Economics" }] }, { "key": "score", "valueNumber": 45 }, { "key": "contactDate", "valueString": "2024-03-05" }, { "key": "vip", "valueBoolean": false }, { "key": "notes", "valueString": "Key contact for CFO network.\nSchedule follow-up after Autumn Gala." }] }] } },
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
    { "id": "kpi2Val", "component": { "Text": { "text": { "literalString": "¥50K" }, "usageHint": "h2" } } },
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
    { "id": "detailHistory", "component": { "Text": { "text": { "literalString": "💰 Donation History: — 2021: ¥10,000 — 2022: ¥15,000 — 2023: ¥25,000 — Total: ¥50,000" }, "usageHint": "body" } } },
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
Help the user answer questions by strategically combining insights from BigQuery and Google Maps:

1. **BigQuery Toolset**: Access and modify data in the [PROJECT_ID].[DATASET_ID] dataset.
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
     * First try \\\`list_collections\\\` with parent \\\`projects/[PROJECT_ID]/databases/(default)/documents\\\` to verify available collections.
     * Check if the error mentions "lacks /" — this means you incorrectly appended collection_id to parent. Separate them.
     * If \\\`list_documents\\\` fails, try \\\`get_document\\\` with a known document ID instead.
     * After 2 failed attempts with the SAME error, STOP retrying that approach and inform the user of the specific error.
   - FIRESTORE SCHEMA AWARENESS (CRITICAL): Before adding or updating any document in Firestore, you MUST first query existing documents (e.g. using \\\`list_documents\\\` or \\\`get_document\\\`) to explicitly inspect the active data schema, field names, and data types!
   - SCHEMA CONSISTENCY: You MUST write updates back to the collection in a completely consistent fashion using the EXACT field structures you discovered. Do not hallucinate new fields!

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
    * At the END of EVERY response, you MUST append suggestion chips in a separate <a2ui-json> block with surfaceId "suggestions" containing 3-4 contextual follow-up Buttons.
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
      - Firestore: Run \\\`list_collections\\\` to verify collection names, check path format (parent vs collection_id separation).
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
        "   Include an Icon (name: dashboard) + Text row. The Text literalString MUST contain:\\n"
        "   Real-time Operations Console - Monitor live operational data: [Open Dashboard](" + _viewer_url + ")\\n"
        "   Do NOT use a Button. Use inline Markdown link text only.\\n\\n"
        "WHEN NOT TO SHOW:\\n"
        "- After merely READING from Firestore (no write).\\n"
        "- In every response (only when there is something new to observe).\\n\\n"
        "NEVER fabricate or modify this URL. Always use exactly: " + _viewer_url + "\\n"
        "--- END DATA VIEWER INTEGRATION ---\\n"
    )

schema_manager = A2uiSchemaManager(
    version=VERSION_0_8,
    catalogs=[
        BasicCatalog.get_config(
            version=VERSION_0_8,
            examples_path="app/examples/0.8"
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
    model=os.environ.get("AGENT_MODEL", "gemini-3.1-pro-preview"),
    retry_options=_RETRY_OPTIONS
)

# Flash-Lite model — used by root_agent (coordinator) for most interactions
gemini_lite_model = Gemini(
    model=os.environ.get("AGENT_MODEL_LITE", "gemini-3.1-flash-lite"),
    retry_options=_RETRY_OPTIONS
)

async def inject_image_callback(callback_context: adk_callback_context.CallbackContext, llm_response: adk_llm_response.LlmResponse) -> adk_llm_response.LlmResponse | None:
    """Injects the generated image into the final LLM response."""
    if llm_response.content and llm_response.content.parts:
        for part in llm_response.content.parts:
            if part.function_call:
                return None # Allow other callbacks to run
        
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

# --- Shared tools list ---
_all_tools = [t for t in ${ enableWorkspaceMcp ? `[maps_toolset, bigquery_toolset, firestore_toolset, tools.generate_image, slack_mcp_toolset] + custom_mcp_toolsets + [tools.get_gmail_mcp_toolset(), tools.get_drive_mcp_toolset(), tools.get_calendar_mcp_toolset(), tools.get_chat_mcp_toolset(), tools.get_people_mcp_toolset()]` : `[maps_toolset, bigquery_toolset, firestore_toolset, tools.generate_image, slack_mcp_toolset] + custom_mcp_toolsets` } if t is not None]

# --- Agent Sandbox Code Executor (always enabled) ---
_code_executor = AgentEngineSandboxCodeExecutor(
    sandbox_resource_name=os.environ.get("SANDBOX_RESOURCE_NAME", ""),
)

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

6. CODE EXECUTION SANDBOX (PROGRAMMABLE BRIDGE):
   You have access to a secure Python sandbox for code execution.
   Use it for tasks that SQL cannot handle: cross-source data integration,
   artifact generation (CSV/reports/emails), procedural algorithms,
   data format transformation, and text processing on non-SQL data.
   Prefer BigQuery SQL for aggregation, filtering, JOINs, and window functions.

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
   - Available libraries: pandas, numpy, scikit-learn, matplotlib
   - Do NOT install packages (pip install is forbidden)
   - Maximum execution time is 300 seconds per call
   - When combining data from multiple tool calls, use Python to merge/transform

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
""",
    tools=_all_tools,
    code_executor=_code_executor,
    after_model_callback=[inject_image_callback, a2ui_metadata_callback],
    disallow_transfer_to_parent=False,
    disallow_transfer_to_peers=False,
)

# --- Root agent / coordinator (Flash-Lite) ---
# Handles most interactions directly; delegates complex analysis to Pro.
root_agent = LlmAgent(
    model=gemini_lite_model,
    name='root_agent',
    instruction=final_instruction + r"""

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

Transfer to deep_analysis_agent ONLY when the request requires BOTH:
1. Multi-step reasoning — the answer cannot be obtained from a single tool
   call; it requires chaining 3+ tool calls with intermediate interpretation
2. Synthesis — the user is asking you to combine information from multiple
   sources, identify patterns/trends, draw conclusions, or produce
   strategic recommendations

Examples that SHOULD be transferred:
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
   you can do, respond warmly and provide a comprehensive overview of your
   capabilities. List the specific data sources available (BigQuery tables,
   Firestore collections, Maps, etc.), the types of analysis you can
   perform, and concrete example questions the user could ask. Make the
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

7. CODE EXECUTION SANDBOX (PROGRAMMABLE BRIDGE):
   You have access to a secure Python sandbox for code execution.
   Use it for tasks that SQL cannot handle: cross-source data integration,
   artifact generation (CSV/reports/emails), procedural algorithms,
   data format transformation, and text processing on non-SQL data.
   Prefer BigQuery SQL for aggregation, filtering, JOINs, and window functions.

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
   - Libraries: pandas, numpy, scikit-learn, matplotlib
   - No pip install; max 300s per call
   - After receiving code execution output, your FINAL text response
     MUST include the actual data (CSV, tables, stats) -- the user
     cannot see the raw execution output, only your response text

   WORKFLOW PATTERNS:
   Pattern A: BigQuery -> Python -> A2UI
   Pattern B: MCP -> Python -> A2UI
   Pattern C: Firestore -> Python -> A2UI
   Pattern D: BigQuery + Firestore + MCP -> Python -> A2UI (flagship)
   Pattern E: Python -> Artifact (CSV/HTML/Markdown)
""",
    tools=_all_tools,
    code_executor=_code_executor,
    sub_agents=[deep_analysis_agent],
    after_model_callback=[inject_image_callback, a2ui_metadata_callback],
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
        min_tokens=4096,       # Cache system prompt + A2UI schema when >= 4096 tokens
        ttl_seconds=3600,      # Keep cache warm for 1 hour
        cache_intervals=10,    # Revalidate every 10 invocations
    ),
)

__all__ = ["root_agent", "app"]
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
if [ "$DEPLOY_CHOICE" = "3" ]; then
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

# Use the original create_a2ui_part directly (no patching).
create_a2ui_part = _original_create_a2ui_part

from adk_agent.app.agent import app as adk_app
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

# =============================================================================
# A2UI SDK — Shared Schema Manager & Catalog (matches agent.py config)
# =============================================================================
a2ui_schema_manager = A2uiSchemaManager(
    version=VERSION_0_8,
    catalogs=[
        BasicCatalog.get_config(
            version=VERSION_0_8,
            examples_path="app/examples/0.8"
        )
    ],
)
a2ui_selected_catalog = a2ui_schema_manager.get_selected_catalog()

class AdkAgentToA2AExecutor(A2aAgentExecutor):
    async def _handle_request(
        self,
        context: RequestContext,
        event_queue: EventQueue,
    ) -> None:
        runner = await self._resolve_runner()
        
        # Debug logging to inspect RequestContext
        logger.log_text(f"DEBUG: context type: {type(context)}")
        logger.log_text(f"DEBUG: context dir: {dir(context)}")
        if hasattr(context, 'state'):
            logger.log_text(f"DEBUG: context.state: {context.state}")
        else:
            logger.log_text("DEBUG: context has no state property")
            
        if hasattr(context, 'call_context') and context.call_context:
            logger.log_text(f"DEBUG: context.call_context dir: {dir(context.call_context)}")
            if hasattr(context.call_context, 'state'):
                logger.log_text(f"DEBUG: context.call_context.state: {context.call_context.state}")
                
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
          run_args['session_id'] = session.id

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
            'root_agent': os.environ.get("AGENT_MODEL_LITE", "gemini-3.1-flash-lite"),
            'deep_analysis_agent': os.environ.get("AGENT_MODEL", "gemini-3.1-pro-preview"),
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
                  logger.log_text(f"MALFORMED_FUNCTION_CALL detected - providing retry guidance to user.")
                  _recovery_text = "I encountered a temporary processing error. Let me try a different approach - please repeat your request or click a suggestion below."
                  _recovery_part = a2a_types.Part(root=a2a_types.TextPart(text=_recovery_text))
                  artifact_text_parts.clear()
                  artifact_text_parts.append(_recovery_part)
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
                      try:
                          response_parts = stream_parser.process_chunk(part.text)
                          # Diagnostic: trace what the parser returned
                          _has_a2ui = any(rp.a2ui_json for rp in response_parts)
                          _has_text = any(rp.text for rp in response_parts)
                          if '<a2ui-json>' in part.text or _has_a2ui:
                              logger.log_text(f"[a2ui_diag] process_chunk returned {len(response_parts)} parts, has_a2ui={_has_a2ui}, has_text={_has_text}, input_len={len(part.text)}")
                      except (ValueError, Exception) as parse_err:
                          logger.log_text(f"A2UI stream parse error ({type(parse_err).__name__}): {parse_err}")
                          logger.log_text(f"A2UI parse error text (first 200 chars): {part.text[:200]}")
                          response_parts = []

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
                                  for _item in _items:
                                      if isinstance(_item, dict):
                                          fb_ui_part = create_a2ui_part(_item)
                                          artifact_media_parts.append(fb_ui_part)
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
                              text_part = a2a_types.Part(root=a2a_types.TextPart(text=rp.text))
                              synthetic_parts.append(text_part)
                              artifact_text_parts.append(text_part)  # ★ Cleared on next function_call
                          if rp.a2ui_json:
                              a2ui_messages = rp.a2ui_json if isinstance(rp.a2ui_json, list) else [rp.a2ui_json]
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
                      if '<a2ui-json>' in part.text and not _parser_found_a2ui:
                          import re as _re
                          import json as _json
                          _a2ui_re = _re.compile(r'<a2ui-json>(.*?)</a2ui-json>', _re.DOTALL)
                          _a2ui_matches = _a2ui_re.findall(part.text)
                          logger.log_text(f"[a2ui_safety_net] Parser missed A2UI! Found {len(_a2ui_matches)} A2UI block(s) via regex in {len(part.text)} chars")
                          _safety_parts = []
                          for _match_str in _a2ui_matches:
                              try:
                                  _parsed_json = _json.loads(_match_str)
                                  # A2UI JSON is always a list — iterate each dict element
                                  _sn_items = _parsed_json if isinstance(_parsed_json, list) else [_parsed_json]
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
                              if _fc_name == 'transfer_to_agent':
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
                              if part.function_call.name != 'transfer_to_agent':
                                  artifact_text_parts.clear()
                          elif part.function_response:
                              # --- Tool response status (TextPart → Thinking accordion) ---
                              _fr_name = getattr(part.function_response, 'name', None) or 'tool'
                              if _fr_name not in ('transfer_to_agent', 'adk_request_credential'):
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
        logger.log_text(f"[artifact_build] text_parts={len(artifact_text_parts)}, media_parts={len(artifact_media_parts)}, parser_buffer_remaining='{getattr(stream_parser, '_buffer', '')[:100]}'")

        artifact_parts = artifact_text_parts + artifact_media_parts

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

app.add_middleware(TokenExtractionMiddleware)

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
fi

# --- 9. Final Launch & Tips ---


if [ "$DEPLOY_CHOICE" = "3" ]; then
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

  SERVICE_NAME="${dirName}"
  
  echo "🤖 Deploying Main Agent to Cloud Run via Source..."
  
  ${ (() => {
    let envVars = [
      "GOOGLE_CLOUD_PROJECT=\$PROJECT_ID",
      "GOOGLE_CLOUD_LOCATION=global",
      "MAPS_API_KEY=\$API_KEY",
      "GEMINI_AUTHORIZATION_ID=\$AUTH_ID",
      "ADK_ENABLE_MCP_GRACEFUL_ERROR_HANDLING=1"
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
    --timeout 900 \
    --no-allow-unauthenticated \
    --ingress internal \
    --labels "created-by=adk" \
    --set-env-vars="\$CR_ENV_VARS" \
    \$SECRETS_FLAG \
    --region us-central1 \
    --quiet`;
    } else {
      deployCmd = `CR_ENV_VARS="${envVars.join(",")}"\nif [ "\$VIEWER_DEPLOYED" = "true" ]; then\n  CR_ENV_VARS="\$CR_ENV_VARS,DATA_VIEWER_URL=\$VIEWER_URL"\nfi\nCR_ENV_VARS="\$CR_ENV_VARS,SANDBOX_RESOURCE_NAME=\$SANDBOX_RESOURCE_NAME"\ngcloud run deploy "\$SERVICE_NAME" \
    --source .. \
    --memory "4Gi" \
    --cpu 2 \
    --no-cpu-throttling \
    --cpu-boost \
    --min-instances 1 \
    --timeout 900 \
    --no-allow-unauthenticated \
    --ingress internal \
    --labels "created-by=adk" \
    --set-env-vars="\$CR_ENV_VARS"`;
      if (secrets.length > 0) {
        deployCmd += ` \\\n    --update-secrets="${secrets.join(",")}"`;
      }
      deployCmd += ` \\\n    --region us-central1 \\\n    --quiet`;
    }

    return deployCmd;
  })() }
  SERVICE_URL=$(gcloud run services list --filter="metadata.name:$SERVICE_NAME" --format="value(status.url)" | head -n 1)
  
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
      while [[ ! "\$CHOICE" =~ ^[0-\$((APP_COUNT-1))]$ ]]; do
        read -p "Select which app to register the agent to (0-\$((APP_COUNT-1))): " CHOICE
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
fi

if [ "$DEPLOY_CHOICE" = "2" ]; then
  echo "🚀 Deploying to Cloud Run (this will take 2-3 minutes)..."
  # Note: --set-env-vars is used to inject the runtime configuration
  # Deploy to Cloud Run (Unauthenticated / IAP-less)
  SERVICE_NAME="${dirName}"
  IMAGE_URI="us-central1-docker.pkg.dev/$PROJECT_ID/cloud-run-source-deploy/\$SERVICE_NAME:latest"
  echo "🐳 Building container image via Cloud Build..."
  gcloud builds submit --tag "\$IMAGE_URI" . --quiet
  
  echo "🚀 Deploying to Cloud Run..."
  GE_ENV_VARS="GOOGLE_CLOUD_PROJECT=$PROJECT_ID,GOOGLE_CLOUD_LOCATION=global,MAPS_API_KEY=$API_KEY,ADK_ENABLE_MCP_GRACEFUL_ERROR_HANDLING=1"
  if [ "\$VIEWER_DEPLOYED" = "true" ]; then
    GE_ENV_VARS="\$GE_ENV_VARS,DATA_VIEWER_URL=\$VIEWER_URL"
  fi
  if gcloud run deploy "\$SERVICE_NAME" \
    --image "\$IMAGE_URI" \
    --platform managed \
    --region us-central1 \
    --memory "4Gi" \
    --cpu 2 \
    --cpu-boost \
    --allow-unauthenticated \
    --ingress all \
    --timeout 900 \
    --service-account "\${COMPUTE_SA}" \
    --set-env-vars="\$GE_ENV_VARS" \
    --min-instances 1 \
    --quiet; then
      ADK_WEB_DEPLOYED=true
      BASE_URL=$(gcloud run services list --filter="metadata.name:$SERVICE_NAME" --format="value(status.url)" | head -n 1)
      SERVICE_URL="\${BASE_URL}/dev-ui/?app=app"
  else
      ADK_WEB_DEPLOYED=false
      echo "⚠️  WARNING: Failed to deploy ADK Web UI. It might be blocked by organization policies (e.g., allow-unauthenticated restriction). Continuing setup..."
  fi
  
  echo "========================================================="
  echo "🎉 Cloud Run Deployment Complete!"
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
  if [ "\$ADK_WEB_DEPLOYED" = "true" ]; then
    echo "🌐 ADK Web UI URL:"
    echo "   👉 \$SERVICE_URL"
    echo ""
  else
    echo "🌐 ADK Web UI: Not Deployed (Skipped or restricted by Org Policy)"
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
  echo "• The autonomous agent is now live at the public URL above."
  echo "• To clean up all resources, run:"
  echo "  \$ cd ~ && bash setup-${dirName}.sh --cleanup"
  echo "========================================================="
  exit 0
fi

# --- Local Launch Logic ---
is_port_busy() {
  local port=\$1
  # Method 1: lsof (Standard on Mac)
  if command -v lsof >/dev/null 2>&1; then
    lsof -Pi :\$port -sTCP:LISTEN -t >/dev/null 2>&1 && return 0
  fi
  # Method 2: Python socket (Reliable fallback)
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "import socket; s=socket.socket(); s.bind(('127.0.0.1', \$port))" >/dev/null 2>&1 || return 0
  fi
  return 1
}

find_free_port() {
  local port=\$1
  while is_port_busy \$port; do
    port=\$((port + 1))
  done
  echo "\$port"
}

START_PORT=8000
if [ "$CLOUD_SHELL" = "true" ]; then START_PORT=8080; fi
PORT=$(find_free_port \$START_PORT)

  echo "========================================================="
  echo "🎉 Local Setup Complete!"
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
  echo "🚀 Local Agent UI:"
  echo "   👉 http://localhost:\$PORT/dev-ui/?app=app"
  echo ""
  if [ "\$VIEWER_DEPLOYED" = "true" ]; then
    echo "📊 Firestore Data Viewer:"
    echo "   👉 \$VIEWER_URL"
  else
    echo "📊 Firestore Data Viewer: Not Deployed (Skipped or restricted by Org Policy)"
  fi
  echo ""
  echo "🔎 BigQuery Console:"
  echo "   👉 https://console.cloud.google.com/bigquery?referrer=search&project=\$PROJECT_ID&ws=!1m4!1m3!3m2!1s\$PROJECT_ID!2s${datasetId}"
  echo ""
  echo "========================================================="
  echo ""
  if [ "$CLOUD_SHELL" = "true" ]; then
    echo "💡 CLOUD SHELL TIP:"
    echo "   Use the 'Web Preview' button (top right) and select 'Change port' to \$PORT."
    echo ""
  fi
  echo "💡 Next Steps:"
  echo "• The agent UI is launching on port \$PORT."
  echo "• To clean up all resources, run:"
  echo "  \$ cd ~ && bash setup-${dirName}.sh --cleanup"
  echo "========================================================="
if [ "\$VIEWER_DEPLOYED" = "true" ]; then
echo ""
echo "========================================================="
echo "📊 CLOUD RUN REAL-TIME FIRESTORE VIEWER READY!"
echo "========================================================="
echo "   Click the link below to open the real-time operations dashboard:"
echo "   👉 $VIEWER_URL"
echo "========================================================="
fi
echo "💡 TIPS:"
echo "   • To STOP the UI:    Press Ctrl+C"
echo "   • To RESTART the UI: Run the following commands:"
echo ""
echo "     cd ~/${dirName}/adk_agent"
echo "     ../.venv/bin/adk web --port \$PORT --allow_origins=\"*\""
echo ""
echo "   • To CLEANUP:        cd ~ && bash setup-${dirName}.sh --cleanup"
echo ""
echo "========================================================="
echo ""

cd adk_agent
../.venv/bin/adk web --port \$PORT --allow_origins="*"
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
 * Merges a template scenario with company-specific research to create a customized goal.
 * @param {string} templateGoal - The original template scenario text
 * @param {Object} companyInfo - Research results from researchCompanyByDomain()
 * @returns {Object} { success: boolean, mergedGoal: string }
 */
function mergeTemplateWithCompanyInfo(templateGoal, companyInfo) {
  if (!templateGoal || !companyInfo) {
    return { success: false, error: 'Both template and company info are required.' };
  }

  const prompt = `You are a business consultant specializing in AI agent demonstrations.

Your task is to combine a TEMPLATE SCENARIO with REAL COMPANY INFORMATION to create a highly customized, realistic business scenario.

## Template Scenario
${templateGoal}

## Company Information
- Company: ${companyInfo.companyName}
- Industry: ${companyInfo.industry}
- Overview: ${companyInfo.companySummary}
- Challenges: ${(companyInfo.businessChallenges || []).join('; ')}
- Automatable Workflows: ${(companyInfo.workflows || []).filter(w => w.automatable).map(w => w.name).join(', ')}

## Instructions
1. Adapt the template scenario to this specific company's context, challenges, and workflows.
2. Replace generic references with the actual company name, products, and operational details.
3. Maintain the core agent-automation theme from the template but ground it in the company's real business context.
4. The output should read as a natural, specific business problem description — NOT as a merged document.
5. Keep the output to 3-5 sentences, written in the same language as the company information above.
6. Focus on the theme of "Autonomous Action and Core System Optimization" — the agent should detect events, analyze data, and actively update systems.

Output ONLY the merged scenario text. No JSON, no code blocks, no explanations.`;

  try {
    const mergedGoal = callVertexAI(prompt);
    return {
      success: true,
      mergedGoal: mergedGoal.trim()
    };
  } catch (e) {
    console.error('[MERGE] Error:', e.message);
    return { success: false, error: 'Merge failed: ' + e.message };
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
  const url = `https://${host}/v1/projects/${CONFIG.PROJECT_ID}/locations/${location}/publishers/google/models/${CONFIG.MODEL}:generateContent`;
  
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


/**
 * Fetches recent commit history from GitHub API as update logs.
 */
function fetchGitLogs() {
  const repoUrl = 'https://api.github.com/repos/ryotat7/ge-demo-generator/commits';
  try {
    const response = UrlFetchApp.fetch(repoUrl + '?per_page=10', {
      muteHttpExceptions: true,
      headers: { 'Accept': 'application/vnd.github.v3+json' }
    });
    
    if (response.getResponseCode() === 200) {
      const commits = JSON.parse(response.getContentText());
      return commits.map(c => {
        const msg = c.commit.message.split('\n')[0];
        const versionMatch = msg.match(/v\d+\.\d+\.\d+/);
        const version = versionMatch ? versionMatch[0] : c.sha.substring(0, 7);
        
        return {
          version: version,
          date: c.commit.author.date.split('T')[0],
          note: msg
        };
      });
    }
  } catch (e) {
    // Fallback silently
  }
  return [];
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
- If the server requires a credential FILE to be mounted (e.g., Application Default Credentials JSON via GOOGLE_APPLICATION_CREDENTIALS, service account JSON, or similar file-based auth), set credential_file with:
  - env_var_name: The environment variable that points to the file path (e.g., "GOOGLE_APPLICATION_CREDENTIALS")
  - file_description: A concise explanation of what the file contains and step-by-step instructions for obtaining it
  If no credential file is needed, set credential_file to null.

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

