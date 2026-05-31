import { diffLinesLcs } from "./lcs-diff.ts";

export type DiffLine = {
  type: "context" | "add" | "delete";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
};

export type DiffHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
};

/**
 * Build aligned diff hunks from two text blobs using the in-repo LCS aligner
 * ({@link diffLinesLcs}). Unlike a naive line-by-line walk, this keeps
 * unchanged lines as context and only emits add/delete for genuinely
 * inserted/removed lines, so mid-file edits do not show spurious churn.
 *
 * The single returned hunk (when there is any change) carries the whole-file
 * extent, with header line counts reflecting that extent. Lines carry
 * 1-based oldLineNumber / newLineNumber where applicable.
 */
export function buildHunks(
  oldContent: string,
  newContent: string,
): DiffHunk[] {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const ops = diffLinesLcs(oldLines, newLines);

  const lines: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const op of ops) {
    if (op.type === "equal") {
      oldNo++;
      newNo++;
      lines.push({
        type: "context",
        content: op.line,
        oldLineNumber: oldNo,
        newLineNumber: newNo,
      });
    } else if (op.type === "delete") {
      oldNo++;
      lines.push({
        type: "delete",
        content: op.line,
        oldLineNumber: oldNo,
      });
    } else {
      newNo++;
      lines.push({
        type: "add",
        content: op.line,
        newLineNumber: newNo,
      });
    }
  }

  if (lines.length === 0) {
    return [];
  }

  return [{
    oldStart: oldLines.length > 0 ? 1 : 0,
    oldLines: oldLines.length,
    newStart: newLines.length > 0 ? 1 : 0,
    newLines: newLines.length,
    lines,
  }];
}

/**
 * Aligned diff hunks for two text blobs. Re-implemented on top of
 * {@link buildHunks} (LCS-based) — kept as a stable export for existing
 * callers/tests.
 */
export function generateDiffHunks(
  oldContent: string,
  newContent: string,
): DiffHunk[] {
  return buildHunks(oldContent, newContent);
}

export function formatUnifiedDiff(
  path: string,
  oldContent: string,
  newContent: string,
  status: "added" | "modified" | "deleted",
): string {
  const hunks = generateDiffHunks(oldContent, newContent);
  const header = [
    `diff --git a/${path} b/${path}`,
    status === "added" ? "new file mode 100644" : "",
    status === "deleted" ? "deleted file mode 100644" : "",
    `--- ${status === "added" ? "/dev/null" : `a/${path}`}`,
    `+++ ${status === "deleted" ? "/dev/null" : `b/${path}`}`,
  ].filter(Boolean).join("\n");

  if (hunks.length === 0) {
    return `${header}\n`;
  }

  const body = hunks.map((hunk) => {
    const lines = hunk.lines.map((line) => {
      const prefix = line.type === "add"
        ? "+"
        : line.type === "delete"
        ? "-"
        : " ";
      return `${prefix}${line.content}`;
    }).join("\n");
    return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n${lines}`;
  }).join("\n");

  return `${header}\n${body}\n`;
}

/** Number of bytes sampled from the start of a blob to detect binary content. */
const BINARY_DETECTION_SAMPLE_SIZE = 1024;

export function decodeBlobContent(
  blob: Uint8Array,
): { text: string; isBinary: boolean } {
  let binaryScore = 0;
  for (
    let i = 0;
    i < Math.min(blob.length, BINARY_DETECTION_SAMPLE_SIZE);
    i++
  ) {
    if (blob[i] === 0) {
      binaryScore++;
    }
  }
  if (binaryScore > 0) {
    return { text: "", isBinary: true };
  }
  try {
    const text = new TextDecoder().decode(blob);
    return { text, isBinary: false };
  } catch {
    return { text: "", isBinary: true };
  }
}
