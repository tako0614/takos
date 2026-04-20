// Security: S07 (object-store space-scoped), S08 (SQL safe queries), S09 (key-value namespace-restricted)
import type { ToolDefinition, ToolHandler } from "../tool-definitions.ts";
import { KEY_VALUE_HANDLERS, KEY_VALUE_TOOLS } from "./storage/kv.ts";
import { SQL_HANDLERS, SQL_TOOLS } from "./storage/d1.ts";
import { OBJECT_STORE_HANDLERS, OBJECT_STORE_TOOLS } from "./storage/r2.ts";
import { RESOURCE_HANDLERS, RESOURCE_TOOLS } from "./storage/resources.ts";

export {
  KEY_VALUE_DELETE,
  KEY_VALUE_GET,
  KEY_VALUE_LIST,
  KEY_VALUE_PUT,
  keyValueDeleteHandler,
  keyValueGetHandler,
  keyValueListHandler,
  keyValuePutHandler,
} from "./storage/kv.ts";

export {
  SQL_DESCRIBE,
  SQL_QUERY,
  SQL_TABLES,
  sqlDescribeHandler,
  sqlQueryHandler,
  sqlTablesHandler,
} from "./storage/d1.ts";

export {
  OBJECT_STORE_DELETE,
  OBJECT_STORE_DOWNLOAD,
  OBJECT_STORE_INFO,
  OBJECT_STORE_LIST,
  OBJECT_STORE_UPLOAD,
  objectStoreDeleteHandler,
  objectStoreDownloadHandler,
  objectStoreInfoHandler,
  objectStoreListHandler,
  objectStoreUploadHandler,
} from "./storage/r2.ts";

export {
  CREATE_KEY_VALUE,
  CREATE_OBJECT_STORE,
  CREATE_SQL,
  createKeyValueHandler,
  createObjectStoreHandler,
  createSqlHandler,
  LIST_RESOURCES,
  listResourcesHandler,
  storageResourceToolDeps,
} from "./storage/resources.ts";

export const STORAGE_TOOLS: ToolDefinition[] = [
  ...KEY_VALUE_TOOLS,
  ...SQL_TOOLS,
  ...OBJECT_STORE_TOOLS,
  ...RESOURCE_TOOLS,
];

export const STORAGE_HANDLERS: Record<string, ToolHandler> = {
  ...KEY_VALUE_HANDLERS,
  ...SQL_HANDLERS,
  ...OBJECT_STORE_HANDLERS,
  ...RESOURCE_HANDLERS,
};
