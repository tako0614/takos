import { access, readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const ignoredDirs = new Set(['node_modules', 'dist', '.git', '.wrangler', 'coverage']);
const ignoredFiles = new Set(['scripts/check-boundaries.mjs']);
const checks = [
  {
    name: 'package to app source dependency',
    files: /^packages\//,
    pattern: /\bapps\/(?:control|runtime)\/src\b/g,
  },
  {
    name: 'app script/test deep package source import',
    files: /^apps\/(?:control|runtime)\/(?:(?:src\/__tests__|test|scripts)\/|src\/.*\.test\.)/,
    pattern: /\bpackages\/(?:control|runtime-service)\/src\b/g,
  },
];
const appWrapperChecks = [
  {
    appRoot: 'apps/control/src',
    pkgRoot: 'packages/control/src',
    allow: new Set([
      'index.ts',
      'web.ts',
      'worker.ts',
      'dispatch.ts',
      'runtime-host.ts',
      'executor-host.ts',
      'browser-host.ts',
      'web-node.ts',
      'worker-node.ts',
      'dispatch-node.ts',
      'runtime-host-node.ts',
      'executor-host-node.ts',
      'browser-host-node.ts',
    ]),
  },
  {
    appRoot: 'apps/runtime/src',
    pkgRoot: 'packages/runtime-service/src',
    allow: new Set(['index.ts']),
  },
];

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(fullPath);
      continue;
    }
    yield fullPath;
  }
}

function findLineNumbers(text, pattern) {
  const matches = [];
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    const line = text.slice(0, index).split('\n').length;
    matches.push(line);
  }
  return matches;
}

function isThinCompatibilityModule(text) {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith('//'))
    .filter((line) => line !== '/*' && line !== '*/')
    .filter((line) => !line.startsWith('*'));

  if (lines.length === 0) return true;

  return lines.every((line) => (
    line.startsWith('export ')
    || line.startsWith('import ')
    || line === ';'
  ));
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

const violations = [];

for await (const filePath of walk(repoRoot)) {
  const relPath = relative(repoRoot, filePath);
  if (ignoredFiles.has(relPath)) continue;
  if (relPath.endsWith('.tsbuildinfo') || relPath.endsWith('.map')) continue;
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch {
    continue;
  }
  for (const check of checks) {
    if (check.files && !check.files.test(relPath)) continue;
    const lines = findLineNumbers(text, check.pattern);
    if (lines.length === 0) continue;
    violations.push({
      check: check.name,
      path: relPath,
      lines,
    });
  }
}

for (const check of appWrapperChecks) {
  const appRoot = resolve(repoRoot, check.appRoot);
  const pkgRoot = resolve(repoRoot, check.pkgRoot);

  for await (const filePath of walk(appRoot)) {
    const relPathFromApp = relative(appRoot, filePath);
    if (check.allow.has(relPathFromApp)) continue;
    if (!filePath.endsWith('.ts') && !filePath.endsWith('.mjs')) continue;

    const pkgPath = resolve(pkgRoot, relPathFromApp);
    if (!(await exists(pkgPath))) continue;

    let text;
    try {
      text = await readFile(filePath, 'utf8');
    } catch {
      continue;
    }

    violations.push({
      check: isThinCompatibilityModule(text)
        ? 'disallowed app compatibility module'
        : 'app source duplication',
      path: relative(repoRoot, filePath),
      lines: [1],
    });
  }
}

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(`${violation.check}: ${violation.path}:${violation.lines.join(',')}`);
  }
  Deno.exit(1);
}

console.log('Boundary check passed');
