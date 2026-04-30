#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(new URL('..', import.meta.url).pathname);
const checkMode = process.argv.includes('--check');
const expectedSubmodules = {
  agent: 'https://github.com/tako0614/takos-agent.git',
  app: 'https://github.com/tako0614/takos-app.git',
  git: 'https://github.com/tako0614/takos-git.git',
  paas: 'https://github.com/tako0614/takos-paas.git',
};
const expectedServices = [
  'postgres',
  'postgres-init',
  'redis',
  'takos-app',
  'takos-git',
  'takos-paas',
  'takos-agent',
];
const expectedPortMarkers = [
  '${TAKOS_APP_PORT:-8787}',
  '${TAKOS_PAAS_PORT:-8788}',
  '${TAKOS_AGENT_PORT:-8789}',
  '${TAKOS_GIT_PORT:-8790}',
  '${TAKOS_POSTGRES_PORT:-15432}',
  '${TAKOS_REDIS_PORT:-16379}',
];
const expectedInternalUrlMarkers = [
  'TAKOS_GIT_INTERNAL_URL',
  'TAKOS_PAAS_INTERNAL_URL',
  'TAKOS_INTERNAL_SERVICE_SECRET',
];
const forbiddenSurfacePatterns = [
  {
    name: 'standalone takos-deploy service',
    pattern: /\btakos-deploy\b/g,
  },
  {
    name: 'standalone takos-runtime service',
    pattern: /\btakos-runtime\b/g,
  },
  {
    name: 'legacy deploy env',
    pattern: /\bTAKOS_DEPLOY_[A-Z0-9_]*\b/g,
  },
  {
    name: 'shell deploy implementation mount',
    pattern: /(^|["'\s])\.\/deploy(?:["'\s:]|$)/g,
  },
  {
    name: 'shell runtime implementation mount',
    pattern: /(^|["'\s])\.\/runtime(?:["'\s:]|$)/g,
  },
];
const surfaceFiles = [
  'README.md',
  'AGENTS.md',
  'compose.local.yml',
  'deno.json',
  '.env.local.example',
];

const results = [];

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function pass(name, detail = '') {
  results.push({ status: 'pass', name, detail });
}

function warn(name, detail = '') {
  results.push({ status: 'warn', name, detail });
}

function fail(name, detail = '') {
  results.push({ status: 'fail', name, detail });
}

function checkTool(name, args, displayName = name) {
  const result = run(name, args);
  if (result.status === 0) {
    const version = (result.stdout || result.stderr).split('\n').find(Boolean) ?? 'available';
    pass(`${displayName} available`, version.trim());
    return true;
  }
  fail(`${displayName} available`, (result.stderr || result.stdout || 'not found').trim());
  return false;
}

function parseGitmodules() {
  const text = readFileSync(join(root, '.gitmodules'), 'utf8');
  const modules = new Map();
  let current;
  for (const line of text.split('\n')) {
    const header = line.match(/^\[submodule "(.+)"\]$/);
    if (header) {
      current = { name: header[1] };
      modules.set(current.name, current);
      continue;
    }
    if (!current) continue;
    const pair = line.match(/^\s*(path|url)\s*=\s*(.+)\s*$/);
    if (pair) current[pair[1]] = pair[2];
  }
  return modules;
}

function checkSubmodules() {
  const modules = parseGitmodules();
  const status = run('git', ['submodule', 'status', '--recursive']);
  const statusByPath = new Map();
  if (status.status === 0) {
    for (const line of status.stdout.trim().split('\n').filter(Boolean)) {
      const prefix = line[0];
      const parts = line.slice(1).trim().split(/\s+/);
      statusByPath.set(parts[1], { prefix, commit: parts[0] });
    }
  }

  for (const [path, expectedUrl] of Object.entries(expectedSubmodules)) {
    const module = [...modules.values()].find((entry) => entry.path === path);
    if (!module) {
      fail(`submodule ${path} declared`, 'missing from .gitmodules');
      continue;
    }
    if (module.url !== expectedUrl) {
      fail(`submodule ${path} remote`, `${module.url} (expected ${expectedUrl})`);
    } else {
      pass(`submodule ${path} remote`, module.url);
    }

    const modulePath = join(root, path);
    if (!existsSync(modulePath)) {
      fail(`submodule ${path} initialized`, 'path is missing');
      continue;
    }
    const gitCheck = run('git', ['-C', modulePath, 'rev-parse', '--is-inside-work-tree']);
    const submoduleState = statusByPath.get(path);
    if (gitCheck.status !== 0 || submoduleState?.prefix === '-') {
      fail(`submodule ${path} initialized`, 'run deno task submodules:update');
      continue;
    }
    if (submoduleState?.prefix === '+') {
      warn(`submodule ${path} pointer`, 'checkout differs from recorded commit');
    } else {
      pass(`submodule ${path} initialized`, submoduleState?.commit ?? 'ok');
    }
  }
}

function serviceNamesFromComposeText(text) {
  const names = [];
  let inServices = false;
  for (const line of text.split('\n')) {
    if (/^services:\s*$/.test(line)) {
      inServices = true;
      continue;
    }
    if (inServices && /^[a-zA-Z0-9_-]+:\s*$/.test(line)) break;
    const match = inServices ? line.match(/^  ([a-zA-Z0-9_-]+):\s*$/) : undefined;
    if (match) names.push(match[1]);
  }
  return names;
}

function checkCompose(dockerComposeAvailable) {
  const composePath = join(root, 'compose.local.yml');
  if (!existsSync(composePath)) {
    fail('compose.local.yml present', 'missing');
    return;
  }
  const text = readFileSync(composePath, 'utf8');
  pass('compose.local.yml present', relative(root, composePath));

  const staticServices = serviceNamesFromComposeText(text);
  const extraServices = staticServices.filter((name) => !expectedServices.includes(name));
  const missingServices = expectedServices.filter((name) => !staticServices.includes(name));
  if (extraServices.length || missingServices.length) {
    fail(
      'compose service set',
      `missing=[${missingServices.join(', ')}] extra=[${extraServices.join(', ')}]`,
    );
  } else {
    pass('compose service set', expectedServices.join(', '));
  }

  if (dockerComposeAvailable) {
    const config = run('docker', [
      'compose',
      '--env-file',
      '.env.local.example',
      '-f',
      'compose.local.yml',
      'config',
      '--services',
    ]);
    if (config.status === 0) {
      const resolved = config.stdout.trim().split('\n').filter(Boolean).sort();
      const expected = [...expectedServices].sort();
      if (JSON.stringify(resolved) === JSON.stringify(expected)) {
        pass('docker compose config --services', resolved.join(', '));
      } else {
        fail('docker compose config --services', `got=[${resolved.join(', ')}] expected=[${expected.join(', ')}]`);
      }
    } else {
      fail('docker compose config --services', (config.stderr || config.stdout).trim());
    }
  }

  for (const marker of expectedPortMarkers) {
    if (text.includes(marker)) pass(`compose port marker ${marker}`);
    else fail(`compose port marker ${marker}`, 'missing');
  }
  for (const marker of expectedInternalUrlMarkers) {
    if (text.includes(marker)) pass(`compose env marker ${marker}`);
    else fail(`compose env marker ${marker}`, 'missing');
  }
}

function walkFiles(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'dist', 'target', '.vitepress'].includes(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    if (relative(root, fullPath) === 'scripts/doctor.mjs') continue;
    if (entry.isDirectory()) {
      walkFiles(fullPath, files);
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

function checkForbiddenSurface() {
  const files = [
    ...surfaceFiles.map((file) => join(root, file)).filter(existsSync),
    ...(existsSync(join(root, 'scripts')) ? walkFiles(join(root, 'scripts')) : []),
  ];
  let violationCount = 0;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const rel = relative(root, file);
    for (const check of forbiddenSurfacePatterns) {
      for (const match of text.matchAll(check.pattern)) {
        violationCount += 1;
        const line = text.slice(0, match.index ?? 0).split('\n').length;
        fail(`forbidden ${check.name}`, `${rel}:${line}`);
      }
    }
  }
  if (violationCount === 0) pass('forbidden shell names absent', 'current shell surface');
}

function checkDocs() {
  const requiredDocs = [
    'docs/architecture/service-topology.md',
    'docs/get-started/local-shell.md',
    'docs/reference/component-matrix.md',
  ];
  for (const doc of requiredDocs) {
    if (existsSync(join(root, doc))) pass(`doc ${doc}`);
    else fail(`doc ${doc}`, 'missing');
  }
}

function printResults() {
  const icons = { pass: 'ok', warn: 'warn', fail: 'fail' };
  for (const result of results) {
    const detail = result.detail ? ` - ${result.detail}` : '';
    console.log(`${icons[result.status]} ${result.name}${detail}`);
  }
  const summary = {
    pass: results.filter((result) => result.status === 'pass').length,
    warn: results.filter((result) => result.status === 'warn').length,
    fail: results.filter((result) => result.status === 'fail').length,
  };
  console.log(`\nsummary: ${summary.pass} passed, ${summary.warn} warnings, ${summary.fail} failed`);
  if (summary.fail > 0 && checkMode) process.exitCode = 1;
}

const gitAvailable = checkTool('git', ['--version']);
checkTool('deno', ['--version']);
const dockerComposeAvailable = checkTool('docker', ['compose', 'version'], 'docker compose');

if (gitAvailable) checkSubmodules();
checkCompose(dockerComposeAvailable);
checkForbiddenSurface();
checkDocs();
printResults();
