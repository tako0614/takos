import { getDb, workflowRuns } from "../../../infra/db/index.ts";
import { and, eq } from "drizzle-orm";
import type { Env } from "../../../shared/types/index.ts";

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

export const workflowRunStreamDeps = {
  getDb,
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
  const db = workflowRunStreamDeps.getDb(env.DB);
  const run = await db.select({ id: workflowRuns.id })
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.id, params.runId),
        eq(workflowRuns.repoId, params.repoId),
      ),
    )
    .get();
  if (!run) {
    return new Response(JSON.stringify({ error: "Run not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const upgradeHeader = params.request.headers.get("Upgrade");
  if (!upgradeHeader || upgradeHeader !== "websocket") {
    return new Response(
      JSON.stringify({ error: "Expected WebSocket upgrade" }),
      {
        status: 426,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const namespace = env.RUN_NOTIFIER;
  const id = namespace.idFromName(params.runId);
  const notifierFetcher = namespace.get(id);

  const headers = buildSanitizedDOHeaders(params.request.headers, {
    "X-WS-Auth-Validated": "true",
    "X-WS-User-Id": params.userId ?? "anonymous",
  });

  return notifierFetcher.fetch(params.request.url, {
    method: params.request.method,
    headers,
  });
}
