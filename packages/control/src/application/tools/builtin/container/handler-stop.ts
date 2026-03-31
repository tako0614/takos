import type { ToolHandler } from '../../tool-definitions.ts';
import { getDb, sessions } from '../../../../infra/db/index.ts';
import { eq, and } from 'drizzle-orm';
import { callSessionApi } from './session.ts';
import { appendContainerStartFailureContext } from './availability.ts';
import { logError, logInfo } from '../../../../shared/utils/logger.ts';

export const containerStopHandler: ToolHandler = async (args, context) => {
  const reason = (args.reason as string) || 'Container stopped by user';

  if (!context.sessionId) {
    return appendContainerStartFailureContext(
      context,
      'No container is running. Nothing to stop.',
      'Resolve that error and call container_start again only if you still need a new container.'
    );
  }

  const db = getDb(context.db);
  const session = await db.select({ status: sessions.status })
    .from(sessions).where(eq(sessions.id, context.sessionId)).get();

  if (!session) {
    return 'Container session not found in database.';
  }

  if (session.status !== 'running') {
    return `Container is not running (status: ${session.status}). Cannot stop.`;
  }

  const timestamp = new Date().toISOString();

  const result = await db.update(sessions).set({ status: 'discarded', updatedAt: timestamp })
    .where(and(eq(sessions.id, context.sessionId), eq(sessions.status, 'running')));

  if (result.meta.changes === 0) {
    return 'Container state changed during stop operation. Please retry.';
  }

  if (context.env.RUNTIME_HOST) {
    try {
      await callSessionApi(context, '/session/destroy');
    } catch (e) {
      logError('Failed to destroy runtime session', e, { module: 'tools/builtin/container/handler-stop' });
    }
  }

  if (context.storage && context.sessionId) {
    try {
      const prefix = `session-files/${context.spaceId}/${context.sessionId}/`;
      const listed = await context.storage.list({ prefix });
      if (listed.objects && listed.objects.length > 0) {
        await Promise.all(listed.objects.map((obj: { key: string }) => context.storage!.delete(obj.key)));
        logInfo(`Cleaned up ${listed.objects.length} R2 session files on stop`, { module: 'tools/builtin/container/handler-stop' });
      }
    } catch (e) {
      logError('Failed to cleanup R2 session files', e, { module: 'tools/builtin/container/handler-stop' });
    }
  }

  context.setSessionId(undefined);

  return `Container stopped.\n\nAll changes have been DISCARDED.\n\nReason: ${reason}\n\nCall container_start to start a new container if needed.`;
};
