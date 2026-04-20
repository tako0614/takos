import type { ToolDefinition, ToolHandler } from "../../tool-definitions.ts";
import { DeploymentService } from "../../../services/deployment/index.ts";
import { ServiceDesiredStateService } from "../../../services/platform/worker-desired-state.ts";
import { getDb, serviceDeployments } from "../../../../infra/db/index.ts";
import { and, eq } from "drizzle-orm";
import { resolveServiceReferenceRecord } from "../../../services/platform/workers.ts";

const MUTATION_ERROR =
  "Deployment artifacts are immutable. Update the service slot settings and create a new deployment instead.";

type WorkerRef =
  | { kind: "worker"; workerId: string; spaceId: string }
  | {
    kind: "deployment";
    workerId: string;
    spaceId: string;
    deploymentId: string;
  };

async function resolveWorkerRef(
  workerIdentifier: string,
  context: Parameters<ToolHandler>[1],
): Promise<WorkerRef> {
  const db = getDb(context.db);

  const workerRow = await resolveServiceReferenceRecord(
    context.db,
    context.spaceId,
    workerIdentifier,
  );

  if (workerRow) {
    return {
      kind: "worker",
      workerId: workerRow.id,
      spaceId: workerRow.accountId,
    };
  }

  const deploymentRow = await db.select({
    id: serviceDeployments.id,
    workerId: serviceDeployments.serviceId,
    accountId: serviceDeployments.accountId,
  })
    .from(serviceDeployments)
    .where(
      and(
        eq(serviceDeployments.accountId, context.spaceId),
        eq(serviceDeployments.artifactRef, workerIdentifier),
      ),
    )
    .get();

  if (deploymentRow) {
    return {
      kind: "deployment",
      workerId: deploymentRow.workerId,
      spaceId: deploymentRow.accountId,
      deploymentId: deploymentRow.id,
    };
  }

  throw new Error(`Service not found: ${workerIdentifier}`);
}

function describeLocalEnv(
  envVars: Array<{ name: string; type: "plain_text" | "secret_text" }>,
  workerIdentifier: string,
): string {
  if (envVars.length === 0) {
    return `No environment variables found for service: ${workerIdentifier}`;
  }

  const lines = envVars.map((variable) => {
    const icon = variable.type === "secret_text" ? "🔒" : "📝";
    return `${icon} ${variable.name} (${variable.type})`;
  });

  return `Environment variables for ${workerIdentifier}:\n${lines.join("\n")}`;
}

function describeRuntimeConfig(
  runtimeConfig: {
    compatibility_date?: string;
    compatibility_flags?: string[];
    limits?: { cpu_ms?: number; subrequests?: number };
  },
  workerIdentifier: string,
): string {
  let output = `Runtime configuration for service ${workerIdentifier}:\n`;
  output += `Compatibility Date: ${
    runtimeConfig.compatibility_date || "not set"
  }\n`;
  output += `Compatibility Flags: ${
    runtimeConfig.compatibility_flags?.join(", ") || "none"
  }\n`;
  output += `CPU Limit: ${runtimeConfig.limits?.cpu_ms || "default"} ms`;
  return output;
}

export const WORKER_ENV_GET: ToolDefinition = {
  name: "service_env_get",
  description:
    "Get environment variables for a service slot or deployment artifact",
  category: "deploy",
  parameters: {
    type: "object",
    properties: {
      service_name: {
        type: "string",
        description: "Stable service slot name or deployment artifact ref",
      },
    },
    required: ["service_name"],
  },
};

export const WORKER_ENV_SET: ToolDefinition = {
  name: "service_env_set",
  description:
    "Replace environment variables for a service slot. Applies on the next deployment.",
  category: "deploy",
  parameters: {
    type: "object",
    properties: {
      service_name: {
        type: "string",
        description: "Stable service slot name",
      },
      env: {
        type: "array",
        description: "Environment variables to set",
        items: {
          type: "object",
          description: "Environment variable",
          properties: {
            name: {
              type: "string",
              description: "Variable name (e.g., API_KEY)",
            },
            value: { type: "string", description: "Variable value" },
            type: {
              type: "string",
              description: "Type: plain_text or secret_text",
              enum: ["plain_text", "secret_text"],
            },
          },
          required: ["name", "value"],
        },
      },
    },
    required: ["service_name", "env"],
  },
};

export const WORKER_RUNTIME_GET: ToolDefinition = {
  name: "service_runtime_get",
  description:
    "Get runtime configuration for a service slot or deployment artifact",
  category: "deploy",
  parameters: {
    type: "object",
    properties: {
      service_name: {
        type: "string",
        description: "Stable service slot name or deployment artifact ref",
      },
    },
    required: ["service_name"],
  },
};

export const WORKER_RUNTIME_SET: ToolDefinition = {
  name: "service_runtime_set",
  description:
    "Set runtime configuration for a service slot. Applies on the next deployment.",
  category: "deploy",
  parameters: {
    type: "object",
    properties: {
      service_name: {
        type: "string",
        description: "Stable service slot name",
      },
      compatibility_date: {
        type: "string",
        description: "Compatibility date (e.g., 2024-01-01)",
      },
      compatibility_flags: {
        type: "array",
        description: "Compatibility flags (e.g., nodejs_compat)",
        items: { type: "string", description: "Flag name" },
      },
      cpu_ms: {
        type: "number",
        description: "CPU time limit in milliseconds (10-30000)",
      },
    },
    required: ["service_name"],
  },
};

export const workerEnvGetHandler: ToolHandler = async (args, context) => {
  const workerIdentifier = args.service_name as string;
  const ref = await resolveWorkerRef(workerIdentifier, context);

  if (ref.kind === "worker") {
    const desiredState = new ServiceDesiredStateService(context.env);
    const envVars = await desiredState.listLocalEnvVarSummaries(
      ref.spaceId,
      ref.workerId,
    );
    return describeLocalEnv(envVars, workerIdentifier);
  }

  const deploymentService = new DeploymentService(context.env);
  const deployment = await deploymentService.getDeploymentById(
    ref.deploymentId,
  );
  if (!deployment) {
    throw new Error(`Deployment not found for artifact: ${workerIdentifier}`);
  }
  const bindings = await deploymentService.getBindings(deployment);
  const envVars = bindings
    .filter((
      binding,
    ): binding is typeof binding & { type: "plain_text" | "secret_text" } => (
      binding.type === "plain_text" || binding.type === "secret_text"
    ))
    .map((binding) => ({ name: binding.name, type: binding.type }));
  return describeLocalEnv(envVars, workerIdentifier);
};

export const workerEnvSetHandler: ToolHandler = async (args, context) => {
  const workerIdentifier = args.service_name as string;
  const envList = args.env as Array<
    { name: string; value: string; type?: string }
  >;
  const ref = await resolveWorkerRef(workerIdentifier, context);

  if (ref.kind === "deployment") {
    throw new Error(MUTATION_ERROR);
  }

  const desiredState = new ServiceDesiredStateService(context.env);
  await desiredState.replaceLocalEnvVars({
    spaceId: ref.spaceId,
    workerId: ref.workerId,
    variables: envList.map((entry) => ({
      name: entry.name,
      value: entry.value,
      secret: entry.type === "secret_text",
    })),
  });

  return `Saved ${envList.length} environment variable(s) for service slot: ${workerIdentifier}. Applies on the next deployment.`;
};

export const workerRuntimeGetHandler: ToolHandler = async (args, context) => {
  const workerIdentifier = args.service_name as string;
  const ref = await resolveWorkerRef(workerIdentifier, context);

  if (ref.kind === "worker") {
    const desiredState = new ServiceDesiredStateService(context.env);
    const runtimeConfig = await desiredState.getRuntimeConfig(
      ref.spaceId,
      ref.workerId,
    );
    return describeRuntimeConfig(runtimeConfig, workerIdentifier);
  }

  const deploymentService = new DeploymentService(context.env);
  const deployment = await deploymentService.getDeploymentById(
    ref.deploymentId,
  );
  if (!deployment) {
    throw new Error(`Deployment not found for artifact: ${workerIdentifier}`);
  }
  const runtimeConfig = safeJsonParseRuntimeConfig(
    deployment.runtime_config_snapshot_json,
  );
  return describeRuntimeConfig(runtimeConfig, workerIdentifier);
};

function safeJsonParseRuntimeConfig(raw: string | null | undefined): {
  compatibility_date?: string;
  compatibility_flags?: string[];
  limits?: { cpu_ms?: number; subrequests?: number };
} {
  try {
    return raw
      ? JSON.parse(raw) as {
        compatibility_date?: string;
        compatibility_flags?: string[];
        limits?: { cpu_ms?: number; subrequests?: number };
      }
      : {};
  } catch {
    return {};
  }
}

export const workerRuntimeSetHandler: ToolHandler = async (args, context) => {
  const workerIdentifier = args.service_name as string;
  const compatibilityDate = args.compatibility_date as string | undefined;
  const compatibilityFlags = args.compatibility_flags as string[] | undefined;
  const cpuMs = args.cpu_ms as number | undefined;
  const ref = await resolveWorkerRef(workerIdentifier, context);

  if (ref.kind === "deployment") {
    throw new Error(MUTATION_ERROR);
  }

  const desiredState = new ServiceDesiredStateService(context.env);
  await desiredState.saveRuntimeConfig({
    spaceId: ref.spaceId,
    workerId: ref.workerId,
    compatibilityDate,
    compatibilityFlags,
    limits: cpuMs ? { cpu_ms: cpuMs } : undefined,
  });

  return `Updated runtime configuration for service slot: ${workerIdentifier}. Applies on the next deployment.`;
};

export const WORKER_SETTINGS_TOOLS: ToolDefinition[] = [
  WORKER_ENV_GET,
  WORKER_ENV_SET,
  WORKER_RUNTIME_GET,
  WORKER_RUNTIME_SET,
];

export const WORKER_SETTINGS_HANDLERS: Record<string, ToolHandler> = {
  service_env_get: workerEnvGetHandler,
  service_env_set: workerEnvSetHandler,
  service_runtime_get: workerRuntimeGetHandler,
  service_runtime_set: workerRuntimeSetHandler,
};
