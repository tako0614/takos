// ============================================================
// parse-storage.ts
// ============================================================
//
// Flat-schema storage parser (Phase 1).
//
// Walks `storage.<name>` entries in the top-level manifest and
// builds a `Record<string, AppStorage>`. Replaces the old
// `parseResources` (which used `spec.resources` with Cloudflare
// type names like d1/r2/kv).
//
// New canonical storage types:
//   - sql
//   - object-store
//   - key-value
//   - queue
//   - vector-index
//   - secret
//   - analytics-engine
//   - workflow
//   - durable-object
//
// Binding names default to the storage name normalized as
//   hyphen → underscore, upper-cased (e.g. `my-db` → `MY_DB`).
// ============================================================

import type { AppStorage, StorageType } from "../app-manifest-types.ts";
import {
  asOptionalInteger,
  asRecord,
  asRequiredString,
  asString,
  normalizeRepoPath,
} from "../app-manifest-utils.ts";
import { validateVectorIndexMetric } from "../app-manifest-validation.ts";

const STORAGE_TYPES: readonly StorageType[] = [
  "sql",
  "object-store",
  "key-value",
  "queue",
  "vector-index",
  "secret",
  "analytics-engine",
  "workflow",
  "durable-object",
];

function isStorageType(value: string): value is StorageType {
  return (STORAGE_TYPES as readonly string[]).includes(value);
}

function defaultBindingName(storageName: string): string {
  return storageName.replace(/-/g, "_").toUpperCase();
}

function parseSqlStorage(
  prefix: string,
  record: Record<string, unknown>,
): Pick<AppStorage, "migrations"> {
  const migrations = asString(record.migrations, `${prefix}.migrations`);
  return {
    ...(migrations ? { migrations: normalizeRepoPath(migrations) } : {}),
  };
}

function parseQueueStorage(
  prefix: string,
  record: Record<string, unknown>,
): Pick<AppStorage, "queue"> {
  if (record.queue == null) return {};
  const queueRecord = asRecord(record.queue);
  const maxRetries = asOptionalInteger(
    queueRecord.maxRetries,
    `${prefix}.queue.maxRetries`,
    { min: 0 },
  );
  const deadLetterQueue = asString(
    queueRecord.deadLetterQueue,
    `${prefix}.queue.deadLetterQueue`,
  );
  const queue: NonNullable<AppStorage["queue"]> = {
    ...(maxRetries != null ? { maxRetries } : {}),
    ...(deadLetterQueue ? { deadLetterQueue } : {}),
  };
  return Object.keys(queue).length > 0 ? { queue } : {};
}

function parseVectorIndexStorage(
  prefix: string,
  record: Record<string, unknown>,
): Pick<AppStorage, "vectorIndex"> {
  if (record.vectorIndex == null) return {};
  const vectorRecord = asRecord(record.vectorIndex);
  const dimensions = asOptionalInteger(
    vectorRecord.dimensions,
    `${prefix}.vectorIndex.dimensions`,
    { min: 1 },
  );
  const metric = vectorRecord.metric != null
    ? validateVectorIndexMetric(
      vectorRecord.metric,
      `${prefix}.vectorIndex.metric`,
    )
    : undefined;
  const vectorIndex: NonNullable<AppStorage["vectorIndex"]> = {
    ...(dimensions != null ? { dimensions } : {}),
    ...(metric ? { metric } : {}),
  };
  return Object.keys(vectorIndex).length > 0 ? { vectorIndex } : {};
}

function parseSecretStorage(
  _prefix: string,
  record: Record<string, unknown>,
): Pick<AppStorage, "generate"> {
  return record.generate === true ? { generate: true } : {};
}

function parseWorkflowStorage(
  prefix: string,
  record: Record<string, unknown>,
): Pick<AppStorage, "workflow"> {
  const workflowRecord = asRecord(record.workflow);
  if (Object.keys(workflowRecord).length === 0) {
    throw new Error(`${prefix}.workflow is required for workflow storage`);
  }
  return {
    workflow: {
      class: asRequiredString(
        workflowRecord.class,
        `${prefix}.workflow.class`,
      ),
      script: asRequiredString(
        workflowRecord.script,
        `${prefix}.workflow.script`,
      ),
    },
  };
}

function parseDurableObjectStorage(
  prefix: string,
  record: Record<string, unknown>,
): Pick<AppStorage, "durableObject"> {
  const doRecord = asRecord(record.durableObject);
  if (Object.keys(doRecord).length === 0) {
    throw new Error(
      `${prefix}.durableObject is required for durable-object storage`,
    );
  }
  return {
    durableObject: {
      class: asRequiredString(
        doRecord.class,
        `${prefix}.durableObject.class`,
      ),
      script: asRequiredString(
        doRecord.script,
        `${prefix}.durableObject.script`,
      ),
    },
  };
}

function parseStorageEntry(
  storageName: string,
  raw: unknown,
): AppStorage {
  const prefix = `storage.${storageName}`;
  const record = asRecord(raw);
  const rawType = asRequiredString(record.type, `${prefix}.type`);
  if (!isStorageType(rawType)) {
    throw new Error(
      `${prefix}.type must be one of ${STORAGE_TYPES.join("/")} (got: ${rawType})`,
    );
  }
  const type = rawType;
  const bindRaw = asString(record.bind, `${prefix}.bind`);
  const bind = bindRaw ?? defaultBindingName(storageName);

  const base: AppStorage = { type, bind };

  switch (type) {
    case "sql":
      return { ...base, ...parseSqlStorage(prefix, record) };
    case "queue":
      return { ...base, ...parseQueueStorage(prefix, record) };
    case "vector-index":
      return { ...base, ...parseVectorIndexStorage(prefix, record) };
    case "secret":
      return { ...base, ...parseSecretStorage(prefix, record) };
    case "workflow":
      return { ...base, ...parseWorkflowStorage(prefix, record) };
    case "durable-object":
      return { ...base, ...parseDurableObjectStorage(prefix, record) };
    case "object-store":
    case "key-value":
    case "analytics-engine":
      return base;
  }
}

// ============================================================
// Cross-entry validation
// ============================================================

function validateStorageCrossRefs(
  storages: Record<string, AppStorage>,
): void {
  for (const [name, storage] of Object.entries(storages)) {
    if (storage.type === "queue" && storage.queue?.deadLetterQueue) {
      const target = storages[storage.queue.deadLetterQueue];
      if (!target || target.type !== "queue") {
        throw new Error(
          `storage.${name}.queue.deadLetterQueue must reference a queue storage (got: ${storage.queue.deadLetterQueue})`,
        );
      }
    }
  }
}

// ============================================================
// Top-level storage walker
// ============================================================

export function parseStorage(
  topLevel: Record<string, unknown>,
): Record<string, AppStorage> {
  if (topLevel.storage == null) {
    return {};
  }
  const storageRecord = asRecord(topLevel.storage);
  const result: Record<string, AppStorage> = {};
  for (const [name, value] of Object.entries(storageRecord)) {
    result[name] = parseStorageEntry(name, value);
  }
  validateStorageCrossRefs(result);
  return result;
}
