/**
 * planning/research.js — Node port of GAS planning functions.
 *
 * Faithful ports of:
 *   researchCompanyByDomain      Code.gs:15501–15634
 *   regenerateGoalForWorkflows   Code.gs:15644–15701
 *   optimizeGoalWithMagicWand    Code.gs:16413–16497
 *
 * Each function receives a `deps` object with an injected `vertexClient`
 * (produced by makeVertexClient from planning/vertex.js) for full testability.
 */

// ---------------------------------------------------------------------------
// Domain → language map (Code.gs:15510-15517)
// ---------------------------------------------------------------------------
const TLD_LANG_MAP = {
  '.co.jp': '日本語', '.jp': '日本語', '.ne.jp': '日本語', '.or.jp': '日本語', '.ac.jp': '日本語',
  '.de': 'Deutsch', '.fr': 'Français', '.es': 'Español', '.it': 'Italiano',
  '.cn': '中文', '.tw': '中文', '.kr': '한국어', '.br': 'Português',
  '.ru': 'Русский', '.nl': 'Nederlands', '.se': 'Svenska', '.fi': 'Suomi',
  '.in': 'English', '.co.uk': 'English', '.com.au': 'English',
  '.com': 'English', '.io': 'English', '.ai': 'English', '.org': 'English', '.net': 'English',
};

// TLDs sorted longest-first so .co.jp matches before .jp (Code.gs:15521)
const SORTED_TLDS = Object.keys(TLD_LANG_MAP).sort((a, b) => b.length - a.length);

/**
 * Determines response language from domain TLD (Code.gs:15519-15527).
 * @param {string} domain - already normalized domain
 * @returns {string} language name
 */
function detectLanguageFromDomain(domain) {
  for (const tld of SORTED_TLDS) {
    if (domain.endsWith(tld)) {
      return TLD_LANG_MAP[tld];
    }
  }
  return 'English';
}

// ---------------------------------------------------------------------------
// researchCompanyByDomain (Code.gs:15501–15634)
// ---------------------------------------------------------------------------

/**
 * Researches a company by domain using Gemini + Google Search grounding.
 * Returns company info, business challenges, workflows, and a suggested agent goal.
 *
 * Code.gs:15501 function researchCompanyByDomain(domain)
 *
 * @param {string} domain - Customer domain (e.g., "toyota.co.jp")
 * @param {{ vertexClient: object }} deps
 * @returns {Promise<object>} Structured company research results
 */
export async function researchCompanyByDomain(domain, { vertexClient }) {
  // Code.gs:15502-15504: guard
  if (!domain || typeof domain !== 'string') {
    return { success: false, error: 'Domain is required.' };
  }

  // Code.gs:15507: normalize
  domain = domain.trim().toLowerCase()
    .replace(/^(https?:\/\/)?(www\.)?/, '')
    .replace(/\/.*$/, '');

  // Code.gs:15519-15527: detect response language
  const responseLang = detectLanguageFromDomain(domain);

  // Code.gs:15529-15566: prompt (verbatim port)
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
    // Code.gs:15568-15586: direct API call with flash-lite + Google Search grounding
    // generationConfig: { temperature: 0.2, maxOutputTokens: 65535 } (Code.gs:15578)
    // multiPart: true — grounding can return text across multiple parts (Code.gs:15591-15596)
    const allText = await vertexClient.generateContent(prompt, {
      search: true,
      generationConfig: { temperature: 0.2, maxOutputTokens: 65535 },
      multiPart: true,
    });

    // Code.gs:15598: log
    console.log('[RESEARCH] Raw response length: ' + allText.length);

    // Code.gs:15600: strip markdown code blocks
    let jsonStr = allText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    // Code.gs:15602-15614: parse with regex fallback
    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        console.error('[RESEARCH] Failed to parse. Raw text: ' + jsonStr.substring(0, 500));
        throw new Error('Failed to parse research results. The AI response did not contain valid JSON.');
      }
    }

    // Code.gs:15617-15619: validate required fields
    if (!parsed.companyName || !parsed.suggestedGoal) {
      return { success: false, error: 'Could not find sufficient information for domain: ' + domain };
    }

    // Code.gs:15621-15629: success return shape
    return {
      success: true,
      companyName: parsed.companyName,
      companySummary: parsed.companySummary || '',
      industry: parsed.industry || '',
      businessChallenges: parsed.businessChallenges || [],
      workflows: parsed.workflows || [],
      suggestedGoal: parsed.suggestedGoal,
    };
  } catch (e) {
    // Code.gs:15630-15633
    console.error('[RESEARCH] Error for domain ' + domain + ':', e.message);
    return { success: false, error: 'Research failed: ' + e.message };
  }
}

// ---------------------------------------------------------------------------
// regenerateGoalForWorkflows (Code.gs:15644–15701)
// ---------------------------------------------------------------------------

/**
 * Regenerates a business scenario based on user-selected workflows.
 *
 * Code.gs:15644 function regenerateGoalForWorkflows(companyInfo, selectedWorkflows)
 *
 * @param {{ companyName: string, industry: string, companySummary: string }} companyInfo
 * @param {Array<{ name: string, reason: string }>} selectedWorkflows
 * @param {{ vertexClient: object }} deps
 * @returns {Promise<{ success: boolean, goal?: string, error?: string }>}
 */
export async function regenerateGoalForWorkflows(companyInfo, selectedWorkflows, { vertexClient }) {
  // Code.gs:15645-15647: guard
  if (!companyInfo || !selectedWorkflows || selectedWorkflows.length === 0) {
    return { success: false, error: 'Company info and at least one workflow are required.' };
  }

  // Code.gs:15649: detect language from companySummary (CJK/fullwidth range test)
  const responseLang = /[　-鿿＀-￯]/.test(companyInfo.companySummary) ? '日本語' : 'English';

  // Code.gs:15651-15671: prompt (verbatim port)
  const prompt = `You are a business analyst creating an AI agent demo scenario.

Given the company and selected workflows below, write a detailed business scenario (3-5 sentences) suitable as input for an AI agent demo generator.

## Company
- Name: ${companyInfo.companyName}
- Industry: ${companyInfo.industry}
- Overview: ${companyInfo.companySummary}

## Selected Workflows for AI Agent Automation
${selectedWorkflows.map((w) => `- ${w.name}: ${w.reason}`).join('\n')}

## Instructions
- Reference the actual company name and industry
- Focus ONLY on the selected workflows above — do NOT introduce unrelated workflows
- Describe a specific, actionable business problem that an AI agent could solve
- Include realistic operational context (data sources, stakeholders, KPIs)
- Theme: "Autonomous Action and Core System Optimization" — the agent should detect events, analyze data, and actively update core systems
- Write entirely in ${responseLang}

Output ONLY the scenario text. No JSON, no code blocks, no explanations.`;

  try {
    // Code.gs:15674-15683: inline UrlFetchApp call
    // model: gemini-3.1-flash-lite, temperature: 0.3, maxOutputTokens: 1024 (no search)
    // Routed through vertexClient with generationConfig override
    const text = await vertexClient.generateContent(prompt, {
      generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
    });

    // Code.gs:15695-15696: trim and return
    return { success: true, goal: text.trim() };
  } catch (e) {
    // Code.gs:15697-15700
    console.error('[REGEN-GOAL] Error:', e.message);
    return { success: false, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// optimizeGoalWithMagicWand (Code.gs:16413–16497)
// ---------------------------------------------------------------------------

/**
 * Expands and refines a scenario statement into a structured Markdown prompt.
 * Features retry via injected vertexClient (which has built-in retry).
 *
 * Code.gs:16413 function optimizeGoalWithMagicWand(rawGoal)
 *
 * Note on retry semantics: Code.gs:16471-16494 has a custom retry loop that
 * breaks on 4xx non-429 errors. The vertexClient retries on ALL errors. This
 * is a transport-level difference tolerated per the task brief; the prompt text,
 * parse path, and return shape are faithful.
 *
 * generationConfig: temperature:0.4, maxOutputTokens:8192 (Code.gs:16455)
 *
 * @param {string} rawGoal - The user's current scenario text
 * @param {{ vertexClient: object }} deps
 * @returns {Promise<{ success: boolean, optimizedGoal?: string, error?: string }>}
 */
export async function optimizeGoalWithMagicWand(rawGoal, { vertexClient }) {
  // Code.gs:16419-16451: prompt (verbatim port)
  const prompt = `You are an expert prompt engineer and business analyst.
Your task is to take a raw, simple, or loosely defined business scenario, OR a partially structured business scenario (which might contain company details and selected target workflows from prior research), and optimize/expand it into a **perfectly structured, high-density professional Business Scenario prompt** in Markdown format.

Input to Optimize:
"""
${rawGoal}
"""

**CRITICAL MULTILINGUAL RULE (MANDATORY)**:
1. **Language Detection**: Analyze the "Input to Optimize" above and detect its primary language (e.g., English, Japanese, German, French, Spanish, Chinese, Korean, etc.).
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
3.  **No Fictional Placeholders**: Use realistic brand names, locations, and values appropriate to the language context. Do NOT use generic placeholders like "Product A", "Company XYZ", etc.

Return ONLY the raw Markdown text in the detected language. Do not include any code block wrappers (triple backticks), code fences, or preamble.`;

  try {
    // Code.gs:16453-16455: generationConfig temperature:0.4, maxOutputTokens:8192
    // No Google Search grounding (Code.gs uses plain generateContent)
    const result = await vertexClient.generateContent(prompt, {
      generationConfig: { temperature: 0.4, maxOutputTokens: 8192 },
    });

    // Code.gs:16476-16477: trim and return success
    return { success: true, optimizedGoal: result.trim() };
  } catch (e) {
    // Code.gs:16496: return failure with error message
    return {
      success: false,
      error: e.message || 'AI Optimization failed after retries',
    };
  }
}
