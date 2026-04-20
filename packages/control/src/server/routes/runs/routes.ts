import { Hono } from "hono";
import { z } from "zod";
import type {
  Artifact,
  ArtifactType,
  Env,
} from "../../../shared/types/index.ts";
import { artifacts, runs } from "../../../infra/db/schema.ts";
import { asc, eq } from "drizzle-orm";
import {
  buildTerminalPayload,
  RUN_TERMINAL_STATUSES,
} from "../../../application/services/run-notifier/index.ts";
import { generateId } from "../../../shared/utils/index.ts";
import { checkSpaceAccess } from "../../../application/services/identity/space-access.ts";
import {
  AppError,
  BadRequestError,
  ErrorCodes,
  NotFoundError,
} from "takos-common/errors";
import {
  persistAndEmitEvent,
} from "../../../application/services/execution/run-events.ts";
import { registerRunCreateRoutes } from "./create.ts";
import { registerRunListRoutes } from "./list.ts";
import type { BaseVariables } from "../route-auth.ts";
import { runsRouteDeps } from "./deps.ts";

const INTERNAL_ONLY_HEADERS = [
  "X-Takos-Internal",
  "X-Takos-Internal-Marker",
  "X-WS-Auth-Validated",
  "X-WS-User-Id",
] as const;

function buildSanitizedDOHeaders(
  source: HeadersInit | undefined,
  trustedOverrides: Record<string, string>,
): Record<string, string> {
  const headers = new Headers(source);
  for (const name of INTERNAL_ONLY_HEADERS) headers.delete(name);
  for (const [key, value] of Object.entries(trustedOverrides)) {
    headers.set(key, value);
  }
  const result: Record<string, string> = {};
  headers.forEach((v, k) => {
    result[k] = v;
  });
  return result;
}

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

    const access = await runsRouteDeps.checkRunAccess(c.env.DB, runId, user.id);
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

    const access = await runsRouteDeps.checkRunAccess(
      c.env.DB,
      runId,
      user.id,
      ["owner", "admin", "editor"],
    );
    if (!access) {
      throw new NotFoundError("Run");
    }

    if (RUN_TERMINAL_STATUSES.has(access.run.status)) {
      throw new BadRequestError("Run is already finished");
    }

    const db = runsRouteDeps.getDb(c.env.DB);
    const completedAt = new Date().toISOString();
    await db.update(runs).set({ status: "cancelled", completedAt }).where(
      eq(runs.id, runId),
    );

    const cancellationPayload = buildTerminalPayload(
      runId,
      "cancelled",
      {},
      access.run.session_id ?? null,
    );
    await persistAndEmitEvent(
      c.env,
      runId,
      "cancelled",
      cancellationPayload,
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

      const access = await runsRouteDeps.checkRunAccess(
        c.env.DB,
        runId,
        user.id,
      );
      if (!access) {
        throw new NotFoundError("Run");
      }

      const observation = await runsRouteDeps.loadRunObservation(
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

    const access = await runsRouteDeps.checkRunAccess(c.env.DB, runId, user.id);
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
    const rawCursor = c.req.query("last_event_id") ?? c.req.query("after") ??
      "0";
    const lastEventId = Number.parseInt(rawCursor, 10);

    if (!Number.isFinite(lastEventId) || lastEventId < 0) {
      throw new BadRequestError("Invalid last_event_id");
    }

    const access = await runsRouteDeps.checkRunAccess(c.env.DB, runId, user.id);
    if (!access) {
      throw new NotFoundError("Run");
    }

    const observation = await runsRouteDeps.loadRunObservation(
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

    const access = await runsRouteDeps.checkRunAccess(c.env.DB, runId, user.id);
    if (!access) {
      throw new NotFoundError("Run");
    }

    const db = runsRouteDeps.getDb(c.env.DB);
    const rows = await db.select().from(artifacts).where(
      eq(artifacts.runId, runId),
    ).orderBy(asc(artifacts.createdAt)).all();

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

      const access = await runsRouteDeps.checkRunAccess(
        c.env.DB,
        runId,
        user.id,
        ["owner", "admin", "editor"],
      );
      if (!access) {
        throw new NotFoundError("Run");
      }

      if (!VALID_ARTIFACT_TYPES.has(body.type)) {
        throw new BadRequestError("Invalid artifact type");
      }

      const db = runsRouteDeps.getDb(c.env.DB);
      const created = await db.insert(artifacts).values({
        id: generateId(),
        runId,
        accountId: access.run.space_id,
        type: body.type,
        title: body.title ?? null,
        content: body.content ?? null,
        fileId: body.file_id ?? null,
        metadata: JSON.stringify(body.metadata ?? {}),
        createdAt: new Date().toISOString(),
      }).returning().get();

      return c.json({
        artifact: artifactRowToApi(asArtifactRow(created)),
      }, 201);
    },
  );

  app.get("/artifacts/:id", async (c) => {
    const user = c.get("user");
    const artifactId = c.req.param("id");
    const db = runsRouteDeps.getDb(c.env.DB);
    const artifactRow = await db.select().from(artifacts).where(
      eq(artifacts.id, artifactId),
    ).get();

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
