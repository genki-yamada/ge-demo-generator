/**
 * GAS BigQuery MCP Demo Generator - Backend
 * 
 * Dynamically generates a portable AI agent demo environment 
 * using BigQuery and Maps MCP servers.
 */

// ===========================================
// Configuration
// ===========================================
// To configure: Go to Project Settings > Script Properties and set:
//   - PROJECT_ID: Your Google Cloud project ID
//   - LOCATION: API location (default: global)
//   - MODEL: Gemini model name (default: gemini-3-flash-preview)
// ===========================================
const SCRIPT_PROPS = PropertiesService.getScriptProperties();
const CONFIG = {
  PROJECT_ID: SCRIPT_PROPS.getProperty('PROJECT_ID') || 'YOUR_PROJECT_ID',
  LOCATION: SCRIPT_PROPS.getProperty('LOCATION') || 'global',
  MODEL: SCRIPT_PROPS.getProperty('MODEL') || 'gemini-3-flash-preview',
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 1000,
  HISTORY_KEY: 'demo_history',
  MAX_HISTORY: 10
};

// ===========================================
// Web App Entry Point
// ===========================================
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('GE Demo Generator (go/ge-demo-generator)')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ===========================================
// Main Processing
// ===========================================

/**
 * Main function to generate the demo artifacts
 * @param {string} userGoal - User's business problem
 * @param {Object} options - Customization options
 * @returns {Object} Generation result
 */
function generateDemo(userGoal, options = {}) {
  const defaultOptions = {
    rowCount: 100,
    tableCount: 3,
    publicDatasetId: null
  };
  options = { ...defaultOptions, ...options };
  
  const result = {
    success: false,
    steps: [],
    error: null,
    datasetId: null,
    tableInfo: [],
    dataPreview: [],
    systemInstruction: null,
    setupScript: null,
    rawTables: [] // Added to return raw data to the UI
  };
  
  try {
    // Step 1: Planning and Data Generation
    result.steps.push({ step: 1, status: 'running', message: 'Planning & generating data...' });
    const planResult = planAndGenerateData(userGoal, options);
    result.steps[0] = { step: 1, status: 'completed', message: 'Planning complete' };
    
    // Step 2: Validation
    result.steps.push({ step: 2, status: 'running', message: 'Validating generated data...' });
    validateGeneratedData(planResult);
    result.steps[1] = { step: 2, status: 'completed', message: 'Validation complete' };
    
    // Step 3: Skipping Server-side Ingestion (For Portability)
    result.steps.push({ step: 3, status: 'completed', message: 'Portability enabled: Dataset will be created in your environment' });
    
    // Generate unique suffix and base names
    const suffix = Utilities.getUuid().replace(/-/g, '').substring(0, 8);
    const baseName = generateBaseName(userGoal, suffix); // Descriptive name like "retail-inventory-suffix"
    const dirName = "demo-" + baseName;
    const datasetId = ("demo_" + baseName).replace(/-/g, '_');
    
    result.datasetId = datasetId;
    result.dataPreview = planResult.dataPreview;
    result.rawTables = planResult.tables;
    
    // Step 4: Setup Script Generation
    result.steps.push({ step: 4, status: 'running', message: 'Generating portable setup script...' });
    result.systemInstruction = planResult.systemInstruction;
    result.publicDatasetId = planResult.publicDatasetId;
    result.demoGuide = planResult.demoGuide;
    result.setupScript = generateSetupScript({
      datasetId: datasetId,
      systemInstruction: planResult.systemInstruction,
      publicDatasetId: planResult.publicDatasetId,
      suffix: suffix,
      dirName: dirName,
      tables: planResult.tables,
      userGoal: userGoal
    });
    result.steps[3] = { step: 4, status: 'completed', message: 'Generation complete' };
    
    result.success = true;
    
    // Save to history
    saveHistory({
      timestamp: new Date().toISOString(),
      userGoal: userGoal,
      options: options,
      datasetId: datasetId,
      publicDatasetId: planResult.publicDatasetId,
      result: {
        dataPreview: result.dataPreview,
        systemInstruction: result.systemInstruction,
        demoGuide: result.demoGuide,
        setupScript: result.setupScript,
        rawTables: result.rawTables
      }
    });
    
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
  const discoveryPrompt = `Find a real BigQuery public dataset that would be relevant for the following business problem:

"${userGoal}"

Requirements:
1. The dataset MUST exist under the project 'bigquery-public-data'.
2. Search Google to find the exact dataset and table names.
3. Return ONLY the fully qualified ID in the format: bigquery-public-data.dataset_name.table_name
4. If multiple tables exist, choose the most commonly used or primary one.
5. Do NOT invent or hallucinate dataset names.

Examples of real datasets:
- bigquery-public-data.new_york_taxi_trips.tlc_yellow_trips_2022
- bigquery-public-data.thelook_ecommerce.orders
- bigquery-public-data.austin_bikeshare.bikeshare_trips
- bigquery-public-data.noaa_gsod.gsod2023

Return ONLY the dataset ID, nothing else.`;

  const FALLBACK = 'bigquery-public-data.thelook_ecommerce.orders';

  try {
    const result = callVertexAIWithSearch(discoveryPrompt);
    const cleanId = result.trim().replace(/[`'"]/g, '').split('\n')[0];
    
    if (!cleanId.startsWith('bigquery-public-data.') || cleanId.split('.').length < 3) {
    // console.log('Invalid dataset format, using fallback. Raw:', result);
    return FALLBACK;
  }
  
  // Verify the table exists using BigQuery API
  const verifiedId = verifyAndResolveTable(cleanId);
  if (verifiedId) {
    // console.log('Verified public dataset:', verifiedId);
    return verifiedId;
  }
  
  // console.log('Table verification failed, using fallback.');
  return FALLBACK;
} catch (e) {
  // console.log('Dataset discovery failed:', e.message);
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
  const tableId = parts.slice(2).join('.'); // Handle table names with dots
  
  // Try to get the exact table first
  try {
    BigQuery.Tables.get(projectId, datasetId, tableId);
    return candidateId; // Table exists!
  } catch (e) {
    // console.log(`Table ${tableId} not found in ${datasetId}. Searching for alternatives...`);
  }
  
  // Table doesn't exist. List tables in the dataset and pick a suitable one.
  try {
    const tables = BigQuery.Tables.list(projectId, datasetId, { maxResults: 20 });
    if (tables.tables && tables.tables.length > 0) {
      // Prefer tables with common data-related names
      const preferredPatterns = ['trips', 'orders', 'events', 'data', 'stats', 'records'];
      for (const pattern of preferredPatterns) {
        const match = tables.tables.find(t => t.tableReference.tableId.toLowerCase().includes(pattern));
        if (match) {
          const resolvedId = `${projectId}.${datasetId}.${match.tableReference.tableId}`;
          // console.log('Resolved to alternative table:', resolvedId);
          return resolvedId;
        }
      }
      // Fallback to the first table
      const firstTable = tables.tables[0].tableReference.tableId;
      const resolvedId = `${projectId}.${datasetId}.${firstTable}`;
      // console.log('Resolved to first available table:', resolvedId);
      return resolvedId;
    }
  } catch (listError) {
    // console.log('Failed to list tables in dataset:', listError.message);
  }
  
  return null;
}


function planAndGenerateData(userGoal, options) {
  // Step 0: If no public dataset specified, discover one using search grounding
  if (!options.publicDatasetId) {
    options.publicDatasetId = discoverPublicDataset(userGoal);
  }
  
  const prompt = buildPlanningPrompt(userGoal, options);
  const response = callVertexAIWithRetry(prompt);
  
  let parsed;
  try {
    let jsonStr = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    jsonStr = repairTruncatedJson(jsonStr);
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    // Removed raw response log for production cleanup
    throw new Error('Failed to parse AI response. Try reducing the row/table count.');
  }
  
  // Extract preview
  const dataPreview = [];
  if (parsed.tables) {
    for (const table of parsed.tables) {
      if (table.csvData) {
        const lines = table.csvData.trim().split('\n');
        const headers = lines[0].split(',');
        const previewRows = lines.slice(1, 6).map(line => {
          const values = parseCSVLine(line);
          const row = {};
          headers.forEach((h, i) => { row[h.trim()] = values[i] || ''; });
          return row;
        });
        dataPreview.push({
          tableName: table.tableName,
          headers: headers.map(h => h.trim()),
          rows: previewRows,
          totalRows: lines.length - 1
        });
      }
    }
  }
  
  return {
    tables: parsed.tables,
    systemInstruction: parsed.systemInstruction,
    publicDatasetId: parsed.publicDatasetId || options.publicDatasetId,
    demoGuide: parsed.demoGuide,
    dataPreview: dataPreview
  };
}

function buildPlanningPrompt(userGoal, options) {
  const maxRows = Math.min(options.rowCount, 50); // Cap at 50 for stability
  
  return `You are a data analyst and BigQuery expert.
Design and generate a demo dataset based on the following business problem.

## Business Problem
${userGoal}

## Requirements
- Number of tables: ${options.tableCount}
- Rows per table: **Target exactly ${maxRows} diverse rows** per table.
- Related Public Dataset for JOINs: ${options.publicDatasetId}

## Output Format (JSON)
Output in the following JSON format. Output **pure JSON only without code blocks**.

{
  "tables": [
    {
      "tableName": "Table name (English, snake_case)",
      "description": "Description of the table",
      "schema": [
        {"name": "column_name", "type": "STRING|INTEGER|FLOAT|DATE", "description": "Column description"}
      ],
      "csvData": "column1,column2,...\\nvalue1,value2,...\\n..."
    }
  ],
  "systemInstruction": "Specific instruction for the agent (3-5 sentences).",
  "publicDatasetId": "bigquery-public-data.dataset_name.table_name",
  "demoGuide": [
    {
      "title": "Short title in user's language (e.g., '1. USER Greeting')",
      "prompt": "The actual prompt text in user's language"
    }
  ]
}

## Critical Notes
- **RELATIONAL INTEGRITY**: Tables MUST be designed for joining. Ensure consistent Primary/Foreign keys (e.g., customer_id, product_id) with NO dangling references.
- **CSV data MUST NOT exceed ${maxRows} rows**.
- Use double quotes for CSV fields containing commas.
- **LANGUAGE PARITY**: Generate all qualitative content (table/field descriptions, synthetic data values, system instructions, and demo guide) in the **SAME LANGUAGE** as the user's input business problem.
- **DEMO GUIDE**: Provide exactly 5 steps following this flow: 
    1. USER Greeting (Simple greeting to trigger self-introduction)
    2. Data Discovery (Ask about available tables/schema)
    3. Multi-table Insight (JOIN between local tables or with public data)
    4. Geospatial Context (Location/map analysis)
    5. Strategy & Recommendation (Strategic advice based on data)`;
}

// ===========================================
// Step 2: Validation
// ===========================================

function validateGeneratedData(planResult) {
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
  }
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
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
      .substring(0, 20);             // Limit length
    
    if (cleanName.length < 3) cleanName = 'demo-env';
    return `${cleanName}-${suffix}`;
  } catch (e) {
    return `env-${suffix}`;
  }
}

function generateSetupScript(params) {
  const { datasetId, systemInstruction, publicDatasetId, suffix, tables, userGoal, dirName } = params;
  
  const escapedInstruction = systemInstruction
    .replace(/\\/g, '\\\\\\\\')
    .replace(/'/g, "'\\\\''")
    .replace(/\{/g, '{{')
    .replace(/\}/g, '}}')
    .replace(/\n/g, '\\n');

  // Build local BQ creation commands
  let bqCommands = `echo "🗄 Creating BigQuery Dataset: ${datasetId}..."\n`;
  bqCommands += `bq mk --dataset --location=US ${datasetId} 2>/dev/null || echo "Dataset exists."\n\n`;

  for (const table of tables) {
    const schemaStr = table.schema.map(f => `${f.name}:${f.type}`).join(',');
    bqCommands += `echo "📊 Creating Table: ${table.tableName}..."\n`;
    bqCommands += `cat <<'__CSV_EOF__' > ${table.tableName}.csv\n${table.csvData}\n__CSV_EOF__\n`;
    bqCommands += `bq load --source_format=CSV --skip_leading_rows=1 ${datasetId}.${table.tableName} ${table.tableName}.csv ${schemaStr}\n`;
    bqCommands += `rm ${table.tableName}.csv\n\n`;
  }

  return `#!/bin/bash
# ===========================================
# BigQuery MCP Agent Demo - Portable Setup Script
# Generated: ${new Date().toISOString()}
# ===========================================

set -e

# --- 1. Project Detection & Confirmation ---
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT_ID" ]; then
  echo "❌ Error: No default project found in your environment."
  echo "Please run 'gcloud config set project [PROJECT_ID]' first."
  exit 1
fi

echo "💾 Checking disk space..."
FREE_SPACE=$(df -k . | awk 'NR==2 {print $4}')
if [ "$FREE_SPACE" -lt 524288 ]; then
  echo "⚠️  Warning: Low disk space detected in Cloud Shell ($((FREE_SPACE/1024)) MB left)."
  echo "To clear space, you can run: rm -rf ~/my-ge-demo-*"
  echo ""
fi

echo "========================================================="
echo "🚀 Target Project: $PROJECT_ID"
echo "📂 Target Dataset: ${datasetId}"
echo "========================================================="
read -p "Do you want to proceed with this project? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
fi

# --- 2. IAM & API Checks ---
echo "📡 Checking & Enabling APIs..."
gcloud services enable \\
  aiplatform.googleapis.com \\
  bigquery.googleapis.com \\
  apikeys.googleapis.com \\
  mapstools.googleapis.com \\
  cloudresourcemanager.googleapis.com \\
  serviceusage.googleapis.com \\
  iam.googleapis.com \\
  cloudbilling.googleapis.com \\
  --project="$PROJECT_ID"

# Enable MCP services
echo "🔧 Enabling MCP services..."
gcloud beta services mcp enable bigquery.googleapis.com --project="$PROJECT_ID" 2>/dev/null || true
gcloud beta services mcp enable mapstools.googleapis.com --project="$PROJECT_ID" 2>/dev/null || true

# Check for BQ permissions (with timeout to prevent hanging on new projects)
echo "🛡 Checking permissions..."
CAN_MK_BQ=$(timeout 30 bq ls --project_id="$PROJECT_ID" 2>&1 || echo "timeout_or_error")
if [[ $CAN_MK_BQ == *"Access Denied"* ]]; then
  echo "❌ Error: Your account doesn't have BigQuery access in this project."
  exit 1
fi
echo "✅ Permissions OK"

# --- 3. Data Provisioning ---
${bqCommands}

# --- 4. Project Setup (Flat Structure) ---
if [ -d "${dirName}" ]; then
  echo "📂 Removing existing directory ${dirName} for a clean setup..."
  rm -rf "${dirName}"
fi

echo "📦 Setting up project directory..."
mkdir -p ${dirName}/adk_agent/mcp_app
cd ${dirName}

# Generate requirements.txt
cat <<'__REQ_EOF__' > requirements.txt
google-adk>=1.0.0
google-genai>=1.9.0
python-dotenv>=1.0.0
vertexai>=1.0.0
db-dtypes>=1.0.0
__REQ_EOF__

echo "📦 Installing dependencies..."
uv venv
uv pip install -r requirements.txt

# --- 5. Generate Maps API Key ---
echo "🔑 Generating Maps API key..."
API_KEY_JSON=$(gcloud alpha services api-keys create --display-name="MCP-Demo-Key-${suffix}" \\
    --api-target=service=mapstools.googleapis.com \\
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

# Create .env
cat <<__ENV_EOF__ > adk_agent/mcp_app/.env
GOOGLE_GENAI_USE_VERTEXAI=1
GOOGLE_CLOUD_PROJECT="$PROJECT_ID"
GOOGLE_CLOUD_LOCATION="global"
DEMO_DATASET="${datasetId}"
MAPS_API_KEY="$API_KEY"
PYTHONUNBUFFERED=1
__ENV_EOF__

# Create __init__.py files for proper Python package structure
touch adk_agent/__init__.py
cat <<'__INIT_EOF__' > adk_agent/mcp_app/__init__.py
from . import agent
__INIT_EOF__

# --- 6. Customizing Agent ---
echo "🔧 Configuring agent..."

cat <<'__TOOLS_EOF__' > adk_agent/mcp_app/tools.py
import os
import dotenv
import google.auth
import google.auth.transport.requests
from google.adk.tools.mcp_tool.mcp_toolset import MCPToolset
from google.adk.tools.mcp_tool.mcp_session_manager import StreamableHTTPConnectionParams
import httpx
import anyio

# =============================================================================
# 🛡️ Stability Patches for Reasoning Engine (Mandatory)
# =============================================================================

# Force HTTP/1.1 to prevent hangs in streaming responses
_orig_client_init = httpx.AsyncClient.__init__
def _patched_client_init(self, *args, **kwargs):
    kwargs['http2'] = False 
    return _orig_client_init(self, *args, **kwargs)
httpx.AsyncClient.__init__ = _patched_client_init

# Global flag to ensure identity is logged only once
_identity_logged = False

def _log_identity():
    """Logs the current executing identity for debugging permissions."""
    global _identity_logged
    if _identity_logged: return
    try:
        import httpx
        # Check metadata server for the service account email
        r = httpx.get("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email", 
                      headers={"Metadata-Flavor": "Google"}, timeout=1)
        print(f"  [REAL IDENTITY] {r.text.strip()}")
        _identity_logged = True
    except:
        # Fallback to standard check
        try:
            import google.auth
            creds, _ = google.auth.default()
            print(f"  [DETECTED IDENTITY] {getattr(creds, 'service_account_email', 'unknown')}")
            _identity_logged = True
        except: pass

def _get_fresh_bq_token():
    """Retrieves a fresh access token, prioritizing direct metadata server hits in GCP."""
    # Try direct Metadata Server hit first (most reliable in Reasoning Engine)
    import httpx
    try:
        url = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"
        r = httpx.get(url, headers={"Metadata-Flavor": "Google"}, timeout=2)
        if r.status_code == 200:
            return r.json().get("access_token")
    except:
        pass

    # Fallback to google-auth
    import google.auth
    import google.auth.transport.requests
    scopes = ["https://www.googleapis.com/auth/bigquery", "https://www.googleapis.com/auth/cloud-platform"]
    try:
        credentials, _ = google.auth.default(scopes=scopes)
        credentials.refresh(google.auth.transport.requests.Request())
        return credentials.token
    except:
        # Final fallback to gcloud CLI
        import subprocess
        try:
            return subprocess.check_output(["gcloud", "auth", "print-access-token"], text=True).strip()
        except: return ""

# Force HTTP/1.1 and inject fresh tokens for BigQuery MCP
_orig_send = httpx.AsyncClient.send
async def _patched_send(self, request, *args, **kwargs):
    _log_identity()
    
    # If the URL is for BigQuery MCP, ensure a fresh token is injected
    if "bigquery.googleapis.com/mcp" in str(request.url):
        token = _get_fresh_bq_token()
        if token:
            request.headers['Authorization'] = f"Bearer {token}"
            
    # Execute the actual request
    response = await _orig_send(self, request, *args, **kwargs)
    
    # Debug Logging: Capture body for any tool failure
    if response.status_code >= 400 and "googleapis.com/mcp" in str(request.url):
        try:
            body = await response.aread()
            print(f"  [DEBUG ERROR] {request.method} {request.url}")
            print(f"  [DEBUG ERROR] Status: {response.status_code}")
            print(f"  [DEBUG ERROR] Body: {body.decode('utf-8', errors='ignore')}")
            response._content = body 
        except: pass
            
    return response
httpx.AsyncClient.send = _patched_send

# Prevent AnyIO cross-task cancellation errors
import anyio._backends._asyncio
_orig_cancel_exit = anyio._backends._asyncio.CancelScope.__exit__
def _patched_cancel_exit(self, etype, exc, tb):
    try: return _orig_cancel_exit(self, etype, exc, tb)
    except RuntimeError as e:
        if "different task" in str(e): return False
        raise
anyio._backends._asyncio.CancelScope.__exit__ = _patched_cancel_exit

# Prevent telemetry serialization failures for complex tool outputs
try:
    from opentelemetry.sdk.trace import Span
    import json
    def _safe_stringify(value):
        if isinstance(value, (dict, list)):
            try: return json.dumps(value, ensure_ascii=False, default=str)
            except: return str(value)
        return value
    _orig_set_attribute = Span.set_attribute
    def _patched_set_attribute(self, key, value):
        return _orig_set_attribute(self, key, _safe_stringify(value))
    Span.set_attribute = _patched_set_attribute
except: pass

# =============================================================================
# 🔧 MCP Toolset Configuration
# =============================================================================
BIGQUERY_MCP_URL = "https://bigquery.googleapis.com/mcp" 
MAPS_MCP_URL = "https://mapstools.googleapis.com/mcp" 

def get_bigquery_mcp_toolset():
    """Creates a BigQuery MCP toolset. Dynamic refresh is handled by the patch."""
    dotenv.load_dotenv()
    project_id = os.getenv('GOOGLE_CLOUD_PROJECT')
    return MCPToolset(connection_params=StreamableHTTPConnectionParams(
        url=BIGQUERY_MCP_URL, 
        headers={"x-goog-user-project": project_id},
        timeout=180
    ))

def get_maps_mcp_toolset():
    """Creates a Google Maps MCP toolset."""
    dotenv.load_dotenv()
    maps_api_key = os.getenv('MAPS_API_KEY')
    return MCPToolset(connection_params=StreamableHTTPConnectionParams(
        url=MAPS_MCP_URL, 
        headers={"X-Goog-Api-Key": maps_api_key},
        timeout=180
    ))

def get_maps_mcp_toolset():
    """Creates a Google Maps MCP toolset."""
    dotenv.load_dotenv()
    maps_api_key = os.getenv('MAPS_API_KEY')
    return MCPToolset(connection_params=StreamableHTTPConnectionParams(
        url=MAPS_MCP_URL, 
        headers={"X-Goog-Api-Key": maps_api_key},
        timeout=180
    ))
__TOOLS_EOF__

cat <<__AGENT_EOF__ > adk_agent/mcp_app/agent.py
import os

# =============================================================================
# Environment Configuration
# Force project ID and location BEFORE importing ADK/genai
# =============================================================================
os.environ["GOOGLE_CLOUD_PROJECT"] = "$PROJECT_ID"
os.environ["GOOGLE_CLOUD_LOCATION"] = "global"

import dotenv
dotenv.load_dotenv()

from mcp_app import tools
from google.adk.agents import LlmAgent

PROJECT_ID = "$PROJECT_ID"

maps_toolset = tools.get_maps_mcp_toolset()
bigquery_toolset = tools.get_bigquery_mcp_toolset()

# =============================================================================
# AGENT CONFIGURATION (Zero-Formatting Instruction Pattern)
# =============================================================================
# We intentionally avoid Python f-strings or .format() here to prevent crashes
# when the generated System Instruction contains literal curly braces {}.
# =============================================================================

base_instruction = """
Help the user answer questions by strategically combining insights from BigQuery and Google Maps:

1. **BigQuery Toolset**: Access data in the [PROJECT_ID].[DATASET_ID] dataset.
   - Available Tools: \`execute_query_job\`, \`get_table\`, \`list_tables\`.
[PUBLIC_DATASET_INFO]

[GENERATED_SYSTEM_INSTRUCTION]

2. **Maps Toolset**: Real-world location analysis.
   - Available Tools: \`compute_routes\`, \`get_place\`, \`search_places\`, \`geocode\`, \`reverse_geocode\`.
   - IMPORTANT: There is NO weather tool. Do not hallucinate or attempt to use weather services.

---------------------------------------------------
CRITICAL OPERATIONAL RULES:
- SEQUENTIAL EXECUTION: Always perform tool calls one at a time. Do not attempt multiple tool calls in a single response turn.
- RESULT BLOCKING: Wait for a tool's output before deciding on the next tool call.
---------------------------------------------------
"""

public_info = "- Additional Dataset: Use [PUBLIC_DATASET_ID] for context." if "${publicDatasetId}" else ""
instruction = base_instruction\
    .replace("[PROJECT_ID]", PROJECT_ID)\
    .replace("[DATASET_ID]", "${datasetId}")\
    .replace("[PUBLIC_DATASET_INFO]", public_info.replace("[PUBLIC_DATASET_ID]", "${publicDatasetId}"))\
    .replace("[GENERATED_SYSTEM_INSTRUCTION]", """${escapedInstruction}""")

root_agent = LlmAgent(
    model="gemini-3-pro-preview",
    name='root_agent',
    instruction=instruction,
    tools=[maps_toolset, bigquery_toolset]
)
__AGENT_EOF__

clear
echo "========================================================="
echo "🎉 Setup Complete!"
echo "========================================================="
echo ""
echo "📂 Project directory: ${dirName}"
echo "🚀 Launching the Agent UI..."
echo "   (Pre-configured for project: $PROJECT_ID)"
echo ""
echo "========================================================="
echo "💡 TIPS:"
echo "   • To STOP the UI:    Press Ctrl+C"
echo "   • To RESTART the UI: Run the following commands:"
echo ""
echo "     cd ~/${dirName}/adk_agent"
echo "     ../.venv/bin/adk web"
echo ""
echo "========================================================="
echo ""

cd adk_agent
../.venv/bin/adk web
`;
}

// ===========================================
// Vertex AI & Utilities
// ===========================================

function callVertexAIWithRetry(prompt) { return executeWithRetry(() => callVertexAI(prompt)); }

function callVertexAI(prompt) {
  const url = `https://aiplatform.googleapis.com/v1/projects/${CONFIG.PROJECT_ID}/locations/${CONFIG.LOCATION}/publishers/google/models/${CONFIG.MODEL}:generateContent`;
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
  const url = `https://aiplatform.googleapis.com/v1/projects/${CONFIG.PROJECT_ID}/locations/${CONFIG.LOCATION}/publishers/google/models/${CONFIG.MODEL}:generateContent`;
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

function saveHistory(entry) {
  const props = PropertiesService.getUserProperties();
  const historyKey = CONFIG.HISTORY_KEY;
  let history = JSON.parse(props.getProperty(historyKey) || '[]');
  
  // To keep history light, we store only metadata in the main list
  // The heavy result data is stored in separate chunked keys
  const storageId = `demo_data_${new Date(entry.timestamp).getTime()}`;
  const dataToStore = JSON.stringify(entry.result);
  
  // Store the payload in chunks
  saveLargeData(props, storageId, dataToStore);
  
  // Remove the large result from the index entry
  const indexEntry = { ...entry };
  delete indexEntry.result;
  indexEntry.storageId = storageId;
  
  history.unshift(indexEntry);
  
  // Clean up old entries' extra data if exceeding limit
  if (history.length > CONFIG.MAX_HISTORY) {
    const expired = history.pop();
    if (expired.storageId) {
      deleteLargeData(props, expired.storageId);
    }
  }
  
  props.setProperty(historyKey, JSON.stringify(history));
}

function getHistory() { 
  return JSON.parse(PropertiesService.getUserProperties().getProperty(CONFIG.HISTORY_KEY) || '[]'); 
}

/**
 * Retrieves a full history item including its chunked result data
 */
function getHistoryItem(timestamp) {
  const props = PropertiesService.getUserProperties();
  const history = JSON.parse(props.getProperty(CONFIG.HISTORY_KEY) || '[]');
  const entry = history.find(h => h.timestamp === timestamp);
  
  if (entry && entry.storageId) {
    const dataStr = getLargeData(props, entry.storageId);
    if (dataStr) {
      entry.result = JSON.parse(dataStr);
    }
  }
  return entry;
}

/**
 * Deletes a specific history item and its chunked data
 */
function deleteHistoryItem(timestamp) {
  const props = PropertiesService.getUserProperties();
  let history = JSON.parse(props.getProperty(CONFIG.HISTORY_KEY) || '[]');
  
  const index = history.findIndex(h => h.timestamp === timestamp);
  if (index !== -1) {
    const entry = history[index];
    if (entry.storageId) {
      deleteLargeData(props, entry.storageId);
    }
    history.splice(index, 1);
    props.setProperty(CONFIG.HISTORY_KEY, JSON.stringify(history));
  }
  return { success: true };
}

function clearHistory() { 
  const props = PropertiesService.getUserProperties();
  const history = JSON.parse(props.getProperty(CONFIG.HISTORY_KEY) || '[]');
  
  // Clear all chunked data associated with history items
  history.forEach(entry => {
    if (entry.storageId) {
      deleteLargeData(props, entry.storageId);
    }
  });
  
  props.deleteProperty(CONFIG.HISTORY_KEY);
  return { success: true }; 
}

// --- Large Data Chunking Helpers ---

/**
 * GAS PropertiesService has a 9KB limit per key.
 * This helper splits data into multiple chunks.
 */
function saveLargeData(props, baseKey, data) {
  const CHUNK_SIZE = 8000; // Safe margin below 9216 bytes
  const totalChunks = Math.ceil(data.length / CHUNK_SIZE);
  
  for (let i = 0; i < totalChunks; i++) {
    const chunk = data.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    props.setProperty(`${baseKey}_chunk_${i}`, chunk);
  }
  props.setProperty(`${baseKey}_meta`, JSON.stringify({ totalChunks: totalChunks }));
}

function getLargeData(props, baseKey) {
  const metaStr = props.getProperty(`${baseKey}_meta`);
  if (!metaStr) return null;
  
  const meta = JSON.parse(metaStr);
  let data = '';
  for (let i = 0; i < meta.totalChunks; i++) {
    data += props.getProperty(`${baseKey}_chunk_${i}`) || '';
  }
  return data;
}

function deleteLargeData(props, baseKey) {
  const metaStr = props.getProperty(`${baseKey}_meta`);
  if (!metaStr) return;
  
  const meta = JSON.parse(metaStr);
  for (let i = 0; i < meta.totalChunks; i++) {
    props.deleteProperty(`${baseKey}_chunk_${i}`);
  }
  props.deleteProperty(`${baseKey}_meta`);
}

function updateSystemInstruction(setupScript, newInstruction) {
  const escaped = newInstruction.replace(/\\/g, '\\\\').replace(/'/g, "'\\''").replace(/\n/g, '\\n');
  return setupScript.replace(/(1\.\s+\*\*BigQuery toolset:\*\*.*?\n)([\s\S]*?)(\n\s+2\.\s+\*\*Maps Toolset:\*\*)/, `$1${escaped}$3`);
}
