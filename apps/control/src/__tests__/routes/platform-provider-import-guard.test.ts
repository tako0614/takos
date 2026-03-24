import { readdirSync, readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { describe, expect, it } from 'vitest';

const controlCoreSrcRoot = resolve(import.meta.dirname, '../../../../../packages/control/core/src');
const routesRoot = resolve(controlCoreSrcRoot, '../../src/server/routes');
const forbiddenImportPatterns = [
  /application\/services\/wfp(?=['"])/,
  /application\/services\/cloudflare\//,
  /@cloudflare\/containers/,
];

function collectTypeScriptFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTypeScriptFiles(entryPath));
      continue;
    }
    if (entry.isFile() && extname(entry.name) === '.ts') {
      files.push(entryPath);
    }
  }
  return files;
}

describe('server routes provider import guard', () => {
  it('does not import cloudflare service internals or container runtime directly', () => {
    const offenders = collectTypeScriptFiles(routesRoot)
      .map((filePath) => {
        const source = readFileSync(filePath, 'utf8');
        const matches = forbiddenImportPatterns
          .filter((pattern) => pattern.test(source))
          .map((pattern) => pattern.source);
        return matches.length > 0 ? { filePath, matches } : null;
      })
      .filter((value): value is { filePath: string; matches: string[] } => value !== null);

    expect(offenders).toEqual([]);
  });
});
