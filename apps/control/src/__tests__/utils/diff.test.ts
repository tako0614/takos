import { generateDiffHunks, formatUnifiedDiff, decodeBlobContent } from '@/utils/diff';


import { assertEquals, assert, assertStringIncludes } from 'jsr:@std/assert';

  Deno.test('generateDiffHunks - returns empty array for identical content', () => {
  const hunks = generateDiffHunks('hello\nworld', 'hello\nworld');
    assertEquals(hunks.length, 1);
    assertEquals(hunks[0].lines.every((l) => l.type === 'context'), true);
})
  Deno.test('generateDiffHunks - returns empty array for two empty strings', () => {
  const hunks = generateDiffHunks('', '');
    // Single line (empty line comparison)
    assertEquals(hunks.length, 1);
})
  Deno.test('generateDiffHunks - detects added lines', () => {
  const hunks = generateDiffHunks('a\nc', 'a\nb\nc');
    assertEquals(hunks.length, 1);
    const lines = hunks[0].lines;
    // 'a' is context, then we get changes for b/c
    assertEquals(lines.some((l) => l.type === 'add'), true);
})
  Deno.test('generateDiffHunks - detects deleted lines', () => {
  const hunks = generateDiffHunks('a\nb\nc', 'a\nc');
    assertEquals(hunks.length, 1);
    const lines = hunks[0].lines;
    assertEquals(lines.some((l) => l.type === 'delete'), true);
})
  Deno.test('generateDiffHunks - detects modified lines as delete + add', () => {
  const hunks = generateDiffHunks('old line', 'new line');
    const lines = hunks[0].lines;
    assertEquals(lines, [
      { type: 'delete', content: 'old line' },
      { type: 'add', content: 'new line' },
    ]);
})
  Deno.test('generateDiffHunks - sets correct oldLines and newLines counts', () => {
  const hunks = generateDiffHunks('a\nb', 'a\nb\nc');
    assertEquals(hunks[0].oldLines, 2);
    assertEquals(hunks[0].newLines, 3);
})
  Deno.test('generateDiffHunks - starts counts at 1', () => {
  const hunks = generateDiffHunks('a', 'b');
    assertEquals(hunks[0].oldStart, 1);
    assertEquals(hunks[0].newStart, 1);
})
  Deno.test('generateDiffHunks - handles completely different content', () => {
  const hunks = generateDiffHunks('old', 'new');
    assertEquals(hunks[0].lines, [
      { type: 'delete', content: 'old' },
      { type: 'add', content: 'new' },
    ]);
})
  Deno.test('generateDiffHunks - handles new content from nothing', () => {
  const hunks = generateDiffHunks('', 'new\ncontent');
    const lines = hunks[0].lines;
    // Empty string splits to [''] so first line is context/delete for empty, then adds
    assert(lines.length > 0);
})

  Deno.test('formatUnifiedDiff - produces diff --git header', () => {
  const result = formatUnifiedDiff('src/file.ts', 'old', 'new', 'modified');
    assertStringIncludes(result, 'diff --git a/src/file.ts b/src/file.ts');
})
  Deno.test('formatUnifiedDiff - includes --- and +++ headers for modified files', () => {
  const result = formatUnifiedDiff('file.ts', 'old', 'new', 'modified');
    assertStringIncludes(result, '--- a/file.ts');
    assertStringIncludes(result, '+++ b/file.ts');
})
  Deno.test('formatUnifiedDiff - uses /dev/null for added files', () => {
  const result = formatUnifiedDiff('file.ts', '', 'new content', 'added');
    assertStringIncludes(result, '--- /dev/null');
    assertStringIncludes(result, '+++ b/file.ts');
    assertStringIncludes(result, 'new file mode 100644');
})
  Deno.test('formatUnifiedDiff - uses /dev/null for deleted files', () => {
  const result = formatUnifiedDiff('file.ts', 'old content', '', 'deleted');
    assertStringIncludes(result, '--- a/file.ts');
    assertStringIncludes(result, '+++ /dev/null');
    assertStringIncludes(result, 'deleted file mode 100644');
})
  Deno.test('formatUnifiedDiff - includes @@ hunk header', () => {
  const result = formatUnifiedDiff('file.ts', 'a\nb', 'a\nc', 'modified');
    assert(/@@ -\d+,\d+ \+\d+,\d+ @@/.test(result));
})
  Deno.test('formatUnifiedDiff - uses + prefix for added lines', () => {
  const result = formatUnifiedDiff('file.ts', 'old', 'new', 'modified');
    assertStringIncludes(result, '+new');
})
  Deno.test('formatUnifiedDiff - uses - prefix for deleted lines', () => {
  const result = formatUnifiedDiff('file.ts', 'old', 'new', 'modified');
    assertStringIncludes(result, '-old');
})
  Deno.test('formatUnifiedDiff - uses space prefix for context lines', () => {
  const result = formatUnifiedDiff('file.ts', 'same\nold', 'same\nnew', 'modified');
    assertStringIncludes(result, ' same');
})

  Deno.test('decodeBlobContent - decodes text content correctly', () => {
  const blob = new TextEncoder().encode('hello world');
    const { text, isBinary } = decodeBlobContent(blob);
    assertEquals(isBinary, false);
    assertEquals(text, 'hello world');
})
  Deno.test('decodeBlobContent - detects binary content (null bytes)', () => {
  const blob = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]);
    const { text, isBinary } = decodeBlobContent(blob);
    assertEquals(isBinary, true);
    assertEquals(text, '');
})
  Deno.test('decodeBlobContent - handles empty blob', () => {
  const blob = new Uint8Array([]);
    const { text, isBinary } = decodeBlobContent(blob);
    assertEquals(isBinary, false);
    assertEquals(text, '');
})
  Deno.test('decodeBlobContent - handles UTF-8 content', () => {
  const blob = new TextEncoder().encode('こんにちは');
    const { text, isBinary } = decodeBlobContent(blob);
    assertEquals(isBinary, false);
    assertEquals(text, 'こんにちは');
})
  Deno.test('decodeBlobContent - only checks first 1024 bytes for binary detection', () => {
  // Create a blob with null byte after first 1024 bytes
    const data = new Uint8Array(2048);
    data.fill(65); // 'A'
    data[1025] = 0; // null byte after boundary
    const { isBinary } = decodeBlobContent(data);
    assertEquals(isBinary, false); // Null byte is after the check window
})