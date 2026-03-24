export type LineDiffOp =
  | { type: 'equal'; line: string }
  | { type: 'insert'; line: string }
  | { type: 'delete'; line: string };

/**
 * Line diff based on LCS (O(n*m) time/memory). Intended for small files only.
 * Returns an edit script that transforms oldLines -> newLines.
 */
export function diffLinesLcs(oldLines: string[], newLines: string[]): LineDiffOp[] {
  const n = oldLines.length;
  const m = newLines.length;

  // dp[(i*(m+1))+j] = LCS length for oldLines[0..i) and newLines[0..j)
  const dp = new Uint16Array((n + 1) * (m + 1));
  const width = m + 1;

  for (let i = 1; i <= n; i++) {
    const oldLine = oldLines[i - 1];
    for (let j = 1; j <= m; j++) {
      const idx = i * width + j;
      if (oldLine === newLines[j - 1]) {
        dp[idx] = (dp[(i - 1) * width + (j - 1)] + 1) as number;
      } else {
        const up = dp[(i - 1) * width + j];
        const left = dp[i * width + (j - 1)];
        dp[idx] = up >= left ? up : left;
      }
    }
  }

  const ops: LineDiffOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (oldLines[i - 1] === newLines[j - 1]) {
      ops.push({ type: 'equal', line: newLines[j - 1] });
      i--;
      j--;
      continue;
    }
    const up = dp[(i - 1) * width + j];
    const left = dp[i * width + (j - 1)];
    if (up >= left) {
      ops.push({ type: 'delete', line: oldLines[i - 1] });
      i--;
    } else {
      ops.push({ type: 'insert', line: newLines[j - 1] });
      j--;
    }
  }

  while (i > 0) {
    ops.push({ type: 'delete', line: oldLines[i - 1] });
    i--;
  }
  while (j > 0) {
    ops.push({ type: 'insert', line: newLines[j - 1] });
    j--;
  }

  ops.reverse();
  return ops;
}

