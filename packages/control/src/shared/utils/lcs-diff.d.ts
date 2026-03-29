export type LineDiffOp = {
    type: 'equal';
    line: string;
} | {
    type: 'insert';
    line: string;
} | {
    type: 'delete';
    line: string;
};
/**
 * Line diff based on LCS (O(n*m) time/memory). Intended for small files only.
 * Returns an edit script that transforms oldLines -> newLines.
 */
export declare function diffLinesLcs(oldLines: string[], newLines: string[]): LineDiffOp[];
//# sourceMappingURL=lcs-diff.d.ts.map