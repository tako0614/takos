import { describe, expect, it } from 'vitest';
import { validatePath, validatePathSegment } from '@/utils/path-validation';

describe('validatePath', () => {
  it('passes a simple relative path', () => {
    expect(validatePath('src/index.ts')).toBe('src/index.ts');
  });

  it('normalizes backslashes to forward slashes', () => {
    expect(validatePath('src\\lib\\file.ts')).toBe('src/lib/file.ts');
  });

  it('strips leading slashes', () => {
    expect(validatePath('/src/index.ts')).toBe('src/index.ts');
  });

  it('removes Windows drive letter prefix', () => {
    expect(validatePath('C:\\Users\\file.txt')).toBe('Users/file.txt');
    expect(validatePath('D:/path/file.txt')).toBe('path/file.txt');
  });

  it('collapses multiple slashes', () => {
    expect(validatePath('src///lib//file.ts')).toBe('src/lib/file.ts');
  });

  it('removes ./ prefix', () => {
    expect(validatePath('./src/file.ts')).toBe('src/file.ts');
  });

  it('removes /./ segments', () => {
    expect(validatePath('src/./lib/./file.ts')).toBe('src/lib/file.ts');
  });

  it('throws on path traversal (..)', () => {
    // The ".." is detected after NFC normalization and rejected
    expect(() => validatePath('src/../lib/file.ts')).toThrow('path traversal');
  });

  it('throws on double-encoded characters', () => {
    expect(() => validatePath('src/%252e%252e/etc')).toThrow('double-encoded');
  });

  it('throws on encoded null bytes', () => {
    expect(() => validatePath('src/%00/file')).toThrow('null bytes');
  });

  it('throws on raw null bytes', () => {
    expect(() => validatePath('src/\0file')).toThrow('null bytes');
  });

  it('throws on confusable Unicode dots', () => {
    // U+2024 = one dot leader
    expect(() => validatePath('src/\u2024\u2024/etc')).toThrow('confusable Unicode');
  });

  it('throws on confusable Unicode slashes', () => {
    // U+FF0F = fullwidth solidus
    expect(() => validatePath('src\uFF0Fetc')).toThrow('confusable Unicode');
  });

  it('converts fullwidth ASCII characters', () => {
    // U+FF41 = fullwidth 'a'
    const result = validatePath('\uFF41\uFF42\uFF43');
    expect(result).toBe('abc');
  });

  it('throws on fullwidth dot characters (confusable)', () => {
    // U+FF0E = fullwidth full stop, caught by confusable pattern before conversion
    expect(() => validatePath('\uFF0E\uFF0E/secret')).toThrow('confusable Unicode');
  });

  it('strips zero-width characters', () => {
    const result = validatePath('src/\u200bfile.ts');
    expect(result).toBe('src/file.ts');
  });

  it('throws on system paths (/proc/)', () => {
    expect(() => validatePath('something/proc/self')).toThrow('system paths');
  });

  it('throws on /etc/passwd', () => {
    expect(() => validatePath('something/etc/passwd')).toThrow('system paths');
  });

  it('throws on /etc/shadow', () => {
    expect(() => validatePath('something/etc/shadow')).toThrow('system paths');
  });

  it('throws on dangerous path patterns (/tmp/)', () => {
    expect(() => validatePath('something/tmp/exploit')).toThrow('potentially dangerous');
  });

  it('throws on /home/ pattern', () => {
    expect(() => validatePath('something/home/user')).toThrow('potentially dangerous');
  });

  it('passes through non-hex percent sequences without decoding', () => {
    // %ZZ does not match the hex pattern /%[0-9a-f]{2}/i, so it's not decoded
    const result = validatePath('src/%ZZ/file');
    expect(result).toBe('src/%ZZ/file');
  });

  it('handles URL-encoded normal characters', () => {
    const result = validatePath('src/%61%62%63.ts');
    expect(result).toBe('src/abc.ts');
  });

  it('throws on deeply nested traversal', () => {
    // The ".." patterns are detected before stripping
    expect(() => validatePath('a/b/../../c')).toThrow('path traversal');
  });

  it('strips Windows drive letter (C:) making the path relative', () => {
    // C: prefix is removed by the normalization, leaving "file.txt"
    expect(validatePath('C:file.txt')).toBe('file.txt');
  });

  it('handles ideographic space (U+3000)', () => {
    const result = validatePath('src/\u3000file.ts');
    expect(result).toBe('src/ file.ts');
  });
});

describe('validatePathSegment', () => {
  it('accepts a normal filename', () => {
    expect(validatePathSegment('index.ts')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(validatePathSegment('')).toBe(false);
  });

  it('rejects "."', () => {
    expect(validatePathSegment('.')).toBe(false);
  });

  it('rejects ".."', () => {
    expect(validatePathSegment('..')).toBe(false);
  });

  it('rejects names containing "/"', () => {
    expect(validatePathSegment('path/file')).toBe(false);
  });

  it('rejects names containing "%"', () => {
    expect(validatePathSegment('file%20name')).toBe(false);
  });

  it('rejects names containing backslash', () => {
    expect(validatePathSegment('path\\file')).toBe(false);
  });

  it('rejects names longer than 255 characters', () => {
    expect(validatePathSegment('a'.repeat(256))).toBe(false);
  });

  it('accepts names at exactly 255 characters', () => {
    expect(validatePathSegment('a'.repeat(255))).toBe(true);
  });

  it('accepts dotfiles (hidden files)', () => {
    expect(validatePathSegment('.gitignore')).toBe(true);
  });
});
