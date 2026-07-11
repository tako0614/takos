import { Hono } from "hono";
import { z } from "zod";
import { discoverMcpServerCards } from "../../../application/services/platform/mcp/server-cards.ts";
import { getSpaceOperationPolicy } from "../../../application/tools/tool-policy.ts";
import { spaceAccess, type SpaceAccessRouteEnv } from "../route-auth.ts";
import { zValidator } from "../zod-validator.ts";

const querySchema = z.object({
  workspaceId: z.string().min(1).max(160).optional(),
  workspace_id: z.string().min(1).max(160).optional(),
  spaceId: z.string().min(1).max(160).optional(),
  space_id: z.string().min(1).max(160).optional(),
  domain: z.string().min(1).max(253),
});

const roles = getSpaceOperationPolicy("mcp_server.list").allowed_roles;
const routes = new Hono<SpaceAccessRouteEnv>();

routes.get(
  "/discover",
  spaceAccess({ roles }),
  zValidator("query", querySchema),
  async (c) => {
    const result = await discoverMcpServerCards(c.env, {
      spaceId: c.get("spaceId"),
      domain: c.req.valid("query").domain,
    });
    return c.json({
      data: {
        domain: result.domain,
        catalog_url: result.catalogUrl,
        experimental: result.experimental,
        candidates: result.candidates.map((candidate) => ({
          name: candidate.name,
          title: candidate.title,
          description: candidate.description,
          version: candidate.version,
          url: candidate.url,
          transport: candidate.transport,
          repository_url: candidate.repositoryUrl,
          repository_subfolder: candidate.repositorySubfolder,
          requires_configuration: candidate.requiresConfiguration,
          packages: candidate.packages,
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
            card_url: source.cardUrl ?? null,
          })),
        })),
        failures: result.failures.map((failure) => ({
          entry_identifier: failure.entryIdentifier,
          message: failure.message,
        })),
      },
    });
  },
);

export default routes;
