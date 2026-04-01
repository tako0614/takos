import { getDb, sessions } from "../../../infra/db/index.ts";
import { eq } from "drizzle-orm";
import type { Env } from "../../../shared/types/index.ts";
import { isValidOpaqueId } from "../../../shared/utils/db-guards.ts";
import { listThreadMessages } from "./thread-service.ts";
import { logError } from "../../../shared/utils/logger.ts";

export const threadTimelineDeps = {
  getDb,
  listThreadMessages,
  isValidOpaqueId,
  logError,
};

export async function getThreadTimeline(
  env: Env,
  threadId: string,
  limit: number,
  offset: number,
) {
  const { messages, total, runs } = await threadTimelineDeps.listThreadMessages(
    env,
    env.DB,
    threadId,
    limit,
    offset,
  );
  const activeRun = runs.find((run) =>
    ["queued", "running"].includes(run.status)
  );

  let pendingSessionDiff: {
    sessionId: string;
    sessionStatus: string;
    git_mode: boolean;
  } | null = null;
  if (!activeRun) {
    const completedRunWithSession = runs.find((run) =>
      run.status === "completed" && run.session_id
    );

    if (
      completedRunWithSession?.session_id &&
      threadTimelineDeps.isValidOpaqueId(completedRunWithSession.session_id)
    ) {
      try {
        const db = threadTimelineDeps.getDb(env.DB);
        const session = await db.select({
          id: sessions.id,
          status: sessions.status,
          repoId: sessions.repoId,
          branch: sessions.branch,
        }).from(sessions).where(
          eq(sessions.id, completedRunWithSession.session_id),
        ).get();

        if (session && session.status !== "discarded") {
          pendingSessionDiff = {
            sessionId: session.id,
            sessionStatus: session.status,
            git_mode: !!session.repoId,
          };
        }
      } catch (err) {
        threadTimelineDeps.logError("Failed to get session info", err, {
          module: "services/threads/threads/thread-timeline",
          extra: ["session_id:", completedRunWithSession.session_id],
        });
      }
    }
  }

  return {
    messages,
    total,
    limit,
    offset,
    activeRun: activeRun || null,
    pendingSessionDiff,
  };
}
