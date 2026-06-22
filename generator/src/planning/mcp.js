/**
 * planning/mcp.js — Node port of Code.gs analyzeMcpRepository and helpers.
 *
 * Faithful to:
 *   Code.gs:1   analyzeMcpRepository  (file-collection + Gemini analysis)
 *   Code.gs:92  parseGithubUrl
 *   Code.gs:98  getGithubHeaders
 *   Code.gs:106 getRepositoryFiles
 *   Code.gs:121 getDefaultBranch
 *   Code.gs:136 fetchFileFromGithub
 *   Code.gs:155 callGeminiApi
 *
 * Dependencies are injected for testability:
 *   - vertexClient: { generateContent } — from makeVertexClient
 *   - fetchImpl: fetch-compatible function (default: global fetch)
 *   - githubToken: optional GitHub PAT (default: null)
 */

// ---------------------------------------------------------------------------
// parseGithubUrl — Code.gs:92-96
// ---------------------------------------------------------------------------

/**
 * Extract { owner, repo } from a GitHub URL.
 * Strips .git suffix. Throws on non-GitHub URLs.
 * @param {string} url
 * @returns {{ owner: string, repo: string }}
 */
export function parseGithubUrl(url) {
  const match = url.match(/github\.com[/:]\s*([^/]+)\/([^/]+)/);
  if (!match) throw new Error('Invalid GitHub URL');
  return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
}

// ---------------------------------------------------------------------------
// getGithubHeaders — Code.gs:98-104
// ---------------------------------------------------------------------------

/**
 * Build GitHub request headers. Adds Authorization if token is present.
 * @param {string|null} githubToken
 * @returns {object}
 */
function getGithubHeaders(githubToken) {
  const headers = {};
  if (githubToken) {
    headers['Authorization'] = `token ${githubToken}`;
  }
  return headers;
}

// ---------------------------------------------------------------------------
// getRepositoryFiles — Code.gs:106-119
// ---------------------------------------------------------------------------

/**
 * Fetch the recursive git tree for a repository.
 * @param {string} owner
 * @param {string} repo
 * @param {string} branch
 * @param {Function} fetchImpl
 * @param {string|null} githubToken
 * @returns {Promise<Array>}
 */
async function getRepositoryFiles(owner, repo, branch, fetchImpl, githubToken) {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  try {
    const response = await fetchImpl(apiUrl, { headers: getGithubHeaders(githubToken) });
    if (response.ok || response.status === 200) {
      const json = await response.json();
      return json.tree || [];
    }
  } catch (e) {
    // swallow — Code.gs:117
  }
  return [];
}

// ---------------------------------------------------------------------------
// getDefaultBranch — Code.gs:121-134
// ---------------------------------------------------------------------------

/**
 * Fetch the default branch name from the GitHub repository metadata.
 * Falls back to "main" on any failure.
 * @param {string} owner
 * @param {string} repo
 * @param {Function} fetchImpl
 * @param {string|null} githubToken
 * @returns {Promise<string>}
 */
async function getDefaultBranch(owner, repo, fetchImpl, githubToken) {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;
  try {
    const response = await fetchImpl(apiUrl, { headers: getGithubHeaders(githubToken) });
    if (response.ok || response.status === 200) {
      const json = await response.json();
      return json.default_branch || 'main';
    }
  } catch (e) {
    // swallow — Code.gs:132
  }
  return 'main';
}

// ---------------------------------------------------------------------------
// fetchFileFromGithub — Code.gs:136-153
// ---------------------------------------------------------------------------

/**
 * Try to fetch a raw file from GitHub, trying several branches in order.
 * Returns null if the file is not found on any branch.
 * @param {string} owner
 * @param {string} repo
 * @param {string} defaultBranch
 * @param {string} path
 * @param {Function} fetchImpl
 * @param {string|null} githubToken
 * @returns {Promise<string|null>}
 */
async function fetchFileFromGithub(owner, repo, defaultBranch, path, fetchImpl, githubToken) {
  const branches = [defaultBranch, 'main', 'master', 'HEAD'];
  for (const branch of branches) {
    const apiUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
    try {
      const response = await fetchImpl(apiUrl, { headers: getGithubHeaders(githubToken) });
      if (response.ok || response.status === 200) {
        return await response.text();
      }
    } catch (e) {
      // Continue to next branch — Code.gs:149
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// callGeminiApi — Code.gs:155-288
// ---------------------------------------------------------------------------

/**
 * Call Vertex AI (gemini-3.1-flash-lite) with the MCP analysis prompt.
 * Returns the raw text from candidates[0].content.parts[0].text.
 *
 * @param {string} contextContent  — combined repository file contents
 * @param {string} url             — original repo URL (kept for parity with GAS signature)
 * @param {{ vertexClient: object }} deps
 * @returns {Promise<string>}
 */
async function callGeminiApi(contextContent, url, { vertexClient }) {
  // Prompt verbatim from Code.gs:163-225
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

  // responseSchema verbatim from Code.gs:231-273
  const generationConfig = {
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'OBJECT',
      properties: {
        is_supported: { type: 'BOOLEAN' },
        unsupported_reason: { type: 'STRING' },
        language: { type: 'STRING', enum: ['python', 'nodejs'] },
        entrypoint: { type: 'STRING' },
        transport_mode: { type: 'STRING' },
        required_env_vars: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              key: { type: 'STRING' },
              description: { type: 'STRING' },
              is_secret: { type: 'BOOLEAN' },
              is_required: { type: 'BOOLEAN' },
            },
            required: ['key', 'description', 'is_secret', 'is_required'],
          },
        },
        capabilities: {
          type: 'ARRAY',
          items: { type: 'STRING' },
        },
        npm_ignore_scripts: { type: 'BOOLEAN' },
        degraded_tools: {
          type: 'ARRAY',
          items: { type: 'STRING' },
        },
        credential_file: {
          type: 'OBJECT',
          nullable: true,
          properties: {
            env_var_name: { type: 'STRING' },
            file_description: { type: 'STRING' },
          },
          required: ['env_var_name', 'file_description'],
        },
      },
      required: [
        'is_supported',
        'unsupported_reason',
        'language',
        'entrypoint',
        'transport_mode',
        'required_env_vars',
        'capabilities',
        'npm_ignore_scripts',
        'degraded_tools',
      ],
    },
  };

  // Code.gs:284-287: call Vertex and return candidates[0].content.parts[0].text
  // vertexClient.generateContent already handles that extraction (vertex.js:108)
  return vertexClient.generateContent(prompt, {
    model: 'gemini-3.1-flash-lite',
    generationConfig,
  });
}

// ---------------------------------------------------------------------------
// analyzeMcpRepository — Code.gs:1-90
// ---------------------------------------------------------------------------

/**
 * Analyze a GitHub MCP repository to determine Cloud Run provisionability.
 *
 * @param {string} repoUrl                    — GitHub repository URL
 * @param {object} deps
 * @param {object} deps.vertexClient          — { generateContent } from makeVertexClient
 * @param {Function} [deps.fetchImpl]         — fetch-compatible; defaults to global fetch
 * @param {string|null} [deps.githubToken]    — optional GitHub PAT
 * @returns {Promise<{ success: true, data: object } | { success: false, message: string }>}
 */
export async function analyzeMcpRepository(repoUrl, { vertexClient, fetchImpl = fetch, githubToken = null } = {}) {
  try {
    console.log('1. Starting GitHub repository retrieval: ' + repoUrl);
    const repoData = parseGithubUrl(repoUrl);

    const defaultBranch = await getDefaultBranch(repoData.owner, repoData.repo, fetchImpl, githubToken);

    const tree = await getRepositoryFiles(repoData.owner, repoData.repo, defaultBranch, fetchImpl, githubToken);
    const filesToLoad = [];
    const priorityFiles = ['readme.md', 'package.json', 'pyproject.toml', 'requirements.txt', '.env.example'];

    tree.forEach(item => {
      if (item.type === 'blob') {
        const lowerPath = item.path.toLowerCase();
        const baseName = lowerPath.split('/').pop();
        if (priorityFiles.includes(baseName) || baseName === 'readme' || baseName.endsWith('readme.md')) {
          filesToLoad.push(item.path);
        }
      }
    });

    const entrypointCandidates = ['main.py', 'server.py', 'app.py', 'index.js', 'index.ts', 'index.py', 'run.py'];

    // First pass: Look for obvious entrypoint files — Code.gs:24-35
    tree.forEach(item => {
      if (item.type === 'blob') {
        const lowerPath = item.path.toLowerCase();
        const baseName = lowerPath.split('/').pop();
        if (entrypointCandidates.includes(baseName) && !lowerPath.includes('test') && !lowerPath.includes('node_modules')) {
          if (!filesToLoad.includes(item.path)) {
            filesToLoad.push(item.path);
          }
        }
      }
    });

    // Second pass: Fill up to 8 source files if needed — Code.gs:37-50
    let sourceLoaded = filesToLoad.filter(p => p.endsWith('.py') || p.endsWith('.js') || p.endsWith('.ts')).length;
    for (const item of tree) {
      if (item.type === 'blob' && sourceLoaded < 8) {
        const path = item.path;
        if ((path.endsWith('.py') || path.endsWith('.ts') || path.endsWith('.js')) &&
            !path.includes('test') && !path.includes('node_modules') && !path.includes('.venv')) {
          if (!filesToLoad.includes(path)) {
            filesToLoad.push(path);
            sourceLoaded++;
          }
        }
      }
    }

    // Fallback: if tree was empty, try known paths — Code.gs:52-57
    if (filesToLoad.length === 0) {
      filesToLoad.push('README.md', 'package.json', 'pyproject.toml', 'requirements.txt', '.env.example');
      filesToLoad.push('main.py', 'server.py', 'app.py', 'src/main.py', 'src/server.py');
      const pkgName = repoData.repo.replace(/-/g, '_');
      filesToLoad.push(`${pkgName}/main.py`, `src/${pkgName}/main.py`, `src/${pkgName}/server.py`);
    }

    // Fetch file contents — Code.gs:59-65
    let combinedContent = '';
    for (const filename of filesToLoad) {
      const fileText = await fetchFileFromGithub(repoData.owner, repoData.repo, defaultBranch, filename, fetchImpl, githubToken);
      if (fileText) {
        combinedContent += `\n\n--- FILE: ${filename} ---\n${fileText}`;
      }
    }

    if (!combinedContent) {
      throw new Error('Necessary configuration files were not found in the repository.');
    }

    console.log('2. Starting analysis by Gemini...');
    const analysisResult = await callGeminiApi(combinedContent, repoUrl, { vertexClient });

    // Code.gs:74-81: parse JSON and annotate unsupported_reason with context
    const parsed = JSON.parse(analysisResult);
    if (!parsed.is_supported) {
      parsed.unsupported_reason += ' [Context len: ' + combinedContent.length + ', Head: ' + combinedContent.substring(0, 200).replace(/\n/g, ' ') + ']';
    }
    return {
      success: true,
      data: parsed,
    };

  } catch (error) {
    // Code.gs:83-89
    console.error(error);
    return {
      success: false,
      message: error.toString(),
    };
  }
}
