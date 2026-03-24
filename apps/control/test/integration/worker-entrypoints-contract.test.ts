import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '../..');

function read(relativePath: string): string {
  return readFileSync(path.join(rootDir, relativePath), 'utf8');
}

describe('worker entrypoint contract', () => {
  it('routes every first-party worker through the runtime app entrypoints', () => {
    const cases = [
      ['wrangler.toml', 'src/web.ts'],
      ['wrangler.dispatch.toml', 'src/dispatch.ts'],
      ['wrangler.worker.toml', 'src/worker.ts'],
      ['wrangler.runtime-host.toml', 'src/runtime-host.ts'],
      ['wrangler.executor.toml', 'src/executor-host.ts'],
      ['wrangler.browser-host.toml', 'src/browser-host.ts'],
    ] as const;

    for (const [configPath, expectedMain] of cases) {
      const contents = read(configPath);
      expect(contents).toContain(`main = "${expectedMain}"`);
    }
  });

  it('does not require markdown module rules on Cloudflare worker configs', () => {
    const markdownConfigs = [
      'wrangler.toml',
      'wrangler.worker.toml',
      'wrangler.executor.toml',
    ] as const;

    for (const configPath of markdownConfigs) {
      const contents = read(configPath);
      expect(contents).not.toContain('type = "Text"');
      expect(contents).not.toContain('globs = ["**/*.md"]');
    }
  });
});
