import { getDb, sessions } from '../../../infra/db';
import { eq } from 'drizzle-orm';
import type { Env } from '../../../shared/types';
import { isValidOpaqueId } from '../../../shared/utils/db-guards';
import { listThreadMessages } from './threads';
import { logError } from '../../../shared/utils/logger';

export async function getThreadTimeline(env: Env, threadId: string, limit: number, offset: number) {
  const { messages, total, runs } = await listThreadMessages(env, env.DB, threadId, limit, offset);
  const activeRun = runs.find((run) => ['queued', 'running'].includes(run.status));

  let pendingSessionDiff: { sessionId: string; sessionStatus: string; git_mode: boolean } | null = null;
  if (!activeRun) {
    const completedRunWithSession = runs.find((run) =>
      run.status === 'completed' && run.session_id,
    );

    if (completedRunWithSession?.session_id && isValidOpaqueId(completedRunWithSession.session_id)) {
      try {
        const db = getDb(env.DB);
        const session = await db.select({ id: sessions.id, status: sessions.status, repoId: sessions.repoId, branch: sessions.branch }).from(sessions).where(eq(sessions.id, completedRunWithSession.session_id)).get();

        if (session && session.status !== 'discarded') {
          pendingSessionDiff = {
            sessionId: session.id,
            sessionStatus: session.status,
            git_mode: !!session.repoId,
          };
        }
      } catch (err) {
        logError('Failed to get session info', err, { module: 'services/threads/threads/thread-timeline', extra: ['session_id:', completedRunWithSession.session_id] });
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
