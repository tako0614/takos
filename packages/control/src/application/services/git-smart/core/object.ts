/**
 * Git object encode/decode — native git format.
 *
 * Git object layout: "<type> <size>\0<content>"
 * - blob: raw bytes
 * - tree: binary entries "<mode> <name>\0<20-byte-sha>"
 * - commit: text format "tree <sha>\nparent <sha>\nauthor ...\ncommitter ...\n\n<message>"
 */

import { sha1, concatBytes, hexToBytes, hexFromBuffer } from './sha1.ts';
import type { GitObjectType, TreeEntry, GitCommit, GitSignature } from '../git-objects.ts';

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

// --- Encoding ---

export function encodeBlob(content: Uint8Array): Uint8Array {
  const header = TEXT_ENCODER.encode(`blob ${content.length}\0`);
  return concatBytes(header, content);
}

export function encodeTree(entries: TreeEntry[]): Uint8Array {
  // Sort entries: git sorts by treating directory names as if they end with '/'
  const sorted = [...entries].sort((a, b) => {
    const aName = a.mode === '40000' || a.mode === '040000' ? a.name + '/' : a.name;
    const bName = b.mode === '40000' || b.mode === '040000' ? b.name + '/' : b.name;
    return aName < bName ? -1 : aName > bName ? 1 : 0;
  });

  const parts: Uint8Array[] = [];
  for (const entry of sorted) {
    // Git stores mode without leading zeros for trees (e.g., "40000" not "040000")
    const mode = entry.mode.replace(/^0+/, '');
    const entryHeader = TEXT_ENCODER.encode(`${mode} ${entry.name}\0`);
    const shaBytes = hexToBytes(entry.sha);
    parts.push(entryHeader, shaBytes);
  }

  const content = concatBytes(...parts);
  const header = TEXT_ENCODER.encode(`tree ${content.length}\0`);
  return concatBytes(header, content);
}

export function encodeTreeContent(entries: TreeEntry[]): Uint8Array {
  const sorted = [...entries].sort((a, b) => {
    const aName = a.mode === '40000' || a.mode === '040000' ? a.name + '/' : a.name;
    const bName = b.mode === '40000' || b.mode === '040000' ? b.name + '/' : b.name;
    return aName < bName ? -1 : aName > bName ? 1 : 0;
  });

  const parts: Uint8Array[] = [];
  for (const entry of sorted) {
    const mode = entry.mode.replace(/^0+/, '');
    const entryHeader = TEXT_ENCODER.encode(`${mode} ${entry.name}\0`);
    const shaBytes = hexToBytes(entry.sha);
    parts.push(entryHeader, shaBytes);
  }

  return concatBytes(...parts);
}

function formatSignature(prefix: string, sig: GitSignature): string {
  return `${prefix} ${sig.name} <${sig.email}> ${sig.timestamp} ${sig.tzOffset}`;
}

export function encodeCommit(commit: {
  tree: string;
  parents: string[];
  author: GitSignature;
  committer: GitSignature;
  message: string;
}): Uint8Array {
  const lines: string[] = [];
  lines.push(`tree ${commit.tree}`);
  for (const parent of commit.parents) {
    lines.push(`parent ${parent}`);
  }
  lines.push(formatSignature('author', commit.author));
  lines.push(formatSignature('committer', commit.committer));
  lines.push('');
  lines.push(commit.message);

  const content = TEXT_ENCODER.encode(lines.join('\n'));
  const header = TEXT_ENCODER.encode(`commit ${content.length}\0`);
  return concatBytes(header, content);
}

export function encodeCommitContent(commit: {
  tree: string;
  parents: string[];
  author: GitSignature;
  committer: GitSignature;
  message: string;
}): Uint8Array {
  const lines: string[] = [];
  lines.push(`tree ${commit.tree}`);
  for (const parent of commit.parents) {
    lines.push(`parent ${parent}`);
  }
  lines.push(formatSignature('author', commit.author));
  lines.push(formatSignature('committer', commit.committer));
  lines.push('');
  lines.push(commit.message);

  return TEXT_ENCODER.encode(lines.join('\n'));
}

// --- Hashing ---

export async function hashObject(type: GitObjectType, content: Uint8Array): Promise<string> {
  const header = TEXT_ENCODER.encode(`${type} ${content.length}\0`);
  const full = concatBytes(header, content);
  return sha1(full);
}

export async function hashBlob(content: Uint8Array): Promise<string> {
  return hashObject('blob', content);
}

export async function hashTree(entries: TreeEntry[]): Promise<string> {
  const content = encodeTreeContent(entries);
  return hashObject('tree', content);
}

export async function hashCommit(commit: {
  tree: string;
  parents: string[];
  author: GitSignature;
  committer: GitSignature;
  message: string;
}): Promise<string> {
  const content = encodeCommitContent(commit);
  return hashObject('commit', content);
}

// --- Decoding ---

export function decodeObjectHeader(raw: Uint8Array): {
  type: GitObjectType;
  size: number;
  contentOffset: number;
} {
  const nullIdx = raw.indexOf(0);
  if (nullIdx === -1) throw new Error('Invalid git object: no null byte in header');

  const headerStr = TEXT_DECODER.decode(raw.subarray(0, nullIdx));
  const spaceIdx = headerStr.indexOf(' ');
  if (spaceIdx === -1) throw new Error('Invalid git object header');

  const type = headerStr.substring(0, spaceIdx) as GitObjectType;
  const size = parseInt(headerStr.substring(spaceIdx + 1), 10);

  return { type, size, contentOffset: nullIdx + 1 };
}

export function decodeObject(raw: Uint8Array): { type: GitObjectType; content: Uint8Array } {
  const { type, contentOffset } = decodeObjectHeader(raw);
  return { type, content: raw.subarray(contentOffset) };
}

export function decodeTree(content: Uint8Array): TreeEntry[] {
  const entries: TreeEntry[] = [];
  let offset = 0;

  while (offset < content.length) {
    // Find space after mode
    const spaceIdx = content.indexOf(0x20, offset);
    if (spaceIdx === -1) break;

    const mode = TEXT_DECODER.decode(content.subarray(offset, spaceIdx));
    // Normalize mode to 6 chars
    const normalizedMode = mode.padStart(6, '0');

    // Find null after name
    const nullIdx = content.indexOf(0x00, spaceIdx + 1);
    if (nullIdx === -1) break;

    const name = TEXT_DECODER.decode(content.subarray(spaceIdx + 1, nullIdx));

    // Read 20-byte SHA
    const shaBytes = content.subarray(nullIdx + 1, nullIdx + 21);
    if (shaBytes.length < 20) break;
    const sha = hexFromBuffer(shaBytes.slice().buffer as ArrayBuffer);

    entries.push({ mode: normalizedMode, name, sha });
    offset = nullIdx + 21;
  }

  return entries;
}

export function decodeCommit(content: Uint8Array): GitCommit {
  const text = TEXT_DECODER.decode(content);
  const blankLineIdx = text.indexOf('\n\n');
  const headerSection = blankLineIdx !== -1 ? text.substring(0, blankLineIdx) : text;
  const message = blankLineIdx !== -1 ? text.substring(blankLineIdx + 2) : '';

  let tree = '';
  const parents: string[] = [];
  let author: GitSignature | null = null;
  let committer: GitSignature | null = null;

  for (const line of headerSection.split('\n')) {
    if (line.startsWith('tree ')) {
      tree = line.substring(5);
    } else if (line.startsWith('parent ')) {
      parents.push(line.substring(7));
    } else if (line.startsWith('author ')) {
      author = parseSignature(line.substring(7));
    } else if (line.startsWith('committer ')) {
      committer = parseSignature(line.substring(10));
    }
  }

  if (!tree || !author || !committer) {
    throw new Error('Invalid commit object: missing required fields');
  }

  return { sha: '', tree, parents, author, committer, message };
}

function parseSignature(raw: string): GitSignature {
  // Format: "Name <email> timestamp tzoffset"
  const emailEnd = raw.lastIndexOf('>');
  if (emailEnd === -1) throw new Error('Invalid signature: no email');

  const emailStart = raw.lastIndexOf('<', emailEnd);
  if (emailStart === -1) throw new Error('Invalid signature: no email start');

  const name = raw.substring(0, emailStart).trim();
  const email = raw.substring(emailStart + 1, emailEnd);
  const rest = raw.substring(emailEnd + 1).trim().split(' ');
  const timestamp = parseInt(rest[0], 10);
  const tzOffset = rest[1] || '+0000';

  return { name, email, timestamp, tzOffset };
}
