/**
 * Tree operations — navigate, flatten, build, and apply changes.
 *
 * Adapted from git-store/tree.ts for native git tree format.
 */

import type { R2Bucket } from '../../../../shared/types/bindings.ts';
import type { TreeEntry } from '../types';
import { FILE_MODES } from '../types';
import { putTree, putBlob, getTreeEntries, getBlob } from './object-store';

const DEFAULT_MAX_FLATTEN_DEPTH = 50;
const DEFAULT_MAX_FLATTEN_ENTRIES = 100000;
const MAX_GIT_PATH_LENGTH = 4096;
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/;

function isValidGitPathSegment(segment: string): boolean {
  return !(!segment || segment === '.' || segment === '..' || segment.includes('\0') || CONTROL_CHAR_PATTERN.test(segment));
}

export function isValidGitPath(path: string): boolean {
  if (typeof path !== 'string') return false;
  if (path.length === 0 || path.length > MAX_GIT_PATH_LENGTH) return false;
  if (path.includes('\0') || CONTROL_CHAR_PATTERN.test(path)) return false;
  if (path.startsWith('/') || path.endsWith('/') || path.includes('\\') || path.includes('//')) return false;
  const segments = path.split('/');
  return segments.length > 0 && segments.every(isValidGitPathSegment);
}

export function assertValidGitPath(path: string): string {
  const normalized = path.trim();
  if (!isValidGitPath(normalized)) throw new Error(`Invalid git path: ${path}`);
  return normalized;
}

export async function createTree(bucket: R2Bucket, entries: TreeEntry[]): Promise<string> {
  return putTree(bucket, entries);
}

export async function getTree(
  bucket: R2Bucket, sha: string,
): Promise<{ sha: string; entries: TreeEntry[] } | null> {
  const entries = await getTreeEntries(bucket, sha);
  if (!entries) return null;
  return { sha, entries };
}

export async function getEntryAtPath(
  bucket: R2Bucket, rootTreeSha: string, path: string,
): Promise<(TreeEntry & { type: 'blob' | 'tree' }) | null> {
  const normalizedPath = path.replace(/^\/+|\/+$/g, '');
  if (!normalizedPath) {
    return { mode: FILE_MODES.DIRECTORY, name: '', sha: rootTreeSha, type: 'tree' } as TreeEntry & { type: 'blob' | 'tree' };
  }

  const parts = normalizedPath.split('/');
  let currentTreeSha = rootTreeSha;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isLast = i === parts.length - 1;

    const entries = await getTreeEntries(bucket, currentTreeSha);
    if (!entries) return null;

    const entry = entries.find(e => e.name === part);
    if (!entry) return null;

    const isDir = entry.mode === '040000' || entry.mode === '40000';
    const entryType: 'blob' | 'tree' = isDir ? 'tree' : 'blob';

    if (isLast) return { ...entry, type: entryType };
    if (!isDir) return null;

    currentTreeSha = entry.sha;
  }

  return null;
}

export async function listDirectory(
  bucket: R2Bucket, rootTreeSha: string, path = '',
): Promise<TreeEntry[] | null> {
  const entry = await getEntryAtPath(bucket, rootTreeSha, path);
  if (!entry || entry.type !== 'tree') return null;
  return getTreeEntries(bucket, entry.sha);
}

export async function getBlobAtPath(
  bucket: R2Bucket, rootTreeSha: string, path: string,
): Promise<Uint8Array | null> {
  const entry = await getEntryAtPath(bucket, rootTreeSha, path);
  if (!entry || entry.type !== 'blob' || entry.mode === FILE_MODES.SYMLINK) return null;
  return getBlob(bucket, entry.sha);
}

export async function buildTreeFromPaths(
  bucket: R2Bucket,
  files: Array<{ path: string; sha: string; mode?: string }>,
): Promise<string> {
  interface TreeNode {
    entries: Map<string, TreeEntry | TreeNode>;
  }

  const root: TreeNode = { entries: new Map() };

  for (const file of files) {
    const validPath = assertValidGitPath(file.path);
    const parts = validPath.split('/');
    let current = root;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!current.entries.has(part)) {
        current.entries.set(part, { entries: new Map() });
      }
      const next = current.entries.get(part);
      if (!next || !('entries' in next)) throw new Error(`Path conflict at ${parts.slice(0, i + 1).join('/')}`);
      current = next;
    }

    const fileName = parts[parts.length - 1];
    current.entries.set(fileName, {
      mode: file.mode || FILE_MODES.REGULAR_FILE,
      name: fileName,
      sha: file.sha,
    });
  }

  async function createTreeFromNode(node: TreeNode): Promise<string> {
    const entries: TreeEntry[] = [];

    for (const [name, child] of node.entries) {
      if ('entries' in child && child.entries instanceof Map) {
        const subtreeSha = await createTreeFromNode(child as TreeNode);
        entries.push({ mode: FILE_MODES.DIRECTORY, name, sha: subtreeSha });
      } else {
        entries.push(child as TreeEntry);
      }
    }

    return createTree(bucket, entries);
  }

  return createTreeFromNode(root);
}

export async function applyTreeChanges(
  bucket: R2Bucket,
  baseTreeSha: string,
  changes: Array<{
    path: string;
    operation: 'add' | 'modify' | 'delete';
    sha?: string;
    mode?: string;
  }>,
): Promise<string> {
  const files = await flattenTree(bucket, baseTreeSha);
  const fileMap = new Map(files.map(f => [f.path, f]));

  for (const change of changes) {
    if (change.operation === 'delete') {
      fileMap.delete(change.path);
    } else {
      if (!change.sha) throw new Error(`SHA required for ${change.operation} operation`);
      fileMap.set(change.path, { path: change.path, sha: change.sha, mode: change.mode || FILE_MODES.REGULAR_FILE });
    }
  }

  return buildTreeFromPaths(bucket, Array.from(fileMap.values()));
}

export async function flattenTree(
  bucket: R2Bucket,
  treeSha: string,
  basePath = '',
  options?: { maxDepth?: number; maxEntries?: number; skipSymlinks?: boolean },
): Promise<Array<{ path: string; sha: string; mode: string }>> {
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_FLATTEN_DEPTH;
  const maxEntries = options?.maxEntries ?? DEFAULT_MAX_FLATTEN_ENTRIES;
  const skipSymlinks = options?.skipSymlinks ?? false;

  const files: Array<{ path: string; sha: string; mode: string }> = [];
  const counters = { entries: 0 };
  const visited = new Set<string>();

  async function walk(currentTreeSha: string, currentBasePath: string, depth: number): Promise<void> {
    if (depth > maxDepth) throw new Error(`Tree flatten depth limit exceeded (max ${maxDepth})`);
    if (visited.has(currentTreeSha)) return; // Prevent circular reference loops
    visited.add(currentTreeSha);

    const entries = await getTreeEntries(bucket, currentTreeSha);
    if (!entries) return;

    for (const entry of entries) {
      counters.entries++;
      if (counters.entries > maxEntries) throw new Error(`Tree flatten entry limit exceeded (max ${maxEntries})`);

      const fullPath = currentBasePath ? `${currentBasePath}/${entry.name}` : entry.name;
      const isDir = entry.mode === '040000' || entry.mode === '40000';

      if (isDir) {
        await walk(entry.sha, fullPath, depth + 1);
      } else {
        if (entry.mode === FILE_MODES.SYMLINK) {
          if (skipSymlinks) continue;
          throw new Error(`Symlink blob entries are not supported: ${fullPath}`);
        }
        files.push({ path: fullPath, sha: entry.sha, mode: entry.mode });
      }
    }
  }

  await walk(treeSha, basePath, 0);
  return files;
}

export async function createEmptyTree(bucket: R2Bucket): Promise<string> {
  return createTree(bucket, []);
}

export async function createSingleFileTree(
  bucket: R2Bucket, fileName: string, content: Uint8Array,
): Promise<string> {
  const blobSha = await putBlob(bucket, content);
  return createTree(bucket, [{ mode: FILE_MODES.REGULAR_FILE, name: fileName, sha: blobSha }]);
}
