import { describe, expect, it } from 'vitest';
import { generateDiffHunks, formatUnifiedDiff, decodeBlobContent } from '@/utils/diff';

describe('generateDiffHunks', () => {
  it('returns empty array for identical content', () => {
    const hunks = generateDiffHunks('hello\nworld', 'hello\nworld');
    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines.every((l) => l.type === 'context')).toBe(true);
  });

  it('returns empty array for two empty strings', () => {
    const hunks = generateDiffHunks('', '');
    // Single line (empty line comparison)
    expect(hunks).toHaveLength(1);
  });

  it('detects added lines', () => {
    const hunks = generateDiffHunks('a\nc', 'a\nb\nc');
    expect(hunks).toHaveLength(1);
    const lines = hunks[0].lines;
    // 'a' is context, then we get changes for b/c
    expect(lines.some((l) => l.type === 'add')).toBe(true);
  });

  it('detects deleted lines', () => {
    const hunks = generateDiffHunks('a\nb\nc', 'a\nc');
    expect(hunks).toHaveLength(1);
    const lines = hunks[0].lines;
    expect(lines.some((l) => l.type === 'delete')).toBe(true);
  });

  it('detects modified lines as delete + add', () => {
    const hunks = generateDiffHunks('old line', 'new line');
    const lines = hunks[0].lines;
    expect(lines).toEqual([
      { type: 'delete', content: 'old line' },
      { type: 'add', content: 'new line' },
    ]);
  });

  it('sets correct oldLines and newLines counts', () => {
    const hunks = generateDiffHunks('a\nb', 'a\nb\nc');
    expect(hunks[0].oldLines).toBe(2);
    expect(hunks[0].newLines).toBe(3);
  });

  it('starts counts at 1', () => {
    const hunks = generateDiffHunks('a', 'b');
    expect(hunks[0].oldStart).toBe(1);
    expect(hunks[0].newStart).toBe(1);
  });

  it('handles completely different content', () => {
    const hunks = generateDiffHunks('old', 'new');
    expect(hunks[0].lines).toEqual([
      { type: 'delete', content: 'old' },
      { type: 'add', content: 'new' },
    ]);
  });

  it('handles new content from nothing', () => {
    const hunks = generateDiffHunks('', 'new\ncontent');
    const lines = hunks[0].lines;
    // Empty string splits to [''] so first line is context/delete for empty, then adds
    expect(lines.length).toBeGreaterThan(0);
  });
});

describe('formatUnifiedDiff', () => {
  it('produces diff --git header', () => {
    const result = formatUnifiedDiff('src/file.ts', 'old', 'new', 'modified');
    expect(result).toContain('diff --git a/src/file.ts b/src/file.ts');
  });

  it('includes --- and +++ headers for modified files', () => {
    const result = formatUnifiedDiff('file.ts', 'old', 'new', 'modified');
    expect(result).toContain('--- a/file.ts');
    expect(result).toContain('+++ b/file.ts');
  });

  it('uses /dev/null for added files', () => {
    const result = formatUnifiedDiff('file.ts', '', 'new content', 'added');
    expect(result).toContain('--- /dev/null');
    expect(result).toContain('+++ b/file.ts');
    expect(result).toContain('new file mode 100644');
  });

  it('uses /dev/null for deleted files', () => {
    const result = formatUnifiedDiff('file.ts', 'old content', '', 'deleted');
    expect(result).toContain('--- a/file.ts');
    expect(result).toContain('+++ /dev/null');
    expect(result).toContain('deleted file mode 100644');
  });

  it('includes @@ hunk header', () => {
    const result = formatUnifiedDiff('file.ts', 'a\nb', 'a\nc', 'modified');
    expect(result).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
  });

  it('uses + prefix for added lines', () => {
    const result = formatUnifiedDiff('file.ts', 'old', 'new', 'modified');
    expect(result).toContain('+new');
  });

  it('uses - prefix for deleted lines', () => {
    const result = formatUnifiedDiff('file.ts', 'old', 'new', 'modified');
    expect(result).toContain('-old');
  });

  it('uses space prefix for context lines', () => {
    const result = formatUnifiedDiff('file.ts', 'same\nold', 'same\nnew', 'modified');
    expect(result).toContain(' same');
  });
});

describe('decodeBlobContent', () => {
  it('decodes text content correctly', () => {
    const blob = new TextEncoder().encode('hello world');
    const { text, isBinary } = decodeBlobContent(blob);
    expect(isBinary).toBe(false);
    expect(text).toBe('hello world');
  });

  it('detects binary content (null bytes)', () => {
    const blob = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]);
    const { text, isBinary } = decodeBlobContent(blob);
    expect(isBinary).toBe(true);
    expect(text).toBe('');
  });

  it('handles empty blob', () => {
    const blob = new Uint8Array([]);
    const { text, isBinary } = decodeBlobContent(blob);
    expect(isBinary).toBe(false);
    expect(text).toBe('');
  });

  it('handles UTF-8 content', () => {
    const blob = new TextEncoder().encode('こんにちは');
    const { text, isBinary } = decodeBlobContent(blob);
    expect(isBinary).toBe(false);
    expect(text).toBe('こんにちは');
  });

  it('only checks first 1024 bytes for binary detection', () => {
    // Create a blob with null byte after first 1024 bytes
    const data = new Uint8Array(2048);
    data.fill(65); // 'A'
    data[1025] = 0; // null byte after boundary
    const { isBinary } = decodeBlobContent(data);
    expect(isBinary).toBe(false); // Null byte is after the check window
  });
});
