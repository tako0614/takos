/**
 * Experimental SEP-2127 domain discovery.
 *
 * The current extension reserves `/.well-known/mcp/catalog.json` for a
 * domain-level catalog. Each catalog entry points to an advisory Server Card;
 * Takos still verifies the selected endpoint through the normal MCP
 * initialize/OAuth/tools-list connection flow.
 */
import { z } from "zod";
import type { Env } from "../../../../shared/types/index.ts";
import {
  BadRequestError,
  BadGatewayError,
} from "@takos/worker-platform-utils/errors";
import {
  assertAllowedMcpEndpointUrl,
  getMcpEndpointUrlOptions,
} from "./validation.ts";
import type { McpRegistrySearchCandidate } from "./registry-sources.ts";

const SERVER_CARD_SCHEMA_URL =
  "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json";
const SERVER_CARD_MEDIA_TYPE = "application/mcp-server-card+json";
const DISCOVERY_TIMEOUT_MS = 8_000;
const DISCOVERY_MAX_BYTES = 512 * 1024;
const DISCOVERY_MAX_ENTRIES = 32;
const DISCOVERY_CONCURRENCY = 4;

const catalogSchema = z.object({
  specVersion: z.literal("draft"),
  entries: z
    .array(
      z.object({
        identifier: z.string().min(1).max(512),
        displayName: z.string().min(1).max(256),
        mediaType: z.literal(SERVER_CARD_MEDIA_TYPE),
        url: z.string().min(1).max(4096),
      }),
    )
    .max(DISCOVERY_MAX_ENTRIES),
});

const inputSchema = z.object({
  description: z.string().max(1024).optional(),
  isRequired: z.boolean().optional(),
  isSecret: z.boolean().optional(),
  format: z.enum(["string", "number", "boolean", "filepath"]).optional(),
  default: z.string().max(4096).optional(),
  placeholder: z.string().max(4096).optional(),
  value: z.string().max(4096).optional(),
  choices: z.array(z.string().max(4096)).max(128).optional(),
});

const headerSchema = inputSchema.extend({
  name: z.string().min(1).max(256),
  variables: z.record(z.string(), inputSchema).optional(),
});

const remoteSchema = z.object({
  type: z.enum(["streamable-http", "sse"]),
  url: z.string().min(1).max(4096),
  headers: z.array(headerSchema).max(32).optional(),
  variables: z.record(z.string(), inputSchema).optional(),
  supportedProtocolVersions: z.array(z.string().max(64)).max(32).optional(),
});

const serverCardSchema = z.object({
  $schema: z.literal(SERVER_CARD_SCHEMA_URL),
  name: z
    .string()
    .min(3)
    .max(200)
    .regex(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/),
  version: z.string().min(1).max(255),
  description: z.string().min(1).max(100),
  title: z.string().min(1).max(100).optional(),
  websiteUrl: z.string().max(4096).optional(),
  repository: z
    .object({
      url: z.string().max(4096),
      source: z.string().max(128),
      subfolder: z.string().max(1024).optional(),
      id: z.string().max(512).optional(),
    })
    .optional(),
  remotes: z.array(remoteSchema).max(32).optional(),
});

export interface McpServerCardDiscoveryFailure {
  entryIdentifier: string | null;
  message: string;
}

export interface McpServerCardDiscoveryResult {
  domain: string;
  catalogUrl: string;
  experimental: true;
  candidates: McpRegistrySearchCandidate[];
  failures: McpServerCardDiscoveryFailure[];
}

function normalizeDiscoveryDomain(raw: string, env: Env): URL {
  const value = raw.trim().toLowerCase();
  if (value.length < 1 || value.length > 253 || /[\s/@?#]/.test(value)) {
    throw new BadRequestError("domain must be a hostname without a path");
  }
  let url: URL;
  try {
    url = assertAllowedMcpEndpointUrl(
      `https://${value}`,
      getMcpEndpointUrlOptions(env),
      "MCP discovery domain",
    );
  } catch (error) {
    throw new BadRequestError(
      error instanceof Error ? error.message : "domain is invalid",
    );
  }
  if (url.port || url.pathname !== "/") {
    throw new BadRequestError("domain must use the default HTTPS port");
  }
  return url;
}

async function boundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > DISCOVERY_MAX_BYTES) {
    throw new BadGatewayError("MCP discovery document is too large");
  }
  if (!response.body) throw new BadGatewayError("MCP discovery body is empty");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > DISCOVERY_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new BadGatewayError("MCP discovery document is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new BadGatewayError("MCP discovery document is not valid JSON");
  }
}

async function fetchDiscoveryJson(
  env: Env,
  spaceId: string,
  url: URL,
  accept: string,
): Promise<unknown> {
  assertAllowedMcpEndpointUrl(
    url.toString(),
    getMcpEndpointUrlOptions(env),
    "MCP discovery document",
  );
  const headers = new Headers({ Accept: accept });
  let response: Response;
  const signal = AbortSignal.timeout(DISCOVERY_TIMEOUT_MS);
  try {
    if (env.TAKOS_EGRESS) {
      headers.set("X-Takos-Space-Id", spaceId);
      headers.set("X-Takos-Egress-Mode", "mcp-server-card-discovery");
      response = await env.TAKOS_EGRESS.fetch(url, {
        method: "GET",
        headers,
        redirect: "manual",
        credentials: "omit",
        signal,
      });
    } else {
      if (env.ENVIRONMENT !== "development") {
        throw new BadGatewayError("Safe MCP discovery egress is unavailable");
      }
      response = await fetch(url, {
        method: "GET",
        headers,
        redirect: "manual",
        credentials: "omit",
        signal,
      });
    }
  } catch (error) {
    if (error instanceof BadGatewayError) throw error;
    if (
      error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new BadGatewayError("MCP discovery request timed out");
    }
    throw new BadGatewayError("MCP discovery request failed");
  }
  if (response.status >= 300 && response.status < 400) {
    throw new BadGatewayError("MCP discovery redirects are not followed");
  }
  if (!response.ok) {
    throw new BadGatewayError(`MCP discovery returned HTTP ${response.status}`);
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const mediaType = contentType.split(";", 1)[0]?.trim();
  if (
    !contentType.includes("json") ||
    (accept === SERVER_CARD_MEDIA_TYPE && mediaType !== SERVER_CARD_MEDIA_TYPE)
  ) {
    throw new BadGatewayError("MCP discovery response is not JSON");
  }
  return await boundedJson(response);
}

function safeRepositoryUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function requiresConfiguration(remote: z.infer<typeof remoteSchema>): boolean {
  return (
    (remote.headers?.some(
      (header) => header.isRequired !== false && header.value === undefined,
    ) ??
      false) ||
    Object.entries(remote.variables ?? {}).some(
      ([, input]) => input.isRequired !== false && input.default === undefined,
    )
  );
}

async function cardCandidates(
  env: Env,
  domain: string,
  catalogUrl: string,
  cardUrl: URL,
  card: z.infer<typeof serverCardSchema>,
): Promise<McpRegistrySearchCandidate[]> {
  const candidates: McpRegistrySearchCandidate[] = [];
  for (const remote of card.remotes ?? []) {
    if (remote.type !== "streamable-http") continue;
    if (remote.url.includes("{") || remote.url.includes("}")) continue;
    let endpoint: URL;
    try {
      endpoint = assertAllowedMcpEndpointUrl(
        remote.url,
        getMcpEndpointUrlOptions(env),
        "MCP Server Card endpoint",
      );
    } catch {
      continue;
    }
    candidates.push({
      name: card.name,
      title: card.title ?? null,
      description: card.description,
      version: card.version,
      url: endpoint.toString(),
      transport: "streamable-http",
      repositoryUrl: safeRepositoryUrl(card.repository?.url),
      repositorySubfolder: card.repository?.subfolder ?? null,
      requiresConfiguration: requiresConfiguration(remote),
      packages: [],
      provenance: [
        {
          sourceId: `server-card:${domain}`,
          sourceName: domain,
          sourceKind: "server_card",
          baseUrl: catalogUrl,
          priority: 0,
          preview: true,
          bestEffort: true,
          serverName: card.name,
          serverVersion: card.version,
          cardUrl: cardUrl.toString(),
        },
      ],
    });
  }
  return candidates;
}

export async function discoverMcpServerCards(
  env: Env,
  params: { spaceId: string; domain: string },
): Promise<McpServerCardDiscoveryResult> {
  const origin = normalizeDiscoveryDomain(params.domain, env);
  const catalogUrl = new URL("/.well-known/mcp/catalog.json", origin);
  const catalogBody = await fetchDiscoveryJson(
    env,
    params.spaceId,
    catalogUrl,
    "application/json",
  );
  const catalog = catalogSchema.safeParse(catalogBody);
  if (!catalog.success) {
    throw new BadGatewayError(
      "MCP Catalog does not match the experimental draft schema",
    );
  }

  const candidates: McpRegistrySearchCandidate[] = [];
  const failures: McpServerCardDiscoveryFailure[] = [];
  let nextIndex = 0;
  await Promise.all(
    Array.from(
      {
        length: Math.min(DISCOVERY_CONCURRENCY, catalog.data.entries.length),
      },
      async () => {
        while (true) {
          const entry = catalog.data.entries[nextIndex++];
          if (!entry) return;
          try {
            const cardUrl = assertAllowedMcpEndpointUrl(
              entry.url,
              getMcpEndpointUrlOptions(env),
              "MCP Server Card",
            );
            const cardBody = await fetchDiscoveryJson(
              env,
              params.spaceId,
              cardUrl,
              SERVER_CARD_MEDIA_TYPE,
            );
            const card = serverCardSchema.safeParse(cardBody);
            if (!card.success) {
              throw new BadGatewayError(
                "Server Card does not match the experimental v1 schema",
              );
            }
            candidates.push(
              ...(await cardCandidates(
                env,
                origin.hostname,
                catalogUrl.toString(),
                cardUrl,
                card.data,
              )),
            );
          } catch (error) {
            failures.push({
              entryIdentifier: entry.identifier,
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to read MCP Server Card",
            });
          }
        }
      },
    ),
  );
  candidates.sort((a, b) =>
    (a.title ?? a.name).localeCompare(b.title ?? b.name),
  );
  return {
    domain: origin.hostname,
    catalogUrl: catalogUrl.toString(),
    experimental: true,
    candidates,
    failures,
  };
}
