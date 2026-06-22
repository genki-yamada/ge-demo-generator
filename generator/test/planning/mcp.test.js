import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeMcpRepository, parseGithubUrl } from '../../src/planning/mcp.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal fetch stub that maps URL → response shape */
function makeFetchStub(urlMap) {
  return vi.fn(async (url, _opts) => {
    for (const [pattern, res] of urlMap) {
      if (url.includes(pattern)) return res;
    }
    // Not found → 404
    return { ok: false, status: 404, text: async () => 'Not Found', json: async () => ({}) };
  });
}

function jsonResponse(obj) {
  const text = JSON.stringify(obj);
  return { ok: true, status: 200, text: async () => text, json: async () => obj };
}

function textResponse(str) {
  return { ok: true, status: 200, text: async () => str, json: async () => { throw new Error('not json'); } };
}

function errorResponse(status = 500) {
  return { ok: false, status, text: async () => 'error', json: async () => ({}) };
}

/** Canned Gemini analysis result (from callGeminiApi) */
const CANNED_ANALYSIS = {
  is_supported: true,
  unsupported_reason: '',
  language: 'nodejs',
  entrypoint: 'node dist/index.js',
  transport_mode: 'stdio',
  required_env_vars: [{ key: 'API_KEY', description: 'API key', is_secret: true, is_required: true }],
  capabilities: ['Do things'],
  npm_ignore_scripts: false,
  degraded_tools: [],
  credential_file: null,
};

/** Make a vertexClient stub that returns canned analysis JSON */
function makeVertexStub(responseObj = CANNED_ANALYSIS) {
  return { generateContent: vi.fn(async () => JSON.stringify(responseObj)) };
}

/** A simple tree for getRepositoryFiles */
const SIMPLE_TREE = [
  { type: 'blob', path: 'README.md' },
  { type: 'blob', path: 'package.json' },
  { type: 'blob', path: 'src/index.ts' },
  { type: 'tree', path: 'src' }, // should be ignored (not blob)
];

const REPO_METADATA = { default_branch: 'main' };

// ---------------------------------------------------------------------------
// parseGithubUrl
// ---------------------------------------------------------------------------

describe('parseGithubUrl', () => {
  it('parses plain owner/repo', () => {
    expect(parseGithubUrl('https://github.com/owner/myrepo')).toEqual({ owner: 'owner', repo: 'myrepo' });
  });

  it('strips .git suffix', () => {
    expect(parseGithubUrl('https://github.com/owner/myrepo.git')).toEqual({ owner: 'owner', repo: 'myrepo' });
  });

  it('handles subpath (takes first two segments)', () => {
    const result = parseGithubUrl('https://github.com/owner/myrepo/tree/main/src');
    // match[1]=owner, match[2]=myrepo (stops at first /)
    expect(result.owner).toBe('owner');
    expect(result.repo).toBe('myrepo');
  });

  it('handles SSH-style URLs via github.com path', () => {
    expect(parseGithubUrl('git@github.com:owner/myrepo.git')).toEqual({ owner: 'owner', repo: 'myrepo' });
  });

  it('throws on invalid URL (source line 94)', () => {
    expect(() => parseGithubUrl('https://example.com/notgithub')).toThrow('Invalid GitHub URL');
  });
});

// ---------------------------------------------------------------------------
// GitHub header / URL behavior
// ---------------------------------------------------------------------------

describe('GitHub headers and URLs', () => {
  const owner = 'myorg';
  const repo = 'myrepo';

  it('uses Authorization: token <token> when githubToken provided', async () => {
    const fetchStub = vi.fn(async (url) => {
      if (url.includes('/repos/myorg/myrepo') && !url.includes('trees') && !url.includes('raw')) {
        return jsonResponse(REPO_METADATA);
      }
      if (url.includes('/git/trees/')) return jsonResponse({ tree: [] });
      return errorResponse(404);
    });
    const vertexStub = makeVertexStub();

    // Should fail with empty combinedContent, but we can check headers via the fetch calls
    const result = await analyzeMcpRepository('https://github.com/myorg/myrepo', {
      vertexClient: vertexStub,
      fetchImpl: fetchStub,
      githubToken: 'mytoken123',
    });

    // All fetch calls should have Authorization: token mytoken123
    for (const [, init] of fetchStub.mock.calls) {
      expect(init?.headers?.['Authorization']).toBe('token mytoken123');
    }
  });

  it('sends no Authorization header when githubToken is null', async () => {
    const fetchStub = vi.fn(async (url) => {
      if (url.includes('/repos/myorg/myrepo') && !url.includes('trees')) return jsonResponse(REPO_METADATA);
      if (url.includes('/git/trees/')) return jsonResponse({ tree: [] });
      return errorResponse(404);
    });
    const vertexStub = makeVertexStub();

    await analyzeMcpRepository('https://github.com/myorg/myrepo', {
      vertexClient: vertexStub,
      fetchImpl: fetchStub,
      githubToken: null,
    });

    for (const [, init] of fetchStub.mock.calls) {
      expect(init?.headers?.['Authorization']).toBeUndefined();
    }
  });

  it('calls getDefaultBranch at correct URL (source line 122)', async () => {
    const fetchStub = vi.fn(async (url) => {
      if (url === `https://api.github.com/repos/${owner}/${repo}`) return jsonResponse(REPO_METADATA);
      if (url.includes('/git/trees/')) return jsonResponse({ tree: [] });
      return errorResponse(404);
    });

    await analyzeMcpRepository(`https://github.com/${owner}/${repo}`, {
      vertexClient: makeVertexStub(),
      fetchImpl: fetchStub,
    });

    const urls = fetchStub.mock.calls.map(([url]) => url);
    expect(urls).toContain(`https://api.github.com/repos/${owner}/${repo}`);
  });

  it('calls getRepositoryFiles with recursive tree URL (source line 107)', async () => {
    const fetchStub = vi.fn(async (url) => {
      if (url === `https://api.github.com/repos/${owner}/${repo}`) return jsonResponse(REPO_METADATA);
      if (url.includes('/git/trees/main?recursive=1')) return jsonResponse({ tree: [] });
      return errorResponse(404);
    });

    await analyzeMcpRepository(`https://github.com/${owner}/${repo}`, {
      vertexClient: makeVertexStub(),
      fetchImpl: fetchStub,
    });

    const urls = fetchStub.mock.calls.map(([url]) => url);
    expect(urls.some(u => u.includes('/git/trees/main?recursive=1'))).toBe(true);
  });

  it('fetches raw files from raw.githubusercontent.com (source line 139)', async () => {
    const tree = [{ type: 'blob', path: 'README.md' }];
    const fetchStub = vi.fn(async (url) => {
      if (url === `https://api.github.com/repos/${owner}/${repo}`) return jsonResponse(REPO_METADATA);
      if (url.includes('/git/trees/main?recursive=1')) return jsonResponse({ tree });
      if (url.startsWith('https://raw.githubusercontent.com/')) return textResponse('# Hello');
      return errorResponse(404);
    });

    await analyzeMcpRepository(`https://github.com/${owner}/${repo}`, {
      vertexClient: makeVertexStub(),
      fetchImpl: fetchStub,
    });

    const rawCalls = fetchStub.mock.calls.filter(([url]) => url.startsWith('https://raw.githubusercontent.com/'));
    expect(rawCalls.length).toBeGreaterThan(0);
    // URL pattern: https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}
    expect(rawCalls[0][0]).toMatch(/https:\/\/raw\.githubusercontent\.com\/myorg\/myrepo\/[^/]+\/README\.md/);
  });

  it('tries fallback branches for fetchFileFromGithub (source line 137)', async () => {
    const tree = [{ type: 'blob', path: 'README.md' }];
    let callCount = 0;
    const fetchStub = vi.fn(async (url) => {
      if (url === `https://api.github.com/repos/${owner}/${repo}`) return jsonResponse({ default_branch: 'develop' });
      if (url.includes('/git/trees/develop?recursive=1')) return jsonResponse({ tree });
      if (url.startsWith('https://raw.githubusercontent.com/')) {
        callCount++;
        // First call (develop branch) fails, second (main) succeeds
        if (callCount === 1) return errorResponse(404);
        return textResponse('# content');
      }
      return errorResponse(404);
    });

    await analyzeMcpRepository(`https://github.com/${owner}/${repo}`, {
      vertexClient: makeVertexStub(),
      fetchImpl: fetchStub,
    });

    const rawCalls = fetchStub.mock.calls.filter(([url]) => url.startsWith('https://raw.githubusercontent.com/'));
    // Should have tried at least develop + main
    expect(rawCalls.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// analyzeMcpRepository — full integration with stubs
// ---------------------------------------------------------------------------

describe('analyzeMcpRepository', () => {
  let fetchStub;
  let vertexStub;

  beforeEach(() => {
    const tree = [
      { type: 'blob', path: 'README.md' },
      { type: 'blob', path: 'package.json' },
      { type: 'blob', path: 'src/index.ts' },
    ];
    fetchStub = vi.fn(async (url) => {
      if (url === 'https://api.github.com/repos/myorg/myrepo') return jsonResponse(REPO_METADATA);
      if (url.includes('/git/trees/main?recursive=1')) return jsonResponse({ tree });
      if (url.startsWith('https://raw.githubusercontent.com/')) return textResponse('file content here');
      return errorResponse(404);
    });
    vertexStub = makeVertexStub();
  });

  it('returns { success: true, data: <parsed JSON> } on happy path', async () => {
    const result = await analyzeMcpRepository('https://github.com/myorg/myrepo', {
      vertexClient: vertexStub,
      fetchImpl: fetchStub,
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      is_supported: true,
      language: 'nodejs',
      entrypoint: 'node dist/index.js',
      transport_mode: 'stdio',
    });
  });

  it('calls vertexClient.generateContent with model gemini-3.1-flash-lite', async () => {
    await analyzeMcpRepository('https://github.com/myorg/myrepo', {
      vertexClient: vertexStub,
      fetchImpl: fetchStub,
    });

    expect(vertexStub.generateContent).toHaveBeenCalledOnce();
    const [, opts] = vertexStub.generateContent.mock.calls[0];
    expect(opts.model).toBe('gemini-3.1-flash-lite');
  });

  it('includes responseMimeType and responseSchema in generationConfig', async () => {
    await analyzeMcpRepository('https://github.com/myorg/myrepo', {
      vertexClient: vertexStub,
      fetchImpl: fetchStub,
    });

    const [, opts] = vertexStub.generateContent.mock.calls[0];
    expect(opts.generationConfig.responseMimeType).toBe('application/json');
    expect(opts.generationConfig.responseSchema).toBeDefined();
    const schema = opts.generationConfig.responseSchema;
    expect(schema.type).toBe('OBJECT');
    expect(schema.properties.is_supported).toBeDefined();
    expect(schema.properties.language).toBeDefined();
    expect(schema.properties.entrypoint).toBeDefined();
    expect(schema.properties.required_env_vars).toBeDefined();
    expect(schema.required).toContain('is_supported');
    expect(schema.required).toContain('language');
  });

  it('prompt includes <REPOSITORY_CONTEXT> with combinedContent (source line 222)', async () => {
    await analyzeMcpRepository('https://github.com/myorg/myrepo', {
      vertexClient: vertexStub,
      fetchImpl: fetchStub,
    });

    const [prompt] = vertexStub.generateContent.mock.calls[0];
    expect(prompt).toContain('<REPOSITORY_CONTEXT>');
    expect(prompt).toContain('</REPOSITORY_CONTEXT>');
    expect(prompt).toContain('file content here');
  });

  it('prompt includes key MCP analysis language (source lines 163-225)', async () => {
    await analyzeMcpRepository('https://github.com/myorg/myrepo', {
      vertexClient: vertexStub,
      fetchImpl: fetchStub,
    });

    const [prompt] = vertexStub.generateContent.mock.calls[0];
    expect(prompt).toContain('MCP Servers');
    expect(prompt).toContain('Cloud Run');
    expect(prompt).toContain('is_supported');
    expect(prompt).toContain('entrypoint');
    expect(prompt).toContain('FastMCP');
  });

  it('combinedContent uses FILE: separator format (source line 63)', async () => {
    await analyzeMcpRepository('https://github.com/myorg/myrepo', {
      vertexClient: vertexStub,
      fetchImpl: fetchStub,
    });

    const [prompt] = vertexStub.generateContent.mock.calls[0];
    // Each file should appear as --- FILE: <path> ---
    expect(prompt).toMatch(/--- FILE: README\.md ---/);
  });

  it('appends context info to unsupported_reason when is_supported is false (source line 76)', async () => {
    const unsupportedResult = { ...CANNED_ANALYSIS, is_supported: false, unsupported_reason: 'Not supported' };
    const v = makeVertexStub(unsupportedResult);

    const result = await analyzeMcpRepository('https://github.com/myorg/myrepo', {
      vertexClient: v,
      fetchImpl: fetchStub,
    });

    expect(result.success).toBe(true);
    expect(result.data.unsupported_reason).toContain('[Context len:');
    expect(result.data.unsupported_reason).toContain('Head:');
  });

  it('returns { success: false, message } when no files fetched (source line 83-89)', async () => {
    const emptyFetch = vi.fn(async (url) => {
      if (url.includes('/repos/myorg/myrepo') && !url.includes('trees')) return jsonResponse(REPO_METADATA);
      if (url.includes('/git/trees/')) return jsonResponse({ tree: [] });
      // All raw fetches fail
      return errorResponse(404);
    });

    const result = await analyzeMcpRepository('https://github.com/myorg/myrepo', {
      vertexClient: vertexStub,
      fetchImpl: emptyFetch,
    });

    expect(result.success).toBe(false);
    expect(typeof result.message).toBe('string');
  });

  it('returns { success: false, message } on GitHub fetch error', async () => {
    const result = await analyzeMcpRepository('https://github.com/INVALID_URL_NO_GITHUB', {
      vertexClient: vertexStub,
      fetchImpl: fetchStub,
    });

    expect(result.success).toBe(false);
    expect(typeof result.message).toBe('string');
  });

  it('returns { success: false, message } when vertexClient throws', async () => {
    const throwingVertex = { generateContent: vi.fn(async () => { throw new Error('LLM error'); }) };

    const result = await analyzeMcpRepository('https://github.com/myorg/myrepo', {
      vertexClient: throwingVertex,
      fetchImpl: fetchStub,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('LLM error');
  });

  it('collects priority files: readme.md, package.json, etc. (source line 10)', async () => {
    const tree = [
      { type: 'blob', path: 'README.md' },
      { type: 'blob', path: 'package.json' },
      { type: 'blob', path: 'pyproject.toml' },
      { type: 'blob', path: 'requirements.txt' },
      { type: 'blob', path: '.env.example' },
      { type: 'blob', path: 'src/helper.ts' }, // not priority
    ];
    const localFetch = vi.fn(async (url) => {
      if (url.includes('/repos/myorg/myrepo') && !url.includes('trees')) return jsonResponse(REPO_METADATA);
      if (url.includes('/git/trees/')) return jsonResponse({ tree });
      if (url.startsWith('https://raw.githubusercontent.com/')) return textResponse('content');
      return errorResponse(404);
    });

    await analyzeMcpRepository('https://github.com/myorg/myrepo', {
      vertexClient: vertexStub,
      fetchImpl: localFetch,
    });

    const rawCalls = localFetch.mock.calls
      .filter(([url]) => url.startsWith('https://raw.githubusercontent.com/'))
      .map(([url]) => url);

    // All priority files should have been fetched
    expect(rawCalls.some(u => u.includes('README.md'))).toBe(true);
    expect(rawCalls.some(u => u.includes('package.json'))).toBe(true);
    expect(rawCalls.some(u => u.includes('pyproject.toml'))).toBe(true);
    expect(rawCalls.some(u => u.includes('requirements.txt'))).toBe(true);
    expect(rawCalls.some(u => u.includes('.env.example'))).toBe(true);
  });

  it('collects entrypoint candidates: index.js, main.py, etc. (source line 22)', async () => {
    const tree = [
      { type: 'blob', path: 'README.md' },
      { type: 'blob', path: 'index.js' },
      { type: 'blob', path: 'main.py' },
    ];
    const localFetch = vi.fn(async (url) => {
      if (url.includes('/repos/myorg/myrepo') && !url.includes('trees')) return jsonResponse(REPO_METADATA);
      if (url.includes('/git/trees/')) return jsonResponse({ tree });
      if (url.startsWith('https://raw.githubusercontent.com/')) return textResponse('content');
      return errorResponse(404);
    });

    await analyzeMcpRepository('https://github.com/myorg/myrepo', {
      vertexClient: vertexStub,
      fetchImpl: localFetch,
    });

    const rawCalls = localFetch.mock.calls
      .filter(([url]) => url.startsWith('https://raw.githubusercontent.com/'))
      .map(([url]) => url);

    expect(rawCalls.some(u => u.includes('index.js'))).toBe(true);
    expect(rawCalls.some(u => u.includes('main.py'))).toBe(true);
  });

  it('skips test and node_modules files for entrypoint candidates (source line 29)', async () => {
    const tree = [
      { type: 'blob', path: 'README.md' },
      { type: 'blob', path: 'test/index.js' }, // should be skipped
      { type: 'blob', path: 'node_modules/lib/index.js' }, // should be skipped
      { type: 'blob', path: 'src/index.js' }, // should be included
    ];
    const localFetch = vi.fn(async (url) => {
      if (url.includes('/repos/myorg/myrepo') && !url.includes('trees')) return jsonResponse(REPO_METADATA);
      if (url.includes('/git/trees/')) return jsonResponse({ tree });
      if (url.startsWith('https://raw.githubusercontent.com/')) return textResponse('content');
      return errorResponse(404);
    });

    await analyzeMcpRepository('https://github.com/myorg/myrepo', {
      vertexClient: vertexStub,
      fetchImpl: localFetch,
    });

    const rawCalls = localFetch.mock.calls
      .filter(([url]) => url.startsWith('https://raw.githubusercontent.com/'))
      .map(([url]) => url);

    expect(rawCalls.every(u => !u.includes('node_modules'))).toBe(true);
    expect(rawCalls.some(u => u.includes('src/index.js'))).toBe(true);
  });
});
