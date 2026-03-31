// Security: S07 (R2 workspace-scoped), S08 (D1 safe queries), S09 (KV namespace-restricted)
import type { ToolDefinition, ToolHandler } from '../tool-definitions.ts';
import { KV_TOOLS, KV_HANDLERS } from './storage/kv.ts';
import { D1_TOOLS, D1_HANDLERS } from './storage/d1.ts';
import { R2_TOOLS, R2_HANDLERS } from './storage/r2.ts';
import { RESOURCE_TOOLS, RESOURCE_HANDLERS } from './storage/resources.ts';

export {
  KV_GET,
  KV_PUT,
  KV_DELETE,
  KV_LIST,
  kvGetHandler,
  kvPutHandler,
  kvDeleteHandler,
  kvListHandler,
} from './storage/kv.ts';

export {
  D1_QUERY,
  D1_TABLES,
  D1_DESCRIBE,
  d1QueryHandler,
  d1TablesHandler,
  d1DescribeHandler,
} from './storage/d1.ts';

export {
  R2_UPLOAD,
  R2_DOWNLOAD,
  R2_LIST,
  R2_DELETE,
  R2_INFO,
  r2UploadHandler,
  r2DownloadHandler,
  r2ListHandler,
  r2DeleteHandler,
  r2InfoHandler,
} from './storage/r2.ts';

export {
  CREATE_D1,
  CREATE_KV,
  CREATE_R2,
  LIST_RESOURCES,
  createD1Handler,
  createKVHandler,
  createR2Handler,
  listResourcesHandler,
} from './storage/resources.ts';

export const STORAGE_TOOLS: ToolDefinition[] = [
  ...KV_TOOLS,
  ...D1_TOOLS,
  ...R2_TOOLS,
  ...RESOURCE_TOOLS,
];

export const STORAGE_HANDLERS: Record<string, ToolHandler> = {
  ...KV_HANDLERS,
  ...D1_HANDLERS,
  ...R2_HANDLERS,
  ...RESOURCE_HANDLERS,
};
