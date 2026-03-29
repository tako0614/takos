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
export declare function generateDiffHunks(oldContent: string, newContent: string): DiffHunk[];
export declare function formatUnifiedDiff(path: string, oldContent: string, newContent: string, status: 'added' | 'modified' | 'deleted'): string;
export declare function decodeBlobContent(blob: Uint8Array): {
    text: string;
    isBinary: boolean;
};
//# sourceMappingURL=unified-diff.d.ts.map