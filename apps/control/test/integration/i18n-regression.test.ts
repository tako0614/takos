import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertNotEquals, assert } from 'jsr:@std/assert';

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


  const criticalKeys = ['skillsEmptyHint', 'tasksEmptyHint', 'workspaceSlug'] as const;
  const ja = readTranslationSource('ja');
  const en = readTranslationSource('en');

  for (const key of criticalKeys) {
    Deno.test('i18n regression (issue 090) - resolves ${key} in ja/en without returning raw key', () => {
  const jaText = extractTranslation(ja, key);
      const enText = extractTranslation(en, key);

      assertNotEquals(jaText, key);
      assertNotEquals(enText, key);
      assert(jaText?.length ?? 0 > 0);
      assert(enText?.length ?? 0 > 0);
})  }
