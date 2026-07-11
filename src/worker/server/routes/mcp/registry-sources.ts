import { Hono } from "hono";
import { z } from "zod";
import {
  createMcpRegistrySource,
  deleteMcpRegistrySource,
  listMcpRegistrySources,
  searchMcpRegistrySources,
  updateMcpRegistrySource,
  type McpRegistrySearchCandidate,
  type McpRegistrySourceRecord,
} from "../../../application/services/platform/mcp.ts";
import { getSpaceOperationPolicy } from "../../../application/tools/tool-policy.ts";
import { NotFoundError } from "@takos/worker-platform-utils/errors";
import { spaceAccess, type SpaceAccessRouteEnv } from "../route-auth.ts";
import { ok } from "../response-utils.ts";
import { zValidator } from "../zod-validator.ts";

const customSourceKindSchema = z.enum(["organization", "community", "custom"]);
const registryAuthTypeSchema = z.enum(["none", "bearer", "header"]);

const createRegistrySourceSchema = z.object({
  name: z.string().min(1).max(120),
  base_url: z.string().min(1).max(2048),
  source_kind: customSourceKindSchema.optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(-1000).max(1000).optional(),
  auth_type: registryAuthTypeSchema.optional(),
  auth_header_name: z.string().min(1).max(128).optional(),
  auth_secret: z.string().min(1).max(4096).optional(),
});

const updateRegistrySourceSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    base_url: z.string().min(1).max(2048).optional(),
    source_kind: customSourceKindSchema.optional(),
    enabled: z.boolean().optional(),
    priority: z.number().int().min(-1000).max(1000).optional(),
    auth_type: registryAuthTypeSchema.optional(),
    auth_header_name: z.string().min(1).max(128).nullable().optional(),
    auth_secret: z.string().min(1).max(4096).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

const searchRegistrySchema = z.object({
  // spaceAccess resolves the Workspace before this validator runs. Keep both
  // Workspace spellings plus the legacy Space aliases in the validated shape
  // while new clients use `/api/mcp/search?workspaceId=...&q=...`.
  workspaceId: z.string().min(1).max(160).optional(),
  workspace_id: z.string().min(1).max(160).optional(),
  spaceId: z.string().min(1).max(160).optional(),
  space_id: z.string().min(1).max(160).optional(),
  q: z.string().min(1).max(256),
});

const registrySourceRoutes = new Hono<SpaceAccessRouteEnv>();

const MCP_LIST_ROLES = getSpaceOperationPolicy("mcp_server.list").allowed_roles;
const MCP_CREATE_ROLES =
  getSpaceOperationPolicy("mcp_server.create").allowed_roles;
const MCP_UPDATE_ROLES =
  getSpaceOperationPolicy("mcp_server.update").allowed_roles;
const MCP_DELETE_ROLES =
  getSpaceOperationPolicy("mcp_server.delete").allowed_roles;

export function serializeSource(source: McpRegistrySourceRecord) {
  return {
    id: source.id,
    workspace_id: source.spaceId,
    name: source.name,
    base_url: source.baseUrl,
    source_kind: source.sourceKind,
    auth_type: source.authType,
    auth_header_name: source.authHeaderName,
    credential_configured: source.credentialConfigured,
    enabled: source.enabled,
    priority: source.priority,
    priority_semantics: "higher_first" as const,
    read_only: source.readOnly,
    preview: source.preview,
    best_effort: source.bestEffort,
    verification_status: source.verificationStatus,
    security_status: source.securityStatus,
    created_at: source.createdAt,
    updated_at: source.updatedAt,
    // Registry source provenance and connector safety are separate. In
    // particular, Official MCP Registry entries are not safety approvals.
    safety_assertion: "none" as const,
  };
}

function serializeCandidate(candidate: McpRegistrySearchCandidate) {
  return {
    name: candidate.name,
    title: candidate.title,
    description: candidate.description,
    version: candidate.version,
    url: candidate.url,
    transport: candidate.transport,
    repository_url: candidate.repositoryUrl,
    repository_subfolder: candidate.repositorySubfolder,
    requires_configuration: candidate.requiresConfiguration,
    packages: candidate.packages.map((entry) => ({
      registry_type: entry.registryType,
      registry_base_url: entry.registryBaseUrl,
      identifier: entry.identifier,
      version: entry.version,
      file_sha256: entry.fileSha256,
      transport_type: entry.transportType,
      transport_url: entry.transportUrl,
      runtime_hint: entry.runtimeHint,
      requires_configuration: entry.requiresConfiguration,
    })),
    provenance: candidate.provenance.map((source) => ({
      source_id: source.sourceId,
      source_name: source.sourceName,
      source_kind: source.sourceKind,
      base_url: source.baseUrl,
      priority: source.priority,
      preview: source.preview,
      best_effort: source.bestEffort,
      server_name: source.serverName,
      server_version: source.serverVersion,
    })),
  };
}

registrySourceRoutes.get(
  "/registry-sources",
  spaceAccess({ roles: MCP_LIST_ROLES }),
  async (c) => {
    const sources = await listMcpRegistrySources(c.env.DB, c.get("spaceId"));
    return c.json({ data: sources.map(serializeSource) });
  },
);

registrySourceRoutes.post(
  "/registry-sources",
  spaceAccess({ roles: MCP_CREATE_ROLES }),
  zValidator("json", createRegistrySourceSchema),
  async (c) => {
    const body = c.req.valid("json");
    const source = await createMcpRegistrySource(
      c.env.DB,
      c.env,
      c.get("spaceId"),
      {
        name: body.name,
        baseUrl: body.base_url,
        sourceKind: body.source_kind,
        enabled: body.enabled,
        priority: body.priority,
        authType: body.auth_type,
        authHeaderName: body.auth_header_name,
        authSecret: body.auth_secret,
      },
    );
    return c.json({ data: serializeSource(source) }, 201);
  },
);

registrySourceRoutes.patch(
  "/registry-sources/:id",
  spaceAccess({ roles: MCP_UPDATE_ROLES }),
  zValidator("json", updateRegistrySourceSchema),
  async (c) => {
    const body = c.req.valid("json");
    const source = await updateMcpRegistrySource(
      c.env.DB,
      c.env,
      c.get("spaceId"),
      c.req.param("id"),
      {
        name: body.name,
        baseUrl: body.base_url,
        sourceKind: body.source_kind,
        enabled: body.enabled,
        priority: body.priority,
        authType: body.auth_type,
        authHeaderName: body.auth_header_name,
        authSecret: body.auth_secret,
      },
    );
    if (!source) throw new NotFoundError("MCP Registry source");
    return c.json({ data: serializeSource(source) });
  },
);

registrySourceRoutes.delete(
  "/registry-sources/:id",
  spaceAccess({ roles: MCP_DELETE_ROLES }),
  async (c) => {
    const deleted = await deleteMcpRegistrySource(
      c.env.DB,
      c.get("spaceId"),
      c.req.param("id"),
    );
    if (!deleted) throw new NotFoundError("MCP Registry source");
    return ok(c);
  },
);

registrySourceRoutes.get(
  "/search",
  spaceAccess({ roles: MCP_LIST_ROLES }),
  zValidator("query", searchRegistrySchema),
  async (c) => {
    const result = await searchMcpRegistrySources(c.env.DB, c.env, {
      spaceId: c.get("spaceId"),
      query: c.req.valid("query").q,
    });
    return c.json({
      data: {
        query: result.query,
        candidates: result.candidates.map(serializeCandidate),
        source_results: result.sourceResults.map((source) => ({
          source_id: source.sourceId,
          source_name: source.sourceName,
          matched_servers: source.matchedServers,
          candidate_count: source.candidateCount,
          skipped_remote_count: source.skippedRemoteCount,
        })),
        source_failures: result.sourceFailures.map((failure) => ({
          source_id: failure.sourceId,
          source_name: failure.sourceName,
          source_kind: failure.sourceKind,
          code: failure.code,
          message: failure.message,
          status: failure.status,
        })),
        limitations: {
          mode: result.limitations.mode,
          upstream_search: result.limitations.upstreamSearch,
          cached_full_text_aggregation:
            result.limitations.cachedFullTextAggregation,
          credentials_supported: result.limitations.credentialsSupported,
          note: "Live Registry v0.1 search is a server-name substring query; authenticated public HTTPS sources are supported, but cached title/description/provider full-text aggregation and private-network routing are not implemented.",
        },
      },
    });
  },
);

export default registrySourceRoutes;
