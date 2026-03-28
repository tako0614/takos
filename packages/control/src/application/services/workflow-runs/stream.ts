import { getDb, workflowRuns } from '../../../infra/db';
import { and, eq } from 'drizzle-orm';
import type { Env } from '../../../shared/types';
import { buildSanitizedDOHeaders } from '../../../shared/utils/do-header-utils';

type DurableObjectFetchLike = {
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
};

type RunNotifierNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectFetchLike;
};

export async function connectWorkflowRunStream(
  env: Env,
  params: {
    repoId: string;
    runId: string;
    userId: string | null | undefined;
    request: Request;
  },
): Promise<Response> {
  const db = getDb(env.DB);
  const run = await db.select({ id: workflowRuns.id })
    .from(workflowRuns)
    .where(and(eq(workflowRuns.id, params.runId), eq(workflowRuns.repoId, params.repoId)))
    .get();
  if (!run) {
    return new Response(JSON.stringify({ error: 'Run not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const upgradeHeader = params.request.headers.get('Upgrade');
  if (!upgradeHeader || upgradeHeader !== 'websocket') {
    return new Response(JSON.stringify({ error: 'Expected WebSocket upgrade' }), {
      status: 426,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const namespace = env.RUN_NOTIFIER as unknown as RunNotifierNamespace;
  const id = namespace.idFromName(params.runId);
  const notifierFetcher = namespace.get(id);

  const headers = buildSanitizedDOHeaders(params.request.headers, { 'X-WS-Auth-Validated': 'true', 'X-WS-User-Id': params.userId ?? 'anonymous' });

  return notifierFetcher.fetch(params.request.url, {
    method: params.request.method,
    headers,
  });
}
