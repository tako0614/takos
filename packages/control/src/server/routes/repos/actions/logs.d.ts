import type { R2Bucket } from '../../../../shared/types/bindings.ts';
export declare class LogsNotFoundError extends Error {
    constructor();
}
export declare function parseLogRange(offsetParam?: string, limitParam?: string): {
    hasRange: boolean;
    offset: number;
    limit: number;
};
export declare function readJobLogs(bucket: R2Bucket, key: string, range: {
    hasRange: boolean;
    offset: number;
    limit: number;
}): Promise<{
    logs: string;
    offset: number;
    next_offset: number;
    has_more: boolean;
    total_size: number | null;
}>;
//# sourceMappingURL=logs.d.ts.map