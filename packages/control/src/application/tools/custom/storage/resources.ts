import type { ToolDefinition, ToolHandler } from "../../tool-definitions.ts";
import { generateId } from "../../../../shared/utils/index.ts";
import { getDb, resources } from "../../../../infra/db/index.ts";
import { and, asc, eq, ne } from "drizzle-orm";
import type { ResourceCapability } from "../../../../shared/types/index.ts";
import { toResourceCapability } from "../../../services/resources/capabilities.ts";
import { provisionManagedResource } from "../../../services/resources/lifecycle.ts";

type StorageResourcePublicType = "sql" | "key-value" | "object-store";
type ProvisionManagedResourceInput = Parameters<
  typeof provisionManagedResource
>[
  1
];

const STORAGE_CAPABILITY_BY_PUBLIC_TYPE: Record<
  StorageResourcePublicType,
  ResourceCapability
> = {
  "sql": "sql",
  "key-value": "kv",
  "object-store": "object_store",
};

const STORAGE_PUBLIC_TYPE_BY_CAPABILITY: Partial<
  Record<ResourceCapability, StorageResourcePublicType>
> = {
  sql: "sql",
  kv: "key-value",
  object_store: "object-store",
};

export const CREATE_SQL: ToolDefinition = {
  name: "create_sql",
  description: "Create a new SQL database resource",
  category: "storage",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Database name (lowercase, alphanumeric, hyphens)",
      },
      schema: {
        type: "string",
        description: "SQL schema to run after creation (optional)",
      },
    },
    required: ["name"],
  },
};

export const CREATE_KEY_VALUE: ToolDefinition = {
  name: "create_key_value",
  description: "Create a new key-value resource",
  category: "storage",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Resource name",
      },
    },
    required: ["name"],
  },
};

export const CREATE_OBJECT_STORE: ToolDefinition = {
  name: "create_object_store",
  description: "Create a new object-store resource",
  category: "storage",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Object-store name (lowercase, alphanumeric, hyphens)",
      },
    },
    required: ["name"],
  },
};

export const LIST_RESOURCES: ToolDefinition = {
  name: "list_resources",
  description: "List SQL, key-value, and object-store resources in the space",
  category: "storage",
  parameters: {
    type: "object",
    properties: {
      type: {
        type: "string",
        description:
          "Resource type to list (optional, lists all if not specified)",
        enum: ["sql", "key-value", "object-store"],
      },
    },
  },
};

export const storageResourceToolDeps = {
  getDb,
  provisionManagedResource,
};

function backingName(prefix: string): string {
  return `takos-${prefix}-${generateId()}`;
}

function toStorageResourcePublicType(
  capability: ResourceCapability | null,
): StorageResourcePublicType | null {
  return capability
    ? STORAGE_PUBLIC_TYPE_BY_CAPABILITY[capability] ?? null
    : null;
}

async function createPortableResource(
  context: Parameters<ToolHandler>[1],
  input: {
    name: string;
    publicType: StorageResourcePublicType;
    capability: ResourceCapability;
    backingPrefix: string;
  },
): Promise<{ backingResourceId: string | null; backingResourceName: string }> {
  const { env, userId, spaceId } = context;
  const created = await storageResourceToolDeps.provisionManagedResource(env, {
    ownerId: spaceId || userId,
    spaceId,
    name: input.name,
    type: input.capability,
    publicType: input.publicType as ProvisionManagedResourceInput["publicType"],
    semanticType: input.capability,
    backingResourceName: backingName(input.backingPrefix),
    config: {},
    recordFailure: true,
  });
  return {
    backingResourceId: created.backingResourceId,
    backingResourceName: created.backingResourceName,
  };
}

export const createSqlHandler: ToolHandler = async (args, context) => {
  const name = args.name as string;
  const schema = args.schema as string | undefined;

  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name) || name.length < 3) {
    throw new Error(
      "Invalid database name. Must be 3+ chars, lowercase alphanumeric with hyphens.",
    );
  }

  const created = await createPortableResource(context, {
    name: name,
    publicType: "sql",
    capability: "sql",
    backingPrefix: "sql",
  });

  let output = `SQL resource created!\n`;
  output += `Name: ${name}\n`;
  output += `ID: ${created.backingResourceId ?? created.backingResourceName}\n`;

  if (schema) {
    output +=
      `\nWarning: inline schema application is not supported by the portable resource API. Apply migrations through the SQL resource tooling.`;
  }

  output += `\n\nResource ID: ${
    created.backingResourceId ?? created.backingResourceName
  }`;
  output +=
    `\nUse with CLI: takos resource create <name> --type d1 --space <spaceId>`;

  return output;
};

export const createKeyValueHandler: ToolHandler = async (args, context) => {
  const name = args.name as string;

  const created = await createPortableResource(context, {
    name,
    publicType: "key-value",
    capability: "kv",
    backingPrefix: "key-value",
  });

  let output = `Key-value resource created!\n`;
  output += `Name: ${name}\n`;
  output += `ID: ${created.backingResourceId ?? created.backingResourceName}`;
  output +=
    `\nUse with CLI: takos resource create <name> --type kv --space <spaceId>`;

  return output;
};

export const createObjectStoreHandler: ToolHandler = async (args, context) => {
  const name = args.name as string;

  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name) || name.length < 3) {
    throw new Error(
      "Invalid object-store name. Must be 3+ chars, lowercase alphanumeric with hyphens.",
    );
  }

  const created = await createPortableResource(context, {
    name: name,
    publicType: "object-store",
    capability: "object_store",
    backingPrefix: "object-store",
  });

  let output = `Object-store resource created!\n`;
  output += `Name: ${name}\n`;
  output += `ID: ${created.backingResourceId ?? created.backingResourceName}`;
  output +=
    `\nUse with CLI: takos resource create <name> --type r2 --space <spaceId>`;

  return output;
};

export const listResourcesHandler: ToolHandler = async (args, context) => {
  const resourceType = args.type as StorageResourcePublicType | undefined;
  const requestedCapability = resourceType
    ? STORAGE_CAPABILITY_BY_PUBLIC_TYPE[resourceType]
    : null;
  if (resourceType && !requestedCapability) {
    throw new Error(`Unknown resource type: ${resourceType}`);
  }

  const db = storageResourceToolDeps.getDb(context.env.DB);
  const rows = await db.select({
    name: resources.name,
    type: resources.type,
    semanticType: resources.semanticType,
    backendName: resources.backendName,
    status: resources.status,
    backingResourceId: resources.backingResourceId,
    backingResourceName: resources.backingResourceName,
    config: resources.config,
    createdAt: resources.createdAt,
  })
    .from(resources)
    .where(and(
      eq(resources.accountId, context.spaceId),
      ne(resources.status, "deleted"),
    ))
    .orderBy(asc(resources.name))
    .all();

  const filtered = rows.filter((row) => {
    const capability = toResourceCapability(
      row.semanticType ?? row.type,
      row.config,
    );
    return toStorageResourcePublicType(capability) !== null &&
      (!requestedCapability || capability === requestedCapability);
  });

  if (filtered.length === 0) return "No resources found.";

  return filtered.slice(0, 50).map((row) => {
    const capability = toResourceCapability(
      row.semanticType ?? row.type,
      row.config,
    );
    const publicType = toStorageResourcePublicType(capability) ?? row.type;
    const backing = row.backingResourceId ?? row.backingResourceName ?? "-";
    return `- ${row.name} (${publicType}, ${
      row.backendName ?? "unknown"
    }, ${row.status}) ${backing}`;
  }).join("\n") +
    (filtered.length > 50 ? `\n... and ${filtered.length - 50} more` : "");
};

export const RESOURCE_TOOLS: ToolDefinition[] = [
  CREATE_SQL,
  CREATE_KEY_VALUE,
  CREATE_OBJECT_STORE,
  LIST_RESOURCES,
];

export const RESOURCE_HANDLERS: Record<string, ToolHandler> = {
  create_sql: createSqlHandler,
  create_key_value: createKeyValueHandler,
  create_object_store: createObjectStoreHandler,
  list_resources: listResourcesHandler,
};
