import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readTranslationSource(lang: 'ja' | 'en'): string {
  const dir = resolve(__dirname, `../../web/src/i18n/${lang}`);
  const partials = readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => readFileSync(resolve(dir, f), 'utf8'));
  return partials.join('\n');
}

function extractTranslation(source: string, key: string): string | null {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escapedKey}:\\s*['"]([^'"]+)['"]`));
  return match?.[1] ?? null;
}

describe('i18n regression (issue 090)', () => {
  const criticalKeys = ['skillsEmptyHint', 'tasksEmptyHint', 'workspaceSlug'] as const;
  const ja = readTranslationSource('ja');
  const en = readTranslationSource('en');

  for (const key of criticalKeys) {
    it(`resolves ${key} in ja/en without returning raw key`, () => {
      const jaText = extractTranslation(ja, key);
      const enText = extractTranslation(en, key);

      expect(jaText).not.toBe(key);
      expect(enText).not.toBe(key);
      expect(jaText?.length ?? 0).toBeGreaterThan(0);
      expect(enText?.length ?? 0).toBeGreaterThan(0);
    });
  }
});
