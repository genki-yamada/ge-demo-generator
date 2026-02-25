# ADK Agent Demo Generator

A Google Apps Script-based tool for rapidly generating hyper-personalized AI agent demos. It synthesizes realistic business datasets and agent configurations on top of the [LaunchMyBakery](https://github.com/google/mcp/tree/main/examples/launchmybakery) demo application.

## Overview

This tool helps you:
- **Generate synthetic datasets** tailored to any business scenario
- **Auto-discover BigQuery public datasets** using Google Search grounding
- **Create ready-to-run setup scripts** for Google Cloud Shell
- **Configure AI agents** with custom system instructions and demo guides (uses `gemini-3.1-pro-preview`)

## Features

### 🎯 Smart Data Synthesis
- Generates 1-3 relational tables with 15-50 rows each
- Ensures relational integrity (consistent primary/foreign keys)
- Supports multi-table JOINs for complex data analysis demos

### 🔍 Dynamic Public Dataset Discovery
Uses Gemini's Google Search grounding to find real BigQuery public datasets, then verifies table existence via BigQuery API.

### 🚀 One-Click Cloud Shell Deployment
Generates a uniquely named setup script (e.g., `setup-demo-retail-inventory-831afa90.sh`) that:
- Creates BigQuery datasets and tables
- Configures ADK agent with MCP servers (BigQuery + Google Maps)
- Launches the agent UI automatically
- Supports `--cleanup` option to remove all deployed resources

### 📖 Interactive Walkthrough
Includes a built-in Cloud Shell tutorial (`tutorial.md`) that guides users through the deployment and demo execution.

### ✅ Targeted Production Deployment
Step 5 allows flexible transition to Vertex AI Agent Engine with:
- **Deployment Mode Choice**: Choose between **Update Existing** (default) to refresh current resources or **Create New** to provision a brand-new agent.
- **Custom Agent Naming**: Set a unique name for your agent in Agent Engine, which automatically updates project configuration.
- **Permission Automation**: Ready-to-use IAM commands for BigQuery/Maps access.

## Naming Conventions

The generator follows a consistent, descriptive naming pattern for all artifacts:
- **Folders**: Prefixed with `demo-` followed by a descriptive ID (e.g., `demo-retail-inventory-831afa90`).
- **BigQuery Datasets**: Prefixed with `demo_` and matches the folder description (e.g., `demo_retail_inventory_831afa90`).
- **Agent Resource Name**: Defaults to `adk-agent` (customizable in Step 5).

## Project Structure

```
ge-demo-generator/
├── Code.gs           # Backend logic (Apps Script)
├── index.html        # Frontend UI
├── appsscript.json   # Apps Script manifest
├── tutorial.md       # Cloud Shell tutorial
└── README.md         # Documentation
```

## Setup

1. Create a new Google Apps Script project
2. Copy `Code.gs` and `index.html` into the project
3. Enable the **BigQuery** Advanced Service:
   - Go to **Services > + Add a service > BigQuery**
4. Deploy as a **Web App**

## Configuration

Update `CONFIG` in `Code.gs` with your settings:

### Option 1: Script Properties (Recommended for Security)

1. Go to **Project Settings > Script Properties**
2. Add the following properties:
   - `PROJECT_ID`: Your Google Cloud project ID
   - `LOCATION`: `global` (default)
   - `MODEL`: `gemini-3-flash-preview` (or your preferred model)

### Option 2: Direct Edit

Update `CONFIG` in `Code.gs`:

```javascript
const CONFIG = {
  PROJECT_ID: 'your-project-id',
  LOCATION: 'global',
  MODEL: 'gemini-3-flash-preview',
  // ...
};
```

## Usage

1. Open the deployed Web App
2. Enter a business scenario (e.g., "Retail optimization for Tokyo stores")
3. Click **Generate Setup Script & Assets**
4. Copy the generated script to Google Cloud Shell
5. Run the script to deploy your personalized demo
6. Use the **New Demo** button at any time to reset the form and start a fresh synthesis.

## Advanced Settings

- **Synthesis Volume**: Rows per table (50/100/150)
- **Dataset Complexity**: Number of tables (5/6/7/8)
- **Public Dataset Override**: Manually specify a BigQuery public dataset
- **Cleanup**: Run `bash setup-demo-xxx.sh --cleanup` to remove all deployed resources

## License

Apache 2.0

## Related Projects

- [LaunchMyBakery](https://github.com/google/mcp/tree/main/examples/launchmybakery) - The base demo application
- [ADK (Agent Development Kit)](https://github.com/google/adk-python) - Python framework for building AI agents
