# GE Demo Generator

## What is the GE Demo Generator?

The **GE Demo Generator** is a low-code web application built on Google Apps Script (GAS) that instantly synthesizes fully functional, domain-specific custom demo environments for **Gemini Enterprise**. By inputting your client's unique business challenges, the tool dynamically provisions datasets, an AI agent with MCP toolsets, and a real-time operations dashboard — all tailored to their business workflow.

### 💡 Business Value
- **Hyper-Fast Pre-Sales**: Prepare hyper-personalized demonstrations within minutes instead of weeks.
- **Reality-Grounded Demos**: The tool provisions actual BigQuery analytics, Google Maps grounding, and Firestore persistence databases for a raw, living demo experience.

### ⚙️ Technical Features
- **Dual-Model Agent Architecture**: A Flash-Lite coordinator (`root_agent`) handles routine interactions while a Pro sub-agent (`deep_analysis_agent`) is delegated to for complex multi-step reasoning. Models are configurable via `--model` and `--model-lite` CLI flags.
- **MCP Server Catalog**: A curated catalog of pre-configured MCP servers (Government & Legal, Finance, Social, Japan-Specific, Google Official) with one-click add, recipe bundles, and custom URL import.
- **A2UI (Agent-to-UI) Compliant**: Streams interactive Bento Grid layouts, Analytics Charts, and interactive confirmation cards using the A2UI SDK (`a2ui-agent-sdk`) via `<a2ui-json>` tags embedded in model responses.
- **A2A Protocol Server**: The synthesized agent runs as a FastAPI-based A2A server on Cloud Run, compatible with Gemini Enterprise agent registration.
- **Real-Time Persistence Layer**: The agent modifies Firestore via MCP, and a synthesized **Data Viewer** dashboard (Flask on Cloud Run Functions Gen2) watches Firestore collections and updates in real-time.
- **Three Deployment Targets**: Local (Cloud Shell `adk web`), Cloud Run (public URL with `--min-instances 1`), and Gemini Enterprise (automated Cloud Run + Discovery Engine registration).
- **Custom & Managed MCP Import**: Import third-party MCP servers from GitHub (bridged via `supergateway` stdio→StreamableHTTP) or integrate managed remote MCP servers (e.g., Slack with automated OAuth2 flow).
- **Image Generation**: Built-in `generate_image` tool produces professional infographics and business summary visuals via `gemini-3.1-flash-image-preview`.
- **Context Caching**: `ContextCacheConfig` caches the system instruction and A2UI schema to reduce time-to-first-token.
- **Google Workspace MCP**: Optional integration with Gmail, Drive, Calendar, and People MCP servers via OAuth token passthrough.
- **Customer Domain Research**: Gemini-powered company research via Google Search grounding — automatically identifies business challenges and agent-automatable workflows from a customer's domain.
- **Model Transparency**: Real-time model name announcement in the streaming response accordion for runtime visibility.

---

## 1. Prerequisites

- [Node.js](https://nodejs.org/) installed
- [Clasp](https://github.com/google/clasp) installed globally (`npm install -g @google/clasp`)
- A Google Cloud Project with **Billing enabled**
- The following **Google Cloud APIs** enabled on your project:
  - Vertex AI API (`aiplatform.googleapis.com`)
  - BigQuery API (`bigquery.googleapis.com`)
  - Google Drive API (`drive.googleapis.com`)
  - Sheets API (`sheets.googleapis.com`)
  - Maps Platform APIs (Places, Geocoding, Routes)

---

## 2. Repository Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/ryotat7/ge-demo-generator.git
   cd ge-demo-generator
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Log in to Clasp (if not already):
   ```bash
   clasp login
   ```

---

## 3. Apps Script Project Setup

1. Create a new Google Apps Script project at [script.google.com](https://script.google.com).
2. Find the **Script ID**:
   - Open the Apps Script editor → **Project Settings** (Gear Icon) → **IDs** → copy the **Script ID**.
3. Create a **`.clasp.json`** file in the project root (this file is Git-ignored):
   ```json
   {"scriptId": "YOUR_SCRIPT_ID"}
   ```

---

## 4. Deploying Code to Apps Script

### Prerequisites

| Prerequisite | How to verify / install |
|---|---|
| **Node.js** | `node -v` — install from [nodejs.org](https://nodejs.org/) if missing |
| **Clasp CLI** | `clasp -v` — install with `npm install -g @google/clasp` if missing |
| **Clasp Login** | Run `clasp login` to authenticate with your Google account (required once) |
| **`.clasp.json`** | Must exist in the project root with your Script ID (see Step 3 above) |

### Push / Pull Commands

With the `.clasp.json` in place, use standard `clasp` commands:

```bash
# Push local code to the Apps Script project
clasp push

# Pull latest code from the Apps Script project
clasp pull

# Open the Apps Script project in your browser
clasp open
```

### Files Deployed to Apps Script

The `.claspignore` file controls which files are pushed. Only these files are deployed:
- `appsscript.json` — Manifest (scopes, services, webapp config)
- `Code.gs` — Backend logic
- `index.html` — Frontend SPA
- `SetupError.html` — Configuration error page

---

## 5. Google Cloud Project Setup

### 5.1 Link Apps Script to Your GCP Project

1. In the Apps Script editor, go to **Project Settings** (Gear Icon).
2. Under **Google Cloud Platform (GCP) Project**, click **Change project**.
3. Enter your GCP **Project Number** (not Project ID) and click **Set project**.

### 5.2 Enable Advanced Services

The `appsscript.json` manifest declares two Advanced Services that must be enabled:

| Service | Purpose |
|---|---|
| **BigQuery** (v2) | Used to verify public dataset tables during data generation |
| **Sheets** (v4) | Used to insert People Smart Chips in the usage log spreadsheet |

These are already declared in `appsscript.json` and will be auto-enabled when the script is first authorized.

---

## 6. Script Properties (Zero Hardcoding)

This codebase contains **no hardcoded parameters**. All configuration is managed via **Script Properties**.

### 6.1 Mandatory Properties

| Property | Description |
|---|---|
| `PROJECT_ID` | Your Google Cloud Project ID (e.g., `my-project-123`) |
| `LOG_SHEET_URL` | Full URL of the Google Spreadsheet for usage logging. Must contain a sheet named `Usage_Logs`. |

> **Important**: Both properties are checked at startup. If any are missing, the app displays a `SetupError.html` page with instructions instead of the main UI.

### 6.2 Optional Properties

| Property | Default | Description |
|---|---|---|
| `LOCATION` | `global` | Vertex AI API location (e.g., `us-central1`, `global`) |
| `MODEL` | `gemini-3.1-pro-preview` | Gemini model name for data generation |

### 6.3 Setting Properties

**Option A: Via Script Editor (Recommended for first-time setup)**

1. Open the Apps Script editor.
2. Find the `initializeProject` function.
3. Run it with your values:
   ```javascript
   initializeProject('your-project-id', 'https://docs.google.com/spreadsheets/d/xxx/edit');
   ```

**Option B: Via Project Settings UI**

1. Open the Apps Script editor.
2. Go to **Project Settings** (Gear Icon).
3. Scroll to **Script Properties**.
4. Add each property manually.

---

## 7. Manual API Authorization (Required Once)

Even with correct scopes in `appsscript.json`, you **must** manually authorize the script to access your data.

1. In the Apps Script editor, select the **`forceAuthorizeSpreadsheet`** function from the function dropdown.
2. Click **Run** (▶️).
3. A "Review Permissions" popup will appear. Follow the prompts to authorize access.
   - You may need to click **"Advanced" → "Go to [project name] (unsafe)"** if prompted with an "unverified app" warning.

> **Note**: The `forceAuthorizeSpreadsheet` function explicitly triggers authorization for Spreadsheet scopes by performing a safe read test.

---

## 8. Prepare the Usage Log Spreadsheet

1. Create a new Google Spreadsheet (or use an existing one).
2. Create a sheet named **`Usage_Logs`** with the following header row:

   | Timestamp | User Email | User Goal | AI Summary | Dataset ID | MCP Servers | Generation Time (s) |
   |---|---|---|---|---|---|---|

   > **Note**: The headers are automatically synced on each log write by `ensureLogSheetHeaders()`. You only need to create the sheet — the function will overwrite row 1 with the correct headers.

3. Copy the spreadsheet URL and set it as the `LOG_SHEET_URL` Script Property.

---

## 9. Web App Deployment

1. In the Apps Script editor, click **Deploy > New Deployment**.
2. Click the gear icon next to "Select type" and choose **Web App**.
3. Configure:
   - **Description**: e.g., `GE Demo Generator v1`
   - **Execute as**: `User accessing the web app`
   - **Who has access**: `Anyone` (or restrict as needed)
4. Click **Deploy**.
5. Copy the Web App URL — this is the URL your users will visit.

---

## 10. How the Generated Demo Works

When a user generates a demo through the web UI, the tool:

1. **Plans & Generates** synthetic business data (BigQuery tables, Firestore documents) using Gemini.
2. **Produces a Setup Script** (`setup-demo-xxx.sh`) that the user runs in **Cloud Shell**.
3. The setup script:
   - Creates a BigQuery dataset and loads CSV data
   - Provisions Firestore with operational documents
   - Deploys a **Data Viewer** web app (Flask on Cloud Run Functions Gen2)
   - Scaffolds an ADK agent project with MCP toolsets, A2UI support, and an A2A FastAPI server
   - Supports model override via `--model` and `--model-lite` CLI flags
   - Offers three deployment targets:
     - **[1] Local**: Launches `adk web` on a local port
     - **[2] Cloud Run**: Builds a Docker image and deploys to Cloud Run with `--min-instances 1`
     - **[3] Gemini Enterprise**: Deploys to Cloud Run + registers the agent in Gemini Enterprise via the Discovery Engine API

For a detailed walkthrough, see [tutorial.md](tutorial.md).

---

## 11. Project Structure

```
ge-demo-generator/
├── appsscript.json          # Apps Script manifest (scopes, services, webapp)
├── Code.gs                  # Backend: data generation, setup script synthesis
├── index.html               # Frontend: SPA with demo wizard UI + MCP catalog
├── SetupError.html          # Error page shown when Script Properties are missing
├── package.json             # NPM scripts for clasp push/pull
├── .clasp.json              # (git-ignored) Your Script ID config
├── .claspignore             # Controls which files are pushed to Apps Script
├── tutorial.md              # Cloud Shell interactive tutorial
├── ARCHITECTURE.md          # System architecture documentation
├── AGENTS.md                # AI agent development guide
└── README.md                # This file
```

---

## 12. Cleanup

Generated demos can be fully cleaned up by running the setup script with the `--cleanup` flag:

```bash
bash setup-demo-xxx.sh --cleanup
```

This removes:
- BigQuery dataset and tables
- Google Maps API key
- Cloud Run services (main agent + Data Viewer)
- Firestore collection documents
- Gemini Enterprise agent registration & authorization resource
- Secret Manager secrets (for custom MCP and Slack OAuth tokens)
- Slack App notification (manual deletion at api.slack.com required)
- Local directories and uv caches
