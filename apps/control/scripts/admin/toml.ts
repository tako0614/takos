/**
 * TOML parsing helpers for reading wrangler.toml configuration.
 */

import * as fs from 'fs';

import { WRANGLER_TOML_PATH } from './constants.ts';
import { escapeRegExp } from './utils.ts';

export function parseTomlPrimitive(rawValue: string): string {
  const trimmed = rawValue.trim();
  const noComment = trimmed.replace(/\s+#.*$/, '').trim();
  if ((noComment.startsWith('"') && noComment.endsWith('"')) || (noComment.startsWith("'") && noComment.endsWith("'"))) {
    return noComment.slice(1, -1);
  }
  return noComment;
}

export function parseTomlKeyValueBlock(block: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  const lineRegex = /^\s*([A-Za-z0-9_]+)\s*=\s*(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = lineRegex.exec(block)) !== null) {
    parsed[match[1]] = parseTomlPrimitive(match[2]);
  }
  return parsed;
}

export function readTomlSection(text: string, sectionName: string): Record<string, string> | null {
  const sectionRegex = new RegExp(
    `^\\[${escapeRegExp(sectionName)}\\]\\s*\\n([\\s\\S]*?)(?=^\\[[^\\[]|^\\[\\[|(?![\\s\\S]))`,
    'm'
  );
  const section = text.match(sectionRegex);
  if (!section) {
    return null;
  }
  return parseTomlKeyValueBlock(section[1]);
}

export function readTomlArraySections(text: string, arraySectionName: string): Array<Record<string, string>> {
  const arrayRegex = new RegExp(
    `^\\[\\[${escapeRegExp(arraySectionName)}\\]\\]\\s*\\n([\\s\\S]*?)(?=^\\[\\[|^\\[[^\\[]|(?![\\s\\S]))`,
    'gm'
  );

  const entries: Array<Record<string, string>> = [];
  let match: RegExpExecArray | null;
  while ((match = arrayRegex.exec(text)) !== null) {
    entries.push(parseTomlKeyValueBlock(match[1]));
  }
  return entries;
}

export function readWranglerToml(): string | null {
  try {
    return fs.readFileSync(WRANGLER_TOML_PATH, 'utf8');
  } catch {
    return null;
  }
}
