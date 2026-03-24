import { describe, it, expect } from 'vitest';

/**
 * Tests for the regex patterns used in scripts/patch-prisma-types.js.
 *
 * The script patches generated Prisma types to replace Date with string
 * in output types, while preserving Date | string input types.
 */

// Replicate the exact regexes from patch-prisma-types.js
function patchContent(content: string): string {
  content = content.replace(/: Date \| null\b/g, ': string | null');
  content = content.replace(/: Date\b(?!\s*\|)/g, ': string');
  return content;
}

describe('patch-prisma-types regexes', () => {
  it('replaces `: Date | null` with `: string | null`', () => {
    const input = '  createdAt: Date | null';
    expect(patchContent(input)).toBe('  createdAt: string | null');
  });

  it('replaces standalone `: Date` with `: string`', () => {
    const input = '  createdAt: Date';
    expect(patchContent(input)).toBe('  createdAt: string');
  });

  it('preserves `: Date | string` input types', () => {
    const input = '  createdAt: Date | string';
    expect(patchContent(input)).toBe('  createdAt: Date | string');
  });

  it('preserves `: Date | string | null` input types', () => {
    const input = '  createdAt: Date | string | null';
    expect(patchContent(input)).toBe('  createdAt: Date | string | null');
  });

  it('does not affect non-Date types', () => {
    const input = [
      '  id: string',
      '  count: number',
      '  active: boolean',
      '  data: Buffer | null',
      '  name: string | null',
    ].join('\n');
    expect(patchContent(input)).toBe(input);
  });

  it('handles multiple Date fields in sequence', () => {
    const input = [
      '  createdAt: Date',
      '  updatedAt: Date | null',
      '  deletedAt: Date | null',
      '  name: string',
    ].join('\n');
    const expected = [
      '  createdAt: string',
      '  updatedAt: string | null',
      '  deletedAt: string | null',
      '  name: string',
    ].join('\n');
    expect(patchContent(input)).toBe(expected);
  });

  it('handles mixed output and input types', () => {
    const input = [
      '// Output type',
      '  createdAt: Date',
      '  updatedAt: Date | null',
      '// Input type',
      '  createdAt: Date | string',
      '  updatedAt: Date | string | null',
    ].join('\n');
    const expected = [
      '// Output type',
      '  createdAt: string',
      '  updatedAt: string | null',
      '// Input type',
      '  createdAt: Date | string',
      '  updatedAt: Date | string | null',
    ].join('\n');
    expect(patchContent(input)).toBe(expected);
  });

  it('does not match DateTimeFilter or similar identifiers', () => {
    const input = '  export type DateTimeFilter = {';
    expect(patchContent(input)).toBe(input);
  });
});
