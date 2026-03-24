export type DiffLine = {
  type: 'context' | 'add' | 'delete';
  content: string;
};

export type DiffHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
};

export function generateDiffHunks(oldContent: string, newContent: string): DiffHunk[] {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const lines: DiffLine[] = [];
  let oldIdx = 0;
  let newIdx = 0;

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    const oldLine = oldLines[oldIdx];
    const newLine = newLines[newIdx];

    if (oldIdx >= oldLines.length) {
      lines.push({ type: 'add', content: newLine });
      newIdx++;
      continue;
    }
    if (newIdx >= newLines.length) {
      lines.push({ type: 'delete', content: oldLine });
      oldIdx++;
      continue;
    }
    if (oldLine === newLine) {
      lines.push({ type: 'context', content: oldLine });
      oldIdx++;
      newIdx++;
      continue;
    }
    lines.push({ type: 'delete', content: oldLine });
    lines.push({ type: 'add', content: newLine });
    oldIdx++;
    newIdx++;
  }

  if (lines.length === 0) {
    return [];
  }

  return [{
    oldStart: 1,
    oldLines: oldLines.length,
    newStart: 1,
    newLines: newLines.length,
    lines,
  }];
}

export function formatUnifiedDiff(
  path: string,
  oldContent: string,
  newContent: string,
  status: 'added' | 'modified' | 'deleted'
): string {
  const hunks = generateDiffHunks(oldContent, newContent);
  const header = [
    `diff --git a/${path} b/${path}`,
    status === 'added' ? 'new file mode 100644' : '',
    status === 'deleted' ? 'deleted file mode 100644' : '',
    `--- ${status === 'added' ? '/dev/null' : `a/${path}`}`,
    `+++ ${status === 'deleted' ? '/dev/null' : `b/${path}`}`,
  ].filter(Boolean).join('\n');

  if (hunks.length === 0) {
    return `${header}\n`;
  }

  const body = hunks.map((hunk) => {
    const lines = hunk.lines.map((line) => {
      const prefix = line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' ';
      return `${prefix}${line.content}`;
    }).join('\n');
    return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n${lines}`;
  }).join('\n');

  return `${header}\n${body}\n`;
}

export function decodeBlobContent(blob: Uint8Array): { text: string; isBinary: boolean } {
  let binaryScore = 0;
  for (let i = 0; i < Math.min(blob.length, 1024); i++) {
    if (blob[i] === 0) {
      binaryScore++;
    }
  }
  if (binaryScore > 0) {
    return { text: '', isBinary: true };
  }
  try {
    const text = new TextDecoder().decode(blob);
    return { text, isBinary: false };
  } catch {
    return { text: '', isBinary: true };
  }
}
