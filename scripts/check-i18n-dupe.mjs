import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

// The en.ts / ja.ts locale maps are built by spreading 10 sub-files in a fixed
// order. JS object spread silently lets a later sub-file shadow an earlier
// key with NO TypeScript error, so a key defined in two sub-files resolves to
// whichever spread comes last (capitalization / value drift goes unnoticed).
// This guard fails when any top-level key is defined in more than one sub-file
// of the same language.
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const localeDirs = ['web/src/i18n/en', 'web/src/i18n/ja'];
const keyPattern = /^\s+([a-zA-Z_]\w*):/gm;

function extractKeys(text) {
  const keys = [];
  for (const match of text.matchAll(keyPattern)) {
    keys.push(match[1]);
  }
  return keys;
}

const violations = [];
const keysByLang = new Map();

for (const localeDir of localeDirs) {
  const dir = resolve(repoRoot, localeDir);
  const lang = localeDir.split('/').pop();
  const langKeys = new Set();
  keysByLang.set(lang, langKeys);
  const seen = new Map();
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    continue;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    const filePath = resolve(dir, entry.name);
    const relPath = relative(repoRoot, filePath);
    let text;
    try {
      text = await readFile(filePath, 'utf8');
    } catch {
      continue;
    }
    for (const key of extractKeys(text)) {
      langKeys.add(key);
      const existing = seen.get(key);
      if (existing) {
        violations.push({ key, files: [existing, relPath] });
      } else {
        seen.set(key, relPath);
      }
    }
  }
}

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(
      `duplicate i18n key "${violation.key}" defined in ${violation.files.join(' and ')}`,
    );
  }
  process.exit(1);
}

console.log('i18n duplicate-key check passed');

// Cross-language parity: ja is the master key set (TranslationKey = keyof ja),
// and en is type-forced to it — but a key added to only one language slips past
// tsc's structural check until it is read. Fail when the two key sets diverge so
// ja/en stay 1:1.
const enKeys = keysByLang.get('en');
const jaKeys = keysByLang.get('ja');
if (enKeys && jaKeys) {
  const missingInEn = [...jaKeys].filter((k) => !enKeys.has(k)).sort();
  const missingInJa = [...enKeys].filter((k) => !jaKeys.has(k)).sort();
  if (missingInEn.length > 0 || missingInJa.length > 0) {
    for (const k of missingInEn) {
      console.error(`i18n parity: key "${k}" exists in ja but is missing in en`);
    }
    for (const k of missingInJa) {
      console.error(`i18n parity: key "${k}" exists in en but is missing in ja`);
    }
    process.exit(1);
  }
  console.log(`i18n parity check passed (${jaKeys.size} keys, ja↔en 1:1)`);
}
