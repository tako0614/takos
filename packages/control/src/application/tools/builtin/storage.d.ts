import type { ToolDefinition, ToolHandler } from '../tool-definitions';
export { KV_GET, KV_PUT, KV_DELETE, KV_LIST, kvGetHandler, kvPutHandler, kvDeleteHandler, kvListHandler, } from './storage/kv';
export { D1_QUERY, D1_TABLES, D1_DESCRIBE, d1QueryHandler, d1TablesHandler, d1DescribeHandler, } from './storage/d1';
export { R2_UPLOAD, R2_DOWNLOAD, R2_LIST, R2_DELETE, R2_INFO, r2UploadHandler, r2DownloadHandler, r2ListHandler, r2DeleteHandler, r2InfoHandler, } from './storage/r2';
export { CREATE_D1, CREATE_KV, CREATE_R2, LIST_RESOURCES, createD1Handler, createKVHandler, createR2Handler, listResourcesHandler, } from './storage/resources';
export declare const STORAGE_TOOLS: ToolDefinition[];
export declare const STORAGE_HANDLERS: Record<string, ToolHandler>;
//# sourceMappingURL=storage.d.ts.map