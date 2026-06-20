import type { AppPublication } from "../source/app-manifest-types.ts";
import type { Env } from "../../../shared/types/env.ts";
import {
  publicationOutputContract,
  type PublicationRecord,
  upsertPublicationRow,
  type PublicationRow,
} from "./service-publications-db.ts";
import { SERVICE_GRAPH_CAPABILITIES } from "./service-publications-normalize.ts";

type ServiceGraphExport = {
  publication: AppPublication;
  urlPath: string;
};

type ServiceGraphExportEnv = Pick<
  Env,
  "AUTH_PUBLIC_BASE_URL" | "ADMIN_DOMAIN" | "DB"
>;

type ServiceGraphExportBaseUrlEnv = Partial<
  Pick<Env, "AUTH_PUBLIC_BASE_URL" | "ADMIN_DOMAIN">
>;

const SERVICE_GRAPH_PUBLISHER = "service-graph";

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function publicBaseUrl(env: ServiceGraphExportEnv): string | null {
  const configured = readString(env.AUTH_PUBLIC_BASE_URL);
  if (configured) return configured.replace(/\/+$/, "");
  const adminDomain = readString(env.ADMIN_DOMAIN);
  return adminDomain ? `https://${adminDomain.replace(/\/+$/, "")}` : null;
}

function optionalPublicBaseUrl(
  env: ServiceGraphExportBaseUrlEnv,
): string | null {
  const configured = readString(env.AUTH_PUBLIC_BASE_URL);
  if (configured) return configured.replace(/\/+$/, "");
  const adminDomain = readString(env.ADMIN_DOMAIN);
  return adminDomain ? `https://${adminDomain.replace(/\/+$/, "")}` : null;
}

function spaceApiPath(spaceId: string, path: string): string {
  return `/api/spaces/${encodeURIComponent(spaceId)}${path}`;
}

export function serviceGraphExportsForSpace(
  spaceId: string,
): ServiceGraphExport[] {
  return [
    {
      publication: {
        name: "storage.filesystem",
        publisher: SERVICE_GRAPH_PUBLISHER,
        type: SERVICE_GRAPH_CAPABILITIES.storageFilesystem,
        outputs: { url: { kind: "url" } },
        display: {
          title: "File Storage",
          category: "service-graph",
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
        publisher: SERVICE_GRAPH_PUBLISHER,
        type: SERVICE_GRAPH_CAPABILITIES.sourceRepository,
        outputs: { url: { kind: "url" } },
        display: {
          title: "Git Repository",
          category: "service-graph",
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
        publisher: SERVICE_GRAPH_PUBLISHER,
        type: SERVICE_GRAPH_CAPABILITIES.automationAgentRuntime,
        outputs: { url: { kind: "url" } },
        display: {
          title: "Agent Runtime",
          category: "service-graph",
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

function serviceGraphExportByName(
  spaceId: string,
  name: string,
): ServiceGraphExport | null {
  return (
    serviceGraphExportsForSpace(spaceId).find(
      (service) => service.publication.name === name,
    ) ?? null
  );
}

export function resolveServiceGraphExportDefinition(
  env: ServiceGraphExportBaseUrlEnv,
  params: { spaceId: string; name: string },
): {
  publication: AppPublication;
  outputs: ReturnType<typeof publicationOutputContract>;
  record?: PublicationRecord;
} | null {
  const service = serviceGraphExportByName(params.spaceId, params.name);
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
            id: `service-graph:${params.spaceId}:${service.publication.name}`,
            name: service.publication.name,
            sourceType: "api",
            groupId: null,
            ownerServiceId: null,
            catalogName: "service-graph",
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

export async function ensureServiceGraphExports(
  env: ServiceGraphExportEnv,
  params: { spaceId: string },
): Promise<PublicationRow[]> {
  const baseUrl = publicBaseUrl(env);
  if (!baseUrl) return [];
  const rows: PublicationRow[] = [];
  for (const service of serviceGraphExportsForSpace(params.spaceId)) {
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
