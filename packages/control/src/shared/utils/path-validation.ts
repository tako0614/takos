/** Maximum normalization iterations to prevent infinite loops from nested patterns. */
const MAX_NORMALIZATION_ITERATIONS = 10;

/** Unicode full-width character offset to convert to ASCII equivalents. */
const FULLWIDTH_TO_ASCII_OFFSET = 0xfee0;

/** Maximum allowed length for a single path segment name. */
const MAX_PATH_SEGMENT_LENGTH = 255;

// SECURITY: Normalization MUST happen AFTER URL decoding to prevent bypass attacks
// where encoded Unicode characters normalize to path traversal sequences.
export function validatePath(path: string): string {
  let normalized = path;

  // Reject double-encoded paths (%25 = encoded %)
  if (/%25/i.test(normalized)) {
    throw new Error('Invalid path: double-encoded characters not allowed');
  }

  // Decode URL-encoded characters (single pass only)
  try {
    if (/%[0-9a-f]{2}/i.test(normalized)) {
      const decoded = decodeURIComponent(normalized);
      if (decoded.includes('\0')) {
        throw new Error('Invalid path: encoded null bytes not allowed');
      }
      normalized = decoded;
    }
  } catch (e) {
    if (e instanceof URIError) {
      throw new Error('Invalid path: malformed URL encoding');
    }
    throw e;
  }

  // NFC normalization after decoding catches URL-encoded Unicode that normalizes to '..' etc.
  normalized = normalized.normalize('NFC');

  // Reject Unicode characters confusable with '.' or '/'
  const confusablePattern = /[\u2024\u2025\u2026\uFE52\uFF0E\uFF0F\u2044\u2215\u29F8\u29F9]/;
  if (confusablePattern.test(normalized)) {
    throw new Error('Invalid path: confusable Unicode characters not allowed');
  }

  // Null bytes can bypass string checks in some systems
  if (normalized.includes('\0') || normalized.includes('\x00')) {
    throw new Error('Invalid path: null bytes not allowed');
  }

  // Convert full-width characters to ASCII (homoglyph attack prevention).
  // \u3000 (ideographic space) handled separately as it's outside \uff01-\uff5e.
  normalized = normalized.replace(/[\uff01-\uff5e\u3000]/g, (ch) => {
    if (ch === '\u3000') return ' ';
    return String.fromCharCode(ch.charCodeAt(0) - FULLWIDTH_TO_ASCII_OFFSET);
  });

  // Re-check after full-width conversion (full-width dots may have created '..')
  if (normalized.includes('..')) {
    throw new Error('Invalid path: path traversal not allowed (after character normalization)');
  }

  normalized = normalized.replace(/[\u200b-\u200f\u2028-\u202f\u205f-\u206f\ufeff]/g, '');

  normalized = normalized
    .replace(/\\/g, '/')           // Convert all backslashes to forward slashes
    .replace(/^[a-zA-Z]:\/?/, '')  // Remove Windows drive letter (C:, D:\, etc.)
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '')
    .replace(/^\.\//, '')
    .replace(/\/\.\//g, '/')
    .replace(/\/\.\.(?=\/|$)/g, '')
    .replace(/^\.\.(?=\/|$)/g, '');

  // Repeat until stable (handles nested patterns like ./../)
  let prev = '';
  let iterations = 0;
  while (prev !== normalized && iterations < MAX_NORMALIZATION_ITERATIONS) {
    prev = normalized;
    normalized = normalized
      .replace(/^\.\//, '')
      .replace(/\/\.\//g, '/')
      .replace(/\/\.\.(?=\/|$)/g, '')
      .replace(/^\.\.(?=\/|$)/g, '');
    iterations++;
  }

  if (normalized.includes('..')) {
    throw new Error('Invalid path: path traversal not allowed');
  }

  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error('Invalid path: absolute paths not allowed');
  }

  // Reject known system paths (heuristic; server-side fs.lstat() provides real symlink detection)
  const symlinkPatterns = ['/proc/', '/sys/', '/dev/', '/etc/passwd', '/etc/shadow'];
  const lowerNormalized = normalized.toLowerCase();
  for (const pattern of symlinkPatterns) {
    if (lowerNormalized.includes(pattern) || lowerNormalized.startsWith(pattern.slice(1))) {
      throw new Error('Invalid path: system paths not allowed');
    }
  }

  const additionalSymlinkPatterns = [
    '/tmp/', '/..',
    '/var/run/', '/run/',
    '/home/', '/root/',
  ];
  for (const pattern of additionalSymlinkPatterns) {
    if (lowerNormalized.includes(pattern)) {
      throw new Error('Invalid path: potentially dangerous path pattern');
    }
  }

  return normalized;
}

export function validatePathSegment(name: string): boolean {
  if (!name || name === '.' || name === '..') return false;
  if (name.includes('/')) return false;
  if (name.includes('%') || name.includes('\\')) return false;
  if (name.length > MAX_PATH_SEGMENT_LENGTH) return false;
  return true;
}
