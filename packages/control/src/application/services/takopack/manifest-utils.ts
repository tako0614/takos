/**
 * Low-level utility helpers shared across manifest modules.
 */

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function asStringArray(value: unknown, fieldPath: string): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${fieldPath} must be an array of strings`);
  }

  return value.map((entry, index) => {
    const normalized = String(entry || '').trim();
    if (!normalized) {
      throw new Error(`${fieldPath}[${index}] must be a non-empty string`);
    }
    return normalized;
  });
}

export function asStringMap(value: unknown, fieldPath: string): Record<string, string> {
  if (value == null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldPath} must be an object`);
  }

  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) {
      throw new Error(`${fieldPath} contains an empty key`);
    }
    out[normalizedKey] = String(entry ?? '');
  }

  return out;
}

export function parseOptionalTimeoutMs(value: unknown, fieldPath: string): number | undefined {
  if (value == null) return undefined;
  const timeout = Number(value);
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 30000) {
    throw new Error(`${fieldPath} must be a number in range 1..30000`);
  }
  return Math.floor(timeout);
}

export function normalizePackagePath(path: string): string {
  const normalized = path
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/');

  return normalized === '.' ? '' : normalized;
}

export function normalizePackageDirectory(path: string): string {
  const normalized = normalizePackagePath(path).replace(/\/+$/, '');
  if (!normalized) return '';
  return `${normalized}/`;
}

export function getPackageFile(files: Map<string, ArrayBuffer>, path: string): ArrayBuffer | undefined {
  const targetPath = normalizePackagePath(path);
  for (const [filePath, content] of Array.from(files.entries())) {
    if (normalizePackagePath(filePath) === targetPath) {
      return content;
    }
  }
  return undefined;
}

export function getRequiredPackageFile(
  files: Map<string, ArrayBuffer>,
  path: string,
  errorMessage: string
): ArrayBuffer {
  const content = getPackageFile(files, path);
  if (!content) {
    throw new Error(errorMessage);
  }
  return content;
}

export function decodeArrayBuffer(content: ArrayBuffer): string {
  return new TextDecoder().decode(content);
}

export function looksLikeSQL(value: string): boolean {
  const sql = value.trim();
  if (!sql) return false;

  if (/\n/.test(sql) && /;/.test(sql)) {
    return true;
  }

  return /^(--|\/\*|\s*(create|alter|drop|insert|update|delete|pragma|begin|commit|with)\b)/i.test(sql);
}

export function getAssetContentType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.js') || lower.endsWith('.mjs')) return 'application/javascript';
  if (lower.endsWith('.css')) return 'text/css';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'application/yaml';
  if (lower.endsWith('.html')) return 'text/html';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.woff')) return 'font/woff';
  if (lower.endsWith('.woff2')) return 'font/woff2';
  return 'application/octet-stream';
}
