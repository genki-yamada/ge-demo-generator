import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// Guard: skip the whole suite if bash is not available
let bashAvailable = false;
try {
  execFileSync('bash', ['-c', 'echo ok'], { encoding: 'utf8' });
  bashAvailable = true;
} catch {
  bashAvailable = false;
}

// Convert a Windows absolute path (C:\...) to bash/POSIX form (/c/...)
// On non-Windows platforms this is a no-op.
function toBashPath(p) {
  // Replace path separators with / then handle drive letter
  return p.split(path.sep).join('/').replace(/^([A-Za-z]):/, (_m, d) => '/' + d.toLowerCase());
}

// Resolve entrypoint path: from this test file go up to generator root then into provisioner/
const thisFile = new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1');
const ENTRYPOINT = toBashPath(
  path.resolve(path.dirname(thisFile), '../../provisioner/entrypoint.sh'),
);

const describeFn = bashAvailable ? describe : describe.skip;

describeFn('provisioner/entrypoint.sh', () => {
  let tmpRoot;
  let homeDir;
  let binDir;

  beforeEach(() => {
    tmpRoot = path.join(os.tmpdir(), `ep-test-${crypto.randomBytes(6).toString('hex')}`);
    homeDir = path.join(tmpRoot, 'home');
    binDir = path.join(tmpRoot, 'bin');
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });

    // Write stub gsutil: implements `gsutil cp SRC DST` as a plain file copy
    const gsutilStub = path.join(binDir, 'gsutil');
    fs.writeFileSync(
      gsutilStub,
      ['#!/bin/sh', 'if [ "$1" = "cp" ]; then', '  cp "$2" "$3"', 'fi'].join('\n') + '\n',
    );
    fs.chmodSync(gsutilStub, 0o755);
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  /**
   * Run entrypoint.sh with the given args and env overrides.
   * Returns { status, stdout, stderr }.
   */
  function runEntrypoint(args, envOverrides = {}) {
    const bashBinDir = toBashPath(binDir);
    const bashHomeDir = toBashPath(homeDir);

    // Translate any env override values that look like absolute Windows paths
    const translatedEnv = {};
    for (const [k, v] of Object.entries(envOverrides)) {
      translatedEnv[k] = typeof v === 'string' ? toBashPath(v) : v;
    }

    const result = spawnSync('bash', [ENTRYPOINT, ...args], {
      encoding: 'utf8',
      env: {
        PATH: `${bashBinDir}:${process.env.PATH || '/usr/bin:/bin'}`,
        HOME: bashHomeDir,
        ...translatedEnv,
      },
    });
    return {
      status: result.status ?? 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  }

  /**
   * Write a run.sh script to tmpRoot and return its path (for use as SCRIPT_REF).
   * The script content uses $HOME and bash-style paths.
   */
  function writeRunScript(name, content) {
    const scriptPath = path.join(tmpRoot, name);
    fs.writeFileSync(scriptPath, content);
    fs.chmodSync(scriptPath, 0o755);
    return scriptPath; // stub gsutil does plain cp, so local paths work as SCRIPT_REF
  }

  // ---------------------------------------------------------------------------
  // Scenario 1: BUILD persists AGENT_ENGINE_NAME only
  // ---------------------------------------------------------------------------
  it('BUILD: persists only AGENT_ENGINE_NAME line to ENV_REF', () => {
    const demoDir = 'demo-retail-acme';
    const envRefPath = path.join(tmpRoot, 'persisted.env');

    // run.sh creates a .env with two lines then exits 0
    const scriptRef = writeRunScript(
      'run_build.sh',
      [
        '#!/bin/sh',
        `mkdir -p "$HOME/${demoDir}"`,
        // Use printf for reliable quoting on all sh variants
        `printf 'AGENT_ENGINE_NAME="projects/p/locations/us-central1/reasoningEngines/123"\\nSANDBOX_RESOURCE_NAME="x"\\n' > "$HOME/${demoDir}/.env"`,
        'exit 0',
      ].join('\n') + '\n',
    );

    const { status } = runEntrypoint([], {
      SCRIPT_REF: scriptRef,
      DEMO_DIR: demoDir,
      ENV_REF: envRefPath,
    });

    expect(status).toBe(0);
    expect(fs.existsSync(envRefPath)).toBe(true);

    const persisted = fs.readFileSync(envRefPath, 'utf8');
    expect(persisted).toContain('AGENT_ENGINE_NAME=');
    expect(persisted).not.toContain('SANDBOX_RESOURCE_NAME');
  });

  // ---------------------------------------------------------------------------
  // Scenario 2: CLEANUP restores .env before run.sh executes
  // ---------------------------------------------------------------------------
  it('CLEANUP: restores .env from ENV_REF before running script', () => {
    const demoDir = 'demo-retail-acme';
    const envRefPath = path.join(tmpRoot, 'persisted.env');
    const markerPath = path.join(tmpRoot, 'marker.txt');

    // Pre-create the persisted env file
    fs.writeFileSync(
      envRefPath,
      'AGENT_ENGINE_NAME="projects/p/locations/us-central1/reasoningEngines/123"\n',
    );

    const bashMarkerPath = toBashPath(markerPath);

    // run.sh (cleanup mode) copies the restored .env to a marker file, proving restoration happened
    const scriptRef = writeRunScript(
      'run_cleanup.sh',
      [
        '#!/bin/sh',
        `cp "$HOME/${demoDir}/.env" "${bashMarkerPath}" 2>/dev/null || echo "no env" > "${bashMarkerPath}"`,
        'exit 0',
      ].join('\n') + '\n',
    );

    const { status } = runEntrypoint(['--cleanup'], {
      SCRIPT_REF: scriptRef,
      DEMO_DIR: demoDir,
      ENV_REF: envRefPath,
    });

    expect(status).toBe(0);
    expect(fs.existsSync(markerPath)).toBe(true);

    const markerContent = fs.readFileSync(markerPath, 'utf8');
    expect(markerContent).toContain('AGENT_ENGINE_NAME=');
  });

  // ---------------------------------------------------------------------------
  // Scenario 3: BUILD failure — exit code propagated, ENV_REF NOT created
  // ---------------------------------------------------------------------------
  it('BUILD failure: propagates exit code 3 and does not create ENV_REF', () => {
    const demoDir = 'demo-retail-acme';
    const envRefPath = path.join(tmpRoot, 'persisted.env');

    // run.sh deliberately exits non-zero without writing .env
    const scriptRef = writeRunScript(
      'run_fail.sh',
      ['#!/bin/sh', '# no .env written', 'exit 3'].join('\n') + '\n',
    );

    const { status } = runEntrypoint([], {
      SCRIPT_REF: scriptRef,
      DEMO_DIR: demoDir,
      ENV_REF: envRefPath,
    });

    expect(status).toBe(3);
    expect(fs.existsSync(envRefPath)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Scenario 4: CLEANUP — missing persisted env file is tolerated (no abort)
  // ---------------------------------------------------------------------------
  it('CLEANUP: missing ENV_REF file is tolerated and run.sh still exits 0', () => {
    const demoDir = 'demo-retail-acme';
    const envRefPath = path.join(tmpRoot, 'nonexistent.env');
    // Do NOT create envRefPath — simulates no persisted file

    const scriptRef = writeRunScript(
      'run_cleanup_noenv.sh',
      ['#!/bin/sh', 'exit 0'].join('\n') + '\n',
    );

    const { status } = runEntrypoint(['--cleanup'], {
      SCRIPT_REF: scriptRef,
      DEMO_DIR: demoDir,
      ENV_REF: envRefPath,
    });

    expect(status).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Scenario 5: Backward-compat — no ENV_REF / no DEMO_DIR set
  // ---------------------------------------------------------------------------
  it('BACKWARD-COMPAT: no ENV_REF/DEMO_DIR set, build exits 0, no extra env files created', () => {
    const scriptRef = writeRunScript(
      'run_compat.sh',
      ['#!/bin/sh', 'exit 0'].join('\n') + '\n',
    );

    const { status } = runEntrypoint([], {
      SCRIPT_REF: scriptRef,
      // ENV_REF and DEMO_DIR intentionally omitted
    });

    expect(status).toBe(0);
    // No .env files should have been created in tmpRoot
    const files = fs.readdirSync(tmpRoot);
    const unexpectedEnvFiles = files.filter(f => f.endsWith('.env'));
    expect(unexpectedEnvFiles).toHaveLength(0);
  });
});
