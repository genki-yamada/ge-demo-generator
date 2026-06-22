/**
 * planning/planning-prompt.js — Node port of GAS buildPlanningPrompt.
 *
 * Verbatim port of Code.gs:1066-1457 (392 lines).
 * Only TWO changes from source:
 *   1. getDataProfile_(...)  → imported getDataProfile from ./plan-helpers.js
 *   2. Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd')
 *        → deps.today ?? formatTokyoDate(new Date())
 *
 * Everything else — every line of the prompt, all ${...} interpolations,
 * all conditional branches — is verbatim.
 */

import { getDataProfile } from './plan-helpers.js';

/**
 * Returns Asia/Tokyo date as yyyy-MM-dd using Intl.DateTimeFormat.
 * Used as the default when deps.today is not injected.
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
 * Builds the planning prompt string for the demo generator LLM call.
 * Pure function — no I/O, no LLM calls.
 *
 * @param {string} userGoal - Business problem description
 * @param {object} options
 * @param {string} [options.dataProfile] - 'deep' | 'standard' | 'wide'
 * @param {number} [options.rowCount]
 * @param {boolean} [options.usePublicDataset]
 * @param {string} [options.publicDatasetId]
 * @param {object} [deps={}]
 * @param {string} [deps.today] - Injected today string (yyyy-MM-dd) for determinism
 * @returns {string} The assembled planning prompt
 */
export function buildPlanningPrompt(userGoal, options, deps = {}) {
  const profile = getDataProfile(options.dataProfile || 'standard');
  const maxRows = Math.min(options.rowCount || profile.defaultRowCount, 150);
  const todayStr = deps.today ?? formatTokyoDate(new Date());
  const publicDatasetInfo = options.usePublicDataset && options.publicDatasetId
    ? `- RELATED PUBLIC DATASET (ENRICHMENT ONLY): ${options.publicDatasetId}
       * ROLE: This dataset serves as EXTERNAL CONTEXT (e.g., weather, statistics) to enrich the core business data.
       * CONSTRAINT: DO NOT use this dataset as a replacement for core business operations (e.g., do not use public orders/customers if you are generating a retail demo).
       * JOIN STRATEGY: Link via common attributes like 'zip_code', 'category', 'region', or 'date' rather than internal system IDs.
       * OUTPUT FIELD (MANDATORY): In your JSON response, set "publicDatasetId" to EXACTLY this ID. Do NOT invent or substitute a different dataset.
       * DEMO GUIDE REQUIREMENT (MANDATORY): At least ONE prompt in 'demoGuide' MUST explicitly ask the agent to enrich the analysis by combining the synthetic tables with this external public dataset (e.g., correlate internal metrics with the external context it provides). Design the JOIN keys in the synthetic tables so this prompt produces meaningful results.`
    : `- IMPORTANT: NO public dataset should be used for this demo. Focus ONLY on synthetic tables below. Do NOT attempt to JOIN with external public-data. In your JSON response, set "publicDatasetId" to null.`;

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

## TEMPORAL ANCHOR (CRITICAL — TODAY'S DATE)
Today's actual date is **${todayStr}**.
- The "referenceDate" field in your JSON output MUST be exactly ${todayStr}. NEVER use a date from your training data as "now" — demos run TODAY, and stale data anchors (e.g., a year-old "current inventory") immediately break the demo's credibility when a user asks about "the current situation".
- All "current state" snapshot records (e.g., latest inventory levels, current statuses, open tasks, active alerts) MUST be dated at or within a few days BEFORE ${todayStr}, so first-touch questions like "what is the current status?" hit fresh, recent data.
- Historical transaction/fact records span backwards from ${todayStr} (see TEMPORAL COVERAGE below). Future dates are allowed ONLY for genuinely forward-looking records (planned work, scheduled deliveries, forecasts) and should fall within ~2 months after ${todayStr}.

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
- **Dates**: Use recent, realistic dates anchored to the referenceDate (= today, ${todayStr}; see TEMPORAL ANCHOR above). Ensure that for TIMESTAMP columns, hours are in the range 00-23, minutes 00-59, and seconds 00-59. Never generate invalid hours like 24 or 25. For \`DATE\` columns, use \`YYYY-MM-DD\`. For \`TIMESTAMP\` columns, use \`YYYY-MM-DD HH:MM:SS\` format. Do not use plain dates in timestamp columns.

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

**FIRST-QUERY DISCOVERABILITY (MANDATORY)**: At least one audit seed MUST be discoverable by the most natural "current status" aggregate query a business user would ask first (e.g., comparing each entity's LATEST snapshot record against a threshold defined in a master table). Verify the anomaly survives a per-entity latest-record aggregation (latest record per entity, then compare) — NOT only a single-row lookup. If snapshot dates differ across entities, the anomaly must still surface when taking each entity's own latest record.

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
  "referenceDate": "MUST be exactly today's date, ${todayStr} (see TEMPORAL ANCHOR).",
  "publicDatasetId": "Echo the RELATED PUBLIC DATASET id exactly as provided above, or null if no public dataset was provided.",
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
