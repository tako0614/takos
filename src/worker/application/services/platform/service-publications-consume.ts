import { eq } from "drizzle-orm";
import { GoneError } from "@takos/worker-platform-utils/errors";

import type {
  AppConsume,
  AppPublication,
} from "../source/app-manifest-types.ts";
import { RESERVED_TAKOS_PUBLICATION_MESSAGE } from "../identity/takos-access-tokens.ts";
import { getDb, serviceConsumes } from "../../../infra/db/index.ts";
import type { Env } from "../../../shared/types/index.ts";
import {
  isReservedTakosPublicationSource,
  type PublicationOutputDescriptor,
} from "./service-publications-normalize.ts";
import {
  getPublicationRowByRef,
  getServiceGroupId,
  parseConsumeConfig,
  type PublicationRecord,
  type PublicationRow,
  type ServiceConsumeRow,
  toPublicationRecord,
  upsertServiceConsumeRow,
} from "./service-publications-db.ts";
import { resolveServiceGraphExportDefinition } from "./service-graph-exports.ts";

export type ConsumePublicationDefinition = {
  publication: AppPublication;
  outputs: PublicationOutputDescriptor[];
  record?: PublicationRecord;
};

export async function cleanupConsumeState(
  env: Pick<Env, "DB">,
  params: {
    spaceId: string;
    serviceId: string;
    publication: AppPublication;
    state: Record<string, unknown> | null;
  },
): Promise<void> {
  void env;
  void params;
  void params.state;
}

export async function syncConsumeState(
  env: Pick<Env, "DB" | "ENCRYPTION_KEY" | "ADMIN_DOMAIN">,
  params: {
    spaceId: string;
    serviceId: string;
    serviceName: string;
    publication: AppPublication;
    consumeRow?: ServiceConsumeRow;
  },
): Promise<Record<string, unknown>> {
  void env;
  void params;
  return {};
}

function resolveTakosSystemConsumeDefinition(
  _consume: AppConsume,
): ConsumePublicationDefinition {
  throw new GoneError(RESERVED_TAKOS_PUBLICATION_MESSAGE);
}

export async function resolveConsumePublicationDefinition(
  env: Pick<Env, "DB"> &
    Partial<Pick<Env, "ADMIN_DOMAIN" | "AUTH_PUBLIC_BASE_URL">>,
  params: {
    spaceId: string;
    consume: AppConsume;
    consumerGroupId?: string | null;
  },
): Promise<ConsumePublicationDefinition | null> {
  if (isReservedTakosPublicationSource(params.consume.publication)) {
    return resolveTakosSystemConsumeDefinition(params.consume);
  }
  const row = await getPublicationRowByRef(env, {
    spaceId: params.spaceId,
    ref: params.consume.publication,
    consumerGroupId: params.consumerGroupId,
  });
  if (!row) {
    return resolveServiceGraphExportDefinition(env, {
      spaceId: params.spaceId,
      name: params.consume.publication,
    });
  }
  const record = toPublicationRecord(row);
  return { publication: record.publication, outputs: record.outputs, record };
}

export async function syncConsumersForPublication(
  env: Pick<Env, "DB" | "ENCRYPTION_KEY" | "ADMIN_DOMAIN">,
  params: {
    spaceId: string;
    publication: PublicationRow;
  },
): Promise<void> {
  const db = getDb(env.DB);
  const publication = toPublicationRecord(params.publication);
  const rows = await db
    .select()
    .from(serviceConsumes)
    .where(eq(serviceConsumes.accountId, params.spaceId))
    .all();
  for (const row of rows) {
    const consume = parseConsumeConfig(row);
    const consumerGroupId = await getServiceGroupId(
      env,
      params.spaceId,
      row.serviceId,
    );
    const resolved = await getPublicationRowByRef(env, {
      spaceId: params.spaceId,
      ref: consume.publication,
      consumerGroupId,
    });
    if (resolved?.id !== params.publication.id) continue;
    const state = await syncConsumeState(env, {
      spaceId: params.spaceId,
      serviceId: row.serviceId,
      serviceName: row.serviceId,
      publication: publication.publication,
      consumeRow: row,
    });
    await upsertServiceConsumeRow(env, {
      spaceId: params.spaceId,
      serviceId: row.serviceId,
      consume,
      state,
    });
  }
}
