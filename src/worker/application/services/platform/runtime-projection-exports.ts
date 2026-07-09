import type { AppPublication } from "../source/app-manifest-types.ts";
import { TAKOS_RUNTIME_PROJECTION_PUBLICATIONS } from "../source/app-interface-contract.ts";
import type { Env } from "../../../shared/types/env.ts";
import {
  publicationOutputContract,
  type PublicationRecord,
  upsertPublicationRow,
  type PublicationRow,
} from "./service-publications-db.ts";
import { RUNTIME_PROJECTION_CAPABILITIES } from "./service-publications-normalize.ts";

type RuntimeProjectionExport = {
  publication: AppPublication;
  urlPath: string;
};

type RuntimeProjectionExportEnv = Pick<
  Env,
  "AUTH_PUBLIC_BASE_URL" | "ADMIN_DOMAIN" | "DB"
>;

type RuntimeProjectionExportBaseUrlEnv = Partial<
  Pick<Env, "AUTH_PUBLIC_BASE_URL" | "ADMIN_DOMAIN">
>;

const RUNTIME_PROJECTION_PUBLISHER = "runtime-projection";
export const TAKOS_WORKSPACE_STORAGE_PUBLICATION =
  TAKOS_RUNTIME_PROJECTION_PUBLICATIONS.workspaceStorage;

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function publicBaseUrl(env: RuntimeProjectionExportEnv): string | null {
  const configured = readString(env.AUTH_PUBLIC_BASE_URL);
  if (configured) return configured.replace(/\/+$/, "");
  const adminDomain = readString(env.ADMIN_DOMAIN);
  return adminDomain ? `https://${adminDomain.replace(/\/+$/, "")}` : null;
}

function optionalPublicBaseUrl(
  env: RuntimeProjectionExportBaseUrlEnv,
): string | null {
  const configured = readString(env.AUTH_PUBLIC_BASE_URL);
  if (configured) return configured.replace(/\/+$/, "");
  const adminDomain = readString(env.ADMIN_DOMAIN);
  return adminDomain ? `https://${adminDomain.replace(/\/+$/, "")}` : null;
}

function spaceApiPath(spaceId: string, path: string): string {
  return `/api/spaces/${encodeURIComponent(spaceId)}${path}`;
}

export function runtimeProjectionExportsForSpace(
  spaceId: string,
): RuntimeProjectionExport[] {
  return [
    {
      publication: {
        name: TAKOS_WORKSPACE_STORAGE_PUBLICATION,
        publisher: RUNTIME_PROJECTION_PUBLISHER,
        type: RUNTIME_PROJECTION_CAPABILITIES.storageFilesystem,
        outputs: { url: { kind: "url" } },
        display: {
          title: "File Storage",
          category: "runtime-projection",
        },
        spec: {
          scopes: {
            read: ["files:read"],
            write: ["files:write"],
          },
        },
      },
      urlPath: spaceApiPath(spaceId, "/storage"),
    },
    {
      publication: {
        name: "source.repository",
        publisher: RUNTIME_PROJECTION_PUBLISHER,
        type: RUNTIME_PROJECTION_CAPABILITIES.sourceRepository,
        outputs: { url: { kind: "url" } },
        display: {
          title: "Git Repository",
          category: "runtime-projection",
        },
        spec: {
          scopes: {
            read: ["repos:read"],
            write: ["repos:write"],
          },
        },
      },
      urlPath: spaceApiPath(spaceId, "/repos"),
    },
    {
      publication: {
        name: "automation.agent_runtime",
        publisher: RUNTIME_PROJECTION_PUBLISHER,
        type: RUNTIME_PROJECTION_CAPABILITIES.automationAgentRuntime,
        outputs: { url: { kind: "url" } },
        display: {
          title: "Agent Runtime",
          category: "runtime-projection",
        },
        spec: {
          scopes: {
            execute: ["agents:execute"],
            runs: ["runs:read", "runs:write"],
          },
        },
      },
      urlPath: spaceApiPath(spaceId, "/agent-tasks"),
    },
  ];
}

function runtimeProjectionExportByName(
  spaceId: string,
  name: string,
): RuntimeProjectionExport | null {
  const service =
    runtimeProjectionExportsForSpace(spaceId).find(
      (service) => service.publication.name === name,
    ) ?? null;
  return service;
}

export function isRuntimeProjectionPublicationName(name: string): boolean {
  return runtimeProjectionExportByName("", name.trim()) !== null;
}

export function resolveRuntimeProjectionExportDefinition(
  env: RuntimeProjectionExportBaseUrlEnv,
  params: { spaceId: string; name: string },
): {
  publication: AppPublication;
  outputs: ReturnType<typeof publicationOutputContract>;
  record?: PublicationRecord;
} | null {
  const service = runtimeProjectionExportByName(params.spaceId, params.name);
  if (!service) return null;
  const baseUrl = optionalPublicBaseUrl(env);
  const resolved: Record<string, string> = baseUrl
    ? { url: `${baseUrl}${service.urlPath}` }
    : {};
  return {
    publication: service.publication,
    outputs: publicationOutputContract(service.publication),
    ...(baseUrl
      ? {
          record: {
            id: `runtime-projection:${params.spaceId}:${service.publication.name}`,
            name: service.publication.name,
            sourceType: "api",
            groupId: null,
            ownerServiceId: null,
            catalogName: "runtime-projection",
            publicationType: service.publication.type,
            publication: service.publication,
            outputs: publicationOutputContract(service.publication),
            resolved,
            createdAt: "",
            updatedAt: "",
          },
        }
      : {}),
  };
}

export async function ensureRuntimeProjectionExports(
  env: RuntimeProjectionExportEnv,
  params: { spaceId: string },
): Promise<PublicationRow[]> {
  const baseUrl = publicBaseUrl(env);
  if (!baseUrl) return [];
  const rows: PublicationRow[] = [];
  for (const service of runtimeProjectionExportsForSpace(params.spaceId)) {
    rows.push(
      await upsertPublicationRow(env, {
        spaceId: params.spaceId,
        groupId: null,
        ownerServiceId: null,
        sourceType: "api",
        publication: service.publication,
        resolved: {
          url: `${baseUrl}${service.urlPath}`,
        },
      }),
    );
  }
  return rows;
}
