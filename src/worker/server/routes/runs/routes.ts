import { Hono } from "hono";
import { z } from "zod";
import type {
  Artifact,
  ArtifactType,
  Env,
  RunStatus,
} from "../../../shared/types/index.ts";
import { artifacts, runs } from "../../../infra/db/schema.ts";
import { and, asc, eq } from "drizzle-orm";
import {
  buildTerminalPayload,
  RUN_TERMINAL_STATUSES,
  transitionRunTerminalAtomically,
} from "../../../application/services/run-notifier/index.ts";
import { generateId } from "../../../shared/utils/index.ts";
import { checkSpaceAccess } from "../../../application/services/identity/space-access.ts";
import {
  AppError,
  BadRequestError,
  ConflictError,
  ErrorCodes,
  NotFoundError,
} from "@takos/worker-platform-utils/errors";
import { emitCommittedRunEvent } from "../../../application/services/execution/run-events.ts";
import { registerRunCreateRoutes } from "./create.ts";
import { registerRunListRoutes } from "./list.ts";
import type { BaseVariables } from "../route-auth.ts";
import { getDb } from "../../../infra/db/index.ts";
import { checkRunAccess } from "./access.ts";
import { loadRunObservation } from "./observation.ts";
import { buildSanitizedDOHeaders } from "../../../runtime/durable-objects/do-header-utils.ts";
import { logWarn } from "../../../shared/utils/logger.ts";
import type { AgentExecutorEnv } from "../../../runtime/container-hosts/executor-utils.ts";

type RunRouteEnv = { Bindings: Env; Variables: BaseVariables };
type RunRouteApp = Hono<RunRouteEnv>;
import { zValidator } from "../zod-validator.ts";
import { textDate } from "../../../shared/utils/db-guards.ts";

type ArtifactRow = {
  id: string;
  runId: string;
  accountId: string;
  type: string;
  title: string | null;
  content: string | null;
  fileId: string | null;
  metadata: string;
  createdAt: string | Date;
};

const VALID_ARTIFACT_TYPES: ReadonlySet<ArtifactType> = new Set<ArtifactType>([
  "code",
  "config",
  "doc",
  "patch",
  "report",
  "other",
]);

function artifactRowToApi(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    run_id: row.runId,
    space_id: row.accountId,
    type: row.type as ArtifactType,
    title: row.title,
    content: row.content,
    file_id: row.fileId,
    metadata: row.metadata,
    created_at: textDate(row.createdAt),
  };
}

function artifactStringField(
  row: Record<string, unknown>,
  key: keyof ArtifactRow,
): string {
  const value = row[key];
  if (typeof value === "string") return value;
  throw new TypeError(`Artifact row field ${String(key)} must be a string`);
}

function artifactNullableStringField(
  row: Record<string, unknown>,
  key: keyof ArtifactRow,
): string | null {
  const value = row[key];
  if (value == null) return null;
  if (typeof value === "string") return value;
  throw new TypeError(
    `Artifact row field ${String(key)} must be a string or null`,
  );
}

function artifactDateField(
  row: Record<string, unknown>,
  key: keyof ArtifactRow,
): string | Date {
  const value = row[key];
  if (typeof value === "string" || value instanceof Date) return value;
  throw new TypeError(`Artifact row field ${String(key)} must be a date`);
}

function asArtifactRow(row: Record<string, unknown>): ArtifactRow {
  return {
    id: artifactStringField(row, "id"),
    runId: artifactStringField(row, "runId"),
    accountId: artifactStringField(row, "accountId"),
    type: artifactStringField(row, "type"),
    title: artifactNullableStringField(row, "title"),
    content: artifactNullableStringField(row, "content"),
    fileId: artifactNullableStringField(row, "fileId"),
    metadata: artifactStringField(row, "metadata"),
    createdAt: artifactDateField(row, "createdAt"),
  };
}

function registerRunDetailRoutes(app: RunRouteApp): void {
  app.get("/runs/:id", async (c) => {
    const user = c.get("user");
    const runId = c.req.param("id");

    const access = await checkRunAccess(c.env.DB, runId, user.id);
    if (!access) {
      throw new NotFoundError("Run");
    }

    return c.json({
      run: access.run,
      role: access.role,
    });
  });

  app.post("/runs/:id/cancel", async (c) => {
    const user = c.get("user");
    const runId = c.req.param("id");

    const access = await checkRunAccess(c.env.DB, runId, user.id, [
      "owner",
      "admin",
      "editor",
    ]);
    if (!access) {
      throw new NotFoundError("Run");
    }

    const db = getDb(c.env.DB);
    const completedAt = new Date().toISOString();
    let expectedStatus: RunStatus = access.run.status;
    const cancellationPayload = buildTerminalPayload(
      runId,
      "cancelled",
      {},
      access.run.session_id ?? null,
    );
    let cancellation: Awaited<
      ReturnType<typeof transitionRunTerminalAtomically>
    > | null = null;

    // Compare-and-set the observed active status instead of unconditionally
    // overwriting the row. Completion and cancellation can race: without the
    // status predicate a completion that lands after checkRunAccess() but
    // before this UPDATE is incorrectly rewritten as cancelled. Retry a small
    // number of active-to-active transitions (normally queued -> running), but
    // never overwrite a terminal state.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (RUN_TERMINAL_STATUSES.has(expectedStatus)) {
        throw new BadRequestError("Run is already finished");
      }

      const result = await transitionRunTerminalAtomically(
        c.env.DB,
        {
          runId,
          status: "cancelled",
          expectedStatuses: [
            expectedStatus as "pending" | "queued" | "running",
          ],
          completedAt,
          error: null,
          eventType: "cancelled",
          terminalEvent: cancellationPayload,
        },
        { offloadBucket: c.env.TAKOS_OFFLOAD },
      );
      if (result.committed) {
        cancellation = result;
        break;
      }

      const current = await db
        .select({ status: runs.status })
        .from(runs)
        .where(eq(runs.id, runId))
        .get();
      if (!current) {
        throw new NotFoundError("Run");
      }
      expectedStatus = current.status as RunStatus;
    }

    if (!cancellation) {
      throw new ConflictError("Run state changed while cancelling; retry");
    }

    // The DB compare-and-set is the authority revocation. Remove every known
    // pooled/container credential immediately afterwards so a cancelled agent
    // does not retain a usable bearer token until its next heartbeat or the
    // 15-minute token TTL. This is best-effort availability cleanup: the
    // central lease fence still denies every RPC if a container DO is
    // temporarily unavailable.
    if (c.env.EXECUTOR_CONTAINER) {
      try {
        const { revokeRunProxyTokens } =
          await import("../../../runtime/container-hosts/executor-host.ts");
        await revokeRunProxyTokens(c.env as unknown as AgentExecutorEnv, runId);
      } catch (error) {
        logWarn("Cancelled run proxy-token revoke failed", {
          module: "run_routes",
          runId,
          error: String(error),
        });
      }
    }

    await emitCommittedRunEvent(
      c.env,
      runId,
      "cancelled",
      cancellationPayload,
      cancellation.eventId,
      true,
    );

    return c.json({ success: true });
  });

  app.get(
    "/runs/:id/events",
    zValidator("query", z.object({ last_event_id: z.string().optional() })),
    async (c) => {
      const user = c.get("user");
      const runId = c.req.param("id");
      const lastEventIdQuery = c.req.valid("query") as {
        last_event_id?: string;
      };
      const lastEventId = Number.parseInt(
        lastEventIdQuery.last_event_id ?? "0",
        10,
      );

      if (!Number.isFinite(lastEventId) || lastEventId < 0) {
        throw new BadRequestError("Invalid last_event_id");
      }

      const access = await checkRunAccess(c.env.DB, runId, user.id);
      if (!access) {
        throw new NotFoundError("Run");
      }

      const observation = await loadRunObservation(
        c.env,
        runId,
        access.run.status,
        lastEventId,
      );
      return c.json({
        events: observation.events,
        run_status: observation.runStatus,
      });
    },
  );

  app.get("/runs/:id/ws", async (c) => {
    const user = c.get("user");
    const runId = c.req.param("id");

    const access = await checkRunAccess(c.env.DB, runId, user.id);
    if (!access) {
      throw new NotFoundError("Run");
    }

    if (c.req.header("Upgrade") !== "websocket") {
      throw new AppError(
        "Expected WebSocket upgrade",
        ErrorCodes.BAD_REQUEST,
        426,
      );
    }

    const namespace = c.env.RUN_NOTIFIER;
    const id = namespace.idFromName(runId);
    const stub = namespace.get(id);
    const headers = buildSanitizedDOHeaders(c.req.raw.headers, {
      "X-WS-Auth-Validated": "true",
      "X-WS-User-Id": user.id,
    });

    const request = new Request(c.req.raw.url, {
      method: c.req.raw.method,
      headers,
      body: c.req.raw.body,
    });
    return await stub.fetch(request);
  });

  app.get("/runs/:id/replay", async (c) => {
    const user = c.get("user");
    const runId = c.req.param("id");
    const rawCursor =
      c.req.query("last_event_id") ?? c.req.query("after") ?? "0";
    const lastEventId = Number.parseInt(rawCursor, 10);

    if (!Number.isFinite(lastEventId) || lastEventId < 0) {
      throw new BadRequestError("Invalid last_event_id");
    }

    const access = await checkRunAccess(c.env.DB, runId, user.id);
    if (!access) {
      throw new NotFoundError("Run");
    }

    const observation = await loadRunObservation(
      c.env,
      runId,
      access.run.status,
      lastEventId,
    );
    return c.json({
      events: observation.events,
      run_status: observation.runStatus,
    });
  });
}

function registerRunArtifactRoutes(app: RunRouteApp): void {
  app.get("/runs/:id/artifacts", async (c) => {
    const user = c.get("user");
    const runId = c.req.param("id");

    const access = await checkRunAccess(c.env.DB, runId, user.id);
    if (!access) {
      throw new NotFoundError("Run");
    }

    const db = getDb(c.env.DB);
    const rows = await db
      .select()
      .from(artifacts)
      .where(eq(artifacts.runId, runId))
      .orderBy(asc(artifacts.createdAt))
      .all();

    return c.json({
      artifacts: rows.map((row) => artifactRowToApi(asArtifactRow(row))),
    });
  });

  app.post(
    "/runs/:id/artifacts",
    zValidator(
      "json",
      z.object({
        type: z.string(),
        title: z.string().optional(),
        content: z.string().optional(),
        file_id: z.string().optional(),
        metadata: z.record(z.unknown()).optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const runId = c.req.param("id");
      const body = c.req.valid("json") as {
        type: ArtifactType;
        title?: string;
        content?: string;
        file_id?: string;
        metadata?: Record<string, unknown>;
      };

      const access = await checkRunAccess(c.env.DB, runId, user.id, [
        "owner",
        "admin",
        "editor",
      ]);
      if (!access) {
        throw new NotFoundError("Run");
      }

      if (!VALID_ARTIFACT_TYPES.has(body.type)) {
        throw new BadRequestError("Invalid artifact type");
      }

      const db = getDb(c.env.DB);
      const created = await db
        .insert(artifacts)
        .values({
          id: generateId(),
          runId,
          accountId: access.run.space_id,
          type: body.type,
          title: body.title ?? null,
          content: body.content ?? null,
          fileId: body.file_id ?? null,
          metadata: JSON.stringify(body.metadata ?? {}),
          createdAt: new Date().toISOString(),
        })
        .returning()
        .get();

      return c.json(
        {
          artifact: artifactRowToApi(asArtifactRow(created)),
        },
        201,
      );
    },
  );

  app.get("/artifacts/:id", async (c) => {
    const user = c.get("user");
    const artifactId = c.req.param("id");
    const db = getDb(c.env.DB);
    const artifactRow = await db
      .select()
      .from(artifacts)
      .where(eq(artifacts.id, artifactId))
      .get();

    if (!artifactRow) {
      throw new NotFoundError("Artifact");
    }

    const access = await checkSpaceAccess(
      c.env.DB,
      artifactRow.accountId,
      user.id,
    );
    if (!access) {
      throw new NotFoundError("Artifact");
    }

    return c.json({
      artifact: artifactRowToApi(asArtifactRow(artifactRow)),
    });
  });
}

const router = new Hono<RunRouteEnv>() as RunRouteApp;

registerRunListRoutes(router);
registerRunCreateRoutes(router);
registerRunDetailRoutes(router);
registerRunArtifactRoutes(router);

export default router;
