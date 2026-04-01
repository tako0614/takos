import type { ToolDefinition, ToolHandler } from "../../tool-definitions.ts";
import { createCloudflareApiClient } from "../../../../platform/providers/cloudflare/api-client.ts";
import { createOptionalCloudflareWfpProvider } from "../../../../platform/providers/cloudflare/wfp.ts";
import { generateId } from "../../../../shared/utils/index.ts";
import { getDb, resources } from "../../../../infra/db/index.ts";

export const CREATE_D1: ToolDefinition = {
  name: "create_d1",
  description: "Create a new D1 database",
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

export const CREATE_KV: ToolDefinition = {
  name: "create_kv",
  description: "Create a new KV namespace",
  category: "storage",
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Namespace title",
      },
    },
    required: ["title"],
  },
};

export const CREATE_R2: ToolDefinition = {
  name: "create_r2",
  description: "Create a new R2 bucket",
  category: "storage",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Bucket name (lowercase, alphanumeric, hyphens)",
      },
    },
    required: ["name"],
  },
};

export const LIST_RESOURCES: ToolDefinition = {
  name: "list_resources",
  description:
    "List all D1 databases, KV namespaces, and R2 buckets in the account",
  category: "storage",
  parameters: {
    type: "object",
    properties: {
      type: {
        type: "string",
        description:
          "Resource type to list (optional, lists all if not specified)",
        enum: ["d1", "kv", "r2"],
      },
    },
  },
};

export const createD1Handler: ToolHandler = async (args, context) => {
  const name = args.name as string;
  const schema = args.schema as string | undefined;

  const { env, userId, spaceId } = context;
  const wfp = createOptionalCloudflareWfpProvider(env);
  if (!wfp) {
    throw new Error("Cloudflare WFP is not configured");
  }

  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name) || name.length < 3) {
    throw new Error(
      "Invalid database name. Must be 3+ chars, lowercase alphanumeric with hyphens.",
    );
  }

  const providerResourceName = `takos-d1-${generateId()}`;
  const databaseId = await wfp.d1.createD1Database(providerResourceName);

  const resourceId = generateId();
  const db = getDb(env.DB);
  await db.insert(resources).values({
    id: resourceId,
    ownerAccountId: userId,
    accountId: spaceId,
    name: name,
    type: "d1",
    semanticType: "sql",
    driver: "cloudflare-d1",
    providerName: "cloudflare",
    status: "active",
    providerResourceId: databaseId,
    providerResourceName,
    config: "{}",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  let output = `D1 Database created!\n`;
  output += `Name: ${name}\n`;
  output += `ID: ${databaseId}\n`;

  if (schema) {
    try {
      await wfp.d1.runD1SQL(databaseId, schema);
      output += `\nSchema applied successfully.`;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      output += `\nWarning: Schema failed to apply: ${errorMsg}`;
    }
  }

  output += `\n\nDatabase ID: ${databaseId}`;
  output +=
    `\nUse with CLI: takos api post /api/spaces/<spaceId>/resources --body '{"type":"d1","name":"<name>"}'`;

  return output;
};

export const createKVHandler: ToolHandler = async (args, context) => {
  const title = args.title as string;

  const { env, userId, spaceId } = context;
  const wfp = createOptionalCloudflareWfpProvider(env);
  if (!wfp) {
    throw new Error("Cloudflare WFP is not configured");
  }

  const providerResourceName = `takos-kv-${generateId()}`;
  const namespaceId = await wfp.kv.createKVNamespace(providerResourceName);

  const resourceId = generateId();
  const db = getDb(env.DB);
  await db.insert(resources).values({
    id: resourceId,
    ownerAccountId: userId,
    accountId: spaceId,
    name: title,
    type: "kv",
    semanticType: "kv",
    driver: "cloudflare-kv",
    providerName: "cloudflare",
    status: "active",
    providerResourceId: namespaceId,
    providerResourceName,
    config: "{}",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  let output = `KV Namespace created!\n`;
  output += `Title: ${title}\n`;
  output += `ID: ${namespaceId}`;
  output +=
    `\nUse with CLI: takos api post /api/spaces/<spaceId>/resources --body '{"type":"kv","name":"<name>"}'`;

  return output;
};

export const createR2Handler: ToolHandler = async (args, context) => {
  const name = args.name as string;

  const { env, userId, spaceId } = context;
  const wfp = createOptionalCloudflareWfpProvider(env);
  if (!wfp) {
    throw new Error("Cloudflare WFP is not configured");
  }

  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name) || name.length < 3) {
    throw new Error(
      "Invalid bucket name. Must be 3+ chars, lowercase alphanumeric with hyphens.",
    );
  }

  const providerResourceName = `takos-r2-${generateId()}`;
  await wfp.r2.createR2Bucket(providerResourceName);

  const resourceId = generateId();
  const db = getDb(env.DB);
  await db.insert(resources).values({
    id: resourceId,
    ownerAccountId: userId,
    accountId: spaceId,
    name: name,
    type: "r2",
    semanticType: "object_store",
    driver: "cloudflare-r2",
    providerName: "cloudflare",
    status: "active",
    providerResourceId: providerResourceName,
    providerResourceName,
    config: "{}",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  let output = `R2 Bucket created!\n`;
  output += `Name: ${name}`;
  output +=
    `\nUse with CLI: takos api post /api/spaces/<spaceId>/resources --body '{"type":"r2","name":"<name>"}'`;

  return output;
};

export const listResourcesHandler: ToolHandler = async (args, context) => {
  const resourceType = args.type as string | undefined;

  const { env } = context;

  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) {
    throw new Error("Cloudflare credentials not configured");
  }

  const cfClient = createCloudflareApiClient(env);
  if (!cfClient) {
    throw new Error("Cloudflare credentials not configured");
  }

  let output = "";

  if (!resourceType || resourceType === "d1") {
    const d1Data = await cfClient.accountGet<
      Array<{ uuid: string; name: string; created_at: string }>
    >(
      "/d1/database",
    );

    output += `D1 Databases:\n`;
    if (d1Data && d1Data.length > 0) {
      for (const db of d1Data.slice(0, 20)) {
        output += `  - ${db.name} (${db.uuid})\n`;
      }
      if (d1Data.length > 20) {
        output += `  ... and ${d1Data.length - 20} more\n`;
      }
    } else {
      output += `  (none)\n`;
    }
    output += "\n";
  }

  if (!resourceType || resourceType === "kv") {
    const kvData = await cfClient.accountGet<
      Array<{ id: string; title: string }>
    >(
      "/storage/kv/namespaces",
    );

    output += `KV Namespaces:\n`;
    if (kvData && kvData.length > 0) {
      for (const ns of kvData.slice(0, 20)) {
        output += `  - ${ns.title} (${ns.id})\n`;
      }
      if (kvData.length > 20) {
        output += `  ... and ${kvData.length - 20} more\n`;
      }
    } else {
      output += `  (none)\n`;
    }
    output += "\n";
  }

  if (!resourceType || resourceType === "r2") {
    const r2Data = await cfClient.accountGet<Array<{ name: string }>>(
      "/r2/buckets",
    );

    output += `R2 Buckets:\n`;
    if (r2Data && r2Data.length > 0) {
      for (const bucket of r2Data.slice(0, 20)) {
        output += `  - ${bucket.name}\n`;
      }
      if (r2Data.length > 20) {
        output += `  ... and ${r2Data.length - 20} more\n`;
      }
    } else {
      output += `  (none)\n`;
    }
  }

  return output.trim();
};

export const RESOURCE_TOOLS: ToolDefinition[] = [
  CREATE_D1,
  CREATE_KV,
  CREATE_R2,
  LIST_RESOURCES,
];

export const RESOURCE_HANDLERS: Record<string, ToolHandler> = {
  create_d1: createD1Handler,
  create_kv: createKVHandler,
  create_r2: createR2Handler,
  list_resources: listResourcesHandler,
};
