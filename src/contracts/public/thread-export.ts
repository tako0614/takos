export const THREAD_EXPORT_FORMATS = ["markdown", "md", "json"] as const;

export type ThreadExportFormat = (typeof THREAD_EXPORT_FORMATS)[number];
export type ThreadExportDownloadFormat = Exclude<ThreadExportFormat, "md">;

// Direct export is intentionally finite. Above this boundary the product must
// move to an assisted/asynchronous artifact path instead of returning a
// partial file or exhausting one request's Worker/R2 budget.
export const MAX_DIRECT_THREAD_EXPORT_MESSAGES = 500;
export const MAX_DIRECT_THREAD_EXPORT_OFFLOAD_OBJECTS = 64;
export const MAX_DIRECT_THREAD_EXPORT_BODY_BYTES = 16 * 1024 * 1024;
