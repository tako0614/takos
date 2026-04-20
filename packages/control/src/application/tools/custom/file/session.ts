import type { ToolContext } from "../../tool-definitions.ts";
import { getDb, sessionRepos, sessions } from "../../../../infra/db/index.ts";
import { and, eq } from "drizzle-orm";
import { validatePath } from "../../../../shared/utils/path-validation.ts";
import { callRuntimeRequest } from "../../../services/execution/runtime-request-handler.ts";
import { buildContainerUnavailableMessage } from "../container/availability.ts";

export function requireContainer(context: ToolContext): void {
  if (!context.sessionId) {
    throw new Error(
      buildContainerUnavailableMessage(context, "using file operations"),
    );
  }
}

function normalizeMountPath(path?: string): string {
  if (!path) return "";
  const normalized = validatePath(path).replace(/\/+$/, "");
  return normalized === "." ? "" : normalized;
}

export async function resolveMountPath(
  context: ToolContext,
  repoId?: string,
  mountPath?: string,
): Promise<string> {
  if (mountPath) {
    return normalizeMountPath(mountPath);
  }

  if (!context.sessionId) return "";

  const db = getDb(context.db);

  if (repoId) {
    const entry = await db.select({ mountPath: sessionRepos.mountPath })
      .from(sessionRepos).where(
        and(
          eq(sessionRepos.sessionId, context.sessionId),
          eq(sessionRepos.repoId, repoId),
        ),
      ).get();
    if (!entry) {
      throw new Error(
        "Repository is not mounted in this session. Use repo_list to see mounts.",
      );
    }
    return normalizeMountPath(entry.mountPath);
  }

  const primary = await db.select({ mountPath: sessionRepos.mountPath })
    .from(sessionRepos).where(
      and(
        eq(sessionRepos.sessionId, context.sessionId),
        eq(sessionRepos.isPrimary, true),
      ),
    ).get();
  if (primary) {
    return normalizeMountPath(primary.mountPath);
  }

  const session = await db.select({ repoId: sessions.repoId })
    .from(sessions).where(eq(sessions.id, context.sessionId)).get();
  if (!session?.repoId) return "";

  const entry = await db.select({ mountPath: sessionRepos.mountPath })
    .from(sessionRepos).where(
      and(
        eq(sessionRepos.sessionId, context.sessionId),
        eq(sessionRepos.repoId, session.repoId),
      ),
    ).get();
  return entry ? normalizeMountPath(entry.mountPath) : "";
}

export function buildSessionPath(mountPath: string, path: string): string {
  const base = normalizeMountPath(mountPath);
  const normalizedPath = path ? validatePath(path) : "";
  if (!base) return normalizedPath;
  if (!normalizedPath) return base;
  return `${base}/${normalizedPath}`;
}

const RUNTIME_API_TIMEOUT = 3600000;

export async function callSessionApi(
  context: ToolContext,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<Response> {
  if (!context.env.RUNTIME_HOST) {
    throw new Error("RUNTIME_HOST binding is required");
  }

  return callRuntimeRequest(context.env, endpoint, {
    method: "POST",
    body: {
      session_id: context.sessionId,
      space_id: context.spaceId,
      ...body,
    },
    timeoutMs: RUNTIME_API_TIMEOUT,
    signal: context.abortSignal,
  });
}
