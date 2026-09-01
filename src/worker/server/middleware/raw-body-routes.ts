/**
 * API routes whose request bodies are raw bytes rather than structured forms.
 *
 * Keep this list narrow: matching routes bypass the general JSON/form content
 * type and 1 MiB body gates, then install their own route-specific limit.
 */
export const RAW_STORAGE_UPLOAD_PATHS = [
  /^\/api\/spaces\/[^/]+\/storage\/upload\/[^/]+$/,
];
