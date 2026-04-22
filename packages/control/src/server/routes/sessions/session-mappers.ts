import type { Context } from "hono";
import type { Env } from "../../../shared/types/index.ts";
import type { Session } from "../../../application/services/sync/index.ts";
import type { BaseVariables } from "../route-auth.ts";

export type SessionContext = Context<
  { Bindings: Env; Variables: BaseVariables }
>;

export type JwtHeartbeatPayload = {
  session_id?: string;
  space_id?: string;
};

export function toSessionSnakeCase(dbSession: {
  id: string;
  accountId: string;
  baseSnapshotId: string | null;
  headSnapshotId: string | null;
  status: string;
  repoId: string | null;
  branch: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  lastHeartbeat: string | Date | null;
}): Session {
  const createdAt = typeof dbSession.createdAt === "string"
    ? dbSession.createdAt
    : dbSession.createdAt.toISOString();
  const updatedAt = typeof dbSession.updatedAt === "string"
    ? dbSession.updatedAt
    : dbSession.updatedAt.toISOString();
  const lastHeartbeat = dbSession.lastHeartbeat == null
    ? undefined
    : typeof dbSession.lastHeartbeat === "string"
    ? dbSession.lastHeartbeat
    : dbSession.lastHeartbeat.toISOString();

  return {
    id: dbSession.id,
    space_id: dbSession.accountId,
    base_snapshot_id: dbSession.baseSnapshotId ?? "",
    head_snapshot_id: dbSession.headSnapshotId ?? undefined,
    status: dbSession.status as Session["status"],
    repo_id: dbSession.repoId ?? undefined,
    branch: dbSession.branch ?? undefined,
    created_at: createdAt,
    updated_at: updatedAt,
    last_heartbeat: lastHeartbeat,
  };
}
