import type { JSX } from 'solid-js';
import { Icons } from '../../lib/Icons';
import type { StorageFile } from '../../types';

export interface FileHandler {
  id: string;
  name: string;
  mime_types: string[];
  extensions: string[];
  open_url: string;
}

export type ResolvedHandler =
  | { type: 'builtin'; builtinId: 'text-editor' | 'image-viewer' }
  | { type: 'app'; handler: FileHandler };

export interface ContextMenuState {
  file: StorageFile;
  x: number;
  y: number;
}

// ── Built-in handler IDs ──

export const BUILTIN_TEXT_EDITOR = 'text-editor' as const;
export const BUILTIN_IMAGE_VIEWER = 'image-viewer' as const;

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico', '.bmp', '.avif',
]);

function getFileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1 || lastDot === fileName.length - 1) return '';
  return fileName.slice(lastDot).toLowerCase();
}

function handlerMatchesFile(h: FileHandler, file: StorageFile): boolean {
  const ext = getFileExtension(file.name);
  if (ext && h.extensions.some(e => e.toLowerCase() === ext)) return true;
  if (file.mime_type && h.mime_types.some(m => {
    if (m.endsWith('/*')) return file.mime_type!.startsWith(m.slice(0, -1));
    return m === file.mime_type;
  })) return true;
  return false;
}

/**
 * Collect all handlers that can open a file (built-in + app handlers).
 * Built-in handlers are always appended at the end as fallbacks.
 */
export function resolveHandlers(file: StorageFile, appHandlers: FileHandler[]): ResolvedHandler[] {
  const result: ResolvedHandler[] = [];

  // App handlers first
  for (const h of appHandlers) {
    if (handlerMatchesFile(h, file)) {
      result.push({ type: 'app', handler: h });
    }
  }

  // Built-in image viewer
  const ext = getFileExtension(file.name);
  const isImage = IMAGE_EXTENSIONS.has(ext) ||
    (file.mime_type?.startsWith('image/') ?? false);
  if (isImage) {
    result.push({ type: 'builtin', builtinId: BUILTIN_IMAGE_VIEWER });
  }

  // Built-in text editor (always available as fallback)
  result.push({ type: 'builtin', builtinId: BUILTIN_TEXT_EDITOR });

  return result;
}

// ── Default handler preference (localStorage) ──

const STORAGE_KEY = 'takos:default-file-handlers';

type DefaultHandlerMap = Record<string, string>; // extension or mime → handler key

function getHandlerKey(h: ResolvedHandler): string {
  return h.type === 'builtin' ? `__builtin_${h.builtinId}__` : h.handler.id;
}

function getDefaultMap(): DefaultHandlerMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveDefaultMap(map: DefaultHandlerMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch { /* quota exceeded etc */ }
}

/**
 * Get the file key used for default handler lookup.
 * Uses extension if available, otherwise mime type, otherwise '*'.
 */
function fileHandlerLookupKey(file: StorageFile): string {
  const ext = getFileExtension(file.name);
  if (ext) return `ext:${ext}`;
  if (file.mime_type) return `mime:${file.mime_type}`;
  return '*';
}

/**
 * Find the default handler for a file from the resolved list.
 * Returns undefined if no default is set or the saved default is no longer available.
 */
export function getDefaultHandler(file: StorageFile, handlers: ResolvedHandler[]): ResolvedHandler | undefined {
  const map = getDefaultMap();
  const key = fileHandlerLookupKey(file);
  const savedHandlerKey = map[key];
  if (!savedHandlerKey) return undefined;
  return handlers.find(h => getHandlerKey(h) === savedHandlerKey);
}

/**
 * Save a handler as the default for a given file type.
 */
export function setDefaultHandler(file: StorageFile, handler: ResolvedHandler): void {
  const map = getDefaultMap();
  const key = fileHandlerLookupKey(file);
  map[key] = getHandlerKey(handler);
  saveDefaultMap(map);
}

/**
 * Clear the default handler for a given file type.
 */
export function clearDefaultHandler(file: StorageFile): void {
  const map = getDefaultMap();
  const key = fileHandlerLookupKey(file);
  delete map[key];
  saveDefaultMap(map);
}

export function handlerDisplayName(h: ResolvedHandler, t: (key: any) => string): string {
  if (h.type === 'builtin') {
    return h.builtinId === BUILTIN_TEXT_EDITOR
      ? (t('textEditor') || 'Text Editor')
      : (t('imageViewer') || 'Image Viewer');
  }
  return h.handler.name;
}

// ── File icons ──

export function getFileIcon(file: StorageFile): JSX.Element {
  if (file.type === 'folder') {
    return <Icons.Folder class="w-5 h-5 text-zinc-500 dark:text-zinc-400" />;
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'ico'];
  const codeExts = ['js', 'ts', 'tsx', 'jsx', 'html', 'css', 'json', 'md'];
  const archiveExts = ['zip', 'tar', 'gz', 'rar', '7z'];
  const docExts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];

  if (imageExts.includes(ext)) {
    return <Icons.Image class="w-5 h-5 text-red-400" />;
  }
  if (codeExts.includes(ext)) {
    return <Icons.Code class="w-5 h-5 text-blue-400" />;
  }
  if (archiveExts.includes(ext)) {
    return <Icons.Archive class="w-5 h-5 text-amber-500" />;
  }
  if (docExts.includes(ext)) {
    return <Icons.FileText class="w-5 h-5 text-blue-500" />;
  }
  return <Icons.File class="w-5 h-5 text-zinc-400 dark:text-zinc-500" />;
}
