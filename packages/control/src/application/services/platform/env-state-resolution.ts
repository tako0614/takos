import type { WorkerBinding } from "../../../platform/providers/cloudflare/wfp.ts";
import { ConflictError, InternalError } from "takos-common/errors";
import { decrypt, type EncryptedData } from "../../../shared/utils/crypto.ts";
import { resolveServiceConsumeEnvVars } from "./service-publications.ts";
import { getDb, serviceEnvVars } from "../../../infra/db/index.ts";
import { and, desc, eq } from "drizzle-orm";
import { sortBindings } from "./resource-bindings.ts";
import type {
  DesiredStateEnv,
  ServiceDesiredStateSnapshot,
  ServiceEnvRow,
  ServiceLocalEnvVarState,
} from "./desired-state-types.ts";

function normalizeEnvName(name: string): string {
  const normalized = String(name || "").trim();
  if (!normalized) {
    throw new Error("Environment variable name is required");
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) {
    throw new Error(`Invalid environment variable name: ${normalized}`);
  }
  return normalized.toUpperCase();
}

export function requireEncryptionKey(env: DesiredStateEnv): string {
  const key = env.ENCRYPTION_KEY || "";
  if (!key) {
    throw new InternalError("ENCRYPTION_KEY must be set");
  }
  return key;
}

export function buildServiceEnvSalt(
  serviceId: string,
  envName: string,
): string {
  return `service-env:${serviceId}:${normalizeEnvName(envName)}`;
}

export async function decryptServiceEnvRow(
  encryptionKey: string,
  row: ServiceEnvRow,
): Promise<ServiceLocalEnvVarState> {
  let encrypted: EncryptedData;
  try {
    encrypted = JSON.parse(row.valueEncrypted) as EncryptedData;
  } catch (err) {
    throw new Error(
      `Failed to parse encrypted env var "${row.name}" for service ${row.serviceId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  const value = await decrypt(
    encrypted,
    encryptionKey,
    buildServiceEnvSalt(row.serviceId, row.name),
  );
  return {
    name: normalizeEnvName(row.name),
    value,
    secret: row.isSecret,
    updated_at: row.updatedAt,
  };
}

export async function resolveServiceCommonEnvState(
  env: DesiredStateEnv,
  spaceId: string,
  serviceId: string,
): Promise<{
  envBindings: WorkerBinding[];
  envVars: Record<string, string>;
  localEnvVars: ServiceLocalEnvVarState[];
  commonEnvUpdates: ServiceDesiredStateSnapshot["commonEnvUpdates"];
}> {
  const encryptionKey = requireEncryptionKey(env);
  const db = getDb(env.DB);

  const envRows = await db.select({
    id: serviceEnvVars.id,
    serviceId: serviceEnvVars.serviceId,
    accountId: serviceEnvVars.accountId,
    name: serviceEnvVars.name,
    valueEncrypted: serviceEnvVars.valueEncrypted,
    isSecret: serviceEnvVars.isSecret,
    updatedAt: serviceEnvVars.updatedAt,
  })
    .from(serviceEnvVars)
    .where(and(
      eq(serviceEnvVars.accountId, spaceId),
      eq(serviceEnvVars.serviceId, serviceId),
    ))
    .orderBy(desc(serviceEnvVars.updatedAt), serviceEnvVars.name)
    .all();

  const localEnvVars = await Promise.all(
    envRows.map((row) =>
      decryptServiceEnvRow(encryptionKey, row as ServiceEnvRow)
    ),
  );

  const envBindingMap = new Map<string, WorkerBinding>();
  for (const row of localEnvVars) {
    envBindingMap.set(row.name, {
      type: row.secret ? "secret_text" : "plain_text",
      name: row.name,
      text: row.value,
    });
  }

  const publicationEnvVars = await resolveServiceConsumeEnvVars(env, {
    spaceId,
    serviceId,
  });

  for (const publicationEnv of publicationEnvVars) {
    if (envBindingMap.has(publicationEnv.name)) {
      throw new ConflictError(
        `Consumed publication env collides with existing env binding: ${publicationEnv.name}`,
      );
    }
    envBindingMap.set(publicationEnv.name, {
      type: publicationEnv.secret ? "secret_text" : "plain_text",
      name: publicationEnv.name,
      text: publicationEnv.value,
    });
  }

  const envBindings = sortBindings(Array.from(envBindingMap.values()));
  const envVars: Record<string, string> = {};
  for (const binding of envBindings) {
    if (binding.type === "plain_text" || binding.type === "secret_text") {
      envVars[binding.name] = binding.text ?? "";
    }
  }

  return {
    envBindings,
    envVars,
    localEnvVars,
    commonEnvUpdates: [],
  };
}
