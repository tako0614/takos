import { and, eq, sql } from "drizzle-orm";

import {
  getDb,
  serviceBindings,
  serviceEnvVars,
} from "../../../../infra/db/index.ts";
import type { SqlDatabaseBinding } from "../../../../shared/types/bindings.ts";
import type { Env } from "../../../../shared/types/index.ts";
import type { ServiceEnvRow } from "../desired-state-types.ts";
import {
  decryptServiceEnvRow,
  requireEncryptionKey,
} from "../env-state-resolution.ts";
import type { PublicationRecord } from "../service-publications.ts";
import { toResourceCapability } from "../../resources/capabilities.ts";
import { getPortableSecretValue } from "../../resources/portable-runtime.ts";
import { getResourceById } from "../../resources/store.ts";
import { normalizeEnvName } from "../../common-env/crypto.ts";

export const mcpAuthSecretDeps = {
  getDb,
  getResourceById,
  getPortableSecretValue,
};

function nonEmptyToken(value: string | null | undefined): string | null {
  return value && value.length > 0 ? value : null;
}

export function readPublicationAuthSecretRef(
  record: Pick<PublicationRecord, "publication">,
): string | null {
  const auth = record.publication.auth;
  const raw = auth?.kind === "bearer"
    ? auth.secretRef
    : auth?.bearer?.secretRef;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? normalizeEnvName(trimmed) : null;
}

async function resolveServiceEnvToken(
  dbBinding: SqlDatabaseBinding,
  env: Pick<Env, "DB" | "ENCRYPTION_KEY" | "ADMIN_DOMAIN">,
  params: {
    spaceId: string;
    serviceId: string;
    envName: string;
  },
): Promise<string | null> {
  const db = mcpAuthSecretDeps.getDb(dbBinding);
  const row = await db.select({
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
      eq(serviceEnvVars.accountId, params.spaceId),
      eq(serviceEnvVars.serviceId, params.serviceId),
      eq(sql`UPPER(${serviceEnvVars.name})`, params.envName),
    ))
    .get();
  if (!row) return null;

  const decrypted = await decryptServiceEnvRow(
    requireEncryptionKey(env),
    row as ServiceEnvRow,
  );
  return nonEmptyToken(decrypted.value);
}

async function resolveSecretBindingToken(
  dbBinding: SqlDatabaseBinding,
  params: {
    serviceId: string;
    envName: string;
  },
): Promise<string | null> {
  const db = mcpAuthSecretDeps.getDb(dbBinding);
  const binding = await db.select({
    resourceId: serviceBindings.resourceId,
    bindingName: serviceBindings.bindingName,
  })
    .from(serviceBindings)
    .where(and(
      eq(serviceBindings.serviceId, params.serviceId),
      eq(sql`UPPER(${serviceBindings.bindingName})`, params.envName),
    ))
    .get();
  if (!binding) return null;

  const resource = await mcpAuthSecretDeps.getResourceById(
    dbBinding,
    binding.resourceId,
  );
  if (!resource || resource.status !== "active") return null;
  if (toResourceCapability(resource.type, resource.config) !== "secret") {
    return null;
  }

  if (resource.backend_name && resource.backend_name !== "cloudflare") {
    return nonEmptyToken(
      await mcpAuthSecretDeps.getPortableSecretValue({
        id: resource.id,
        backend_name: resource.backend_name,
        backing_resource_id: resource.backing_resource_id,
        backing_resource_name: resource.backing_resource_name,
        config: resource.config,
      }),
    );
  }
  return nonEmptyToken(resource.backing_resource_id);
}

export async function resolvePublicationAuthToken(
  dbBinding: SqlDatabaseBinding,
  env: Pick<Env, "DB" | "ENCRYPTION_KEY" | "ADMIN_DOMAIN">,
  params: {
    spaceId: string;
    publicationName: string;
    ownerServiceId: string | null;
    authSecretRef: string | null;
  },
): Promise<string | null> {
  if (!params.authSecretRef) return null;
  const envName = normalizeEnvName(params.authSecretRef);
  if (!params.ownerServiceId) {
    throw new Error(
      `MCP publication '${params.publicationName}' declares bearer auth secretRef but has no owner service`,
    );
  }

  const envToken = await resolveServiceEnvToken(dbBinding, env, {
    spaceId: params.spaceId,
    serviceId: params.ownerServiceId,
    envName,
  });
  if (envToken) return envToken;

  const bindingToken = await resolveSecretBindingToken(dbBinding, {
    serviceId: params.ownerServiceId,
    envName,
  });
  if (bindingToken) return bindingToken;

  throw new Error(
    `MCP publication '${params.publicationName}' bearer auth secretRef '${envName}' was not found in service env or secret bindings`,
  );
}
