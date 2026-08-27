import { Hono } from "hono";
import { z } from "zod";
import {
  decideMcpToolConfirmation,
  listPendingMcpToolConfirmations,
} from "../../../application/services/platform/mcp/tool-confirmation.ts";
import { spaceAccess, type SpaceAccessRouteEnv } from "../route-auth.ts";
import { zValidator } from "../zod-validator.ts";

const decisionSchema = z
  .object({
    decision: z.enum(["approve", "deny"]),
  })
  .strict();

// A confirmation authorizes only this Principal's exact pending invocation;
// it does not mutate the Workspace connection or tool policy.

const routes = new Hono<SpaceAccessRouteEnv>();

routes.get(
  "/tool-confirmations",
  spaceAccess(),
  async (c) => {
    const records = await listPendingMcpToolConfirmations(c.env.DB, c.env, {
      accountId: c.get("spaceId"),
      userId: c.get("user").id,
    });
    return c.json({
      data: records.map((record) => ({
        id: record.id,
        server_id: record.serverId,
        server_name: record.serverName,
        tool_name: record.toolName,
        schema_hash: record.schemaHash,
        arguments: record.arguments,
        requested_run_id: record.requestedRunId,
        requested_thread_id: record.requestedThreadId,
        status: record.status,
        expires_at: record.expiresAt,
        created_at: record.createdAt,
      })),
    });
  },
);

routes.post(
  "/tool-confirmations/:id/decision",
  spaceAccess(),
  zValidator("json", decisionSchema),
  async (c) => {
    const status = await decideMcpToolConfirmation(c.env.DB, {
      accountId: c.get("spaceId"),
      userId: c.get("user").id,
      confirmationId: c.req.param("id"),
      decision: c.req.valid("json").decision,
    });
    return c.json({ data: { status } });
  },
);

export default routes;
