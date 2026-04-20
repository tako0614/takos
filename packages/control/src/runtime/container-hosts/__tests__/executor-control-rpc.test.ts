import { assertEquals } from "jsr:@std/assert";
import { handleRunEvent } from "../executor-control-rpc.ts";

Deno.test("handleRunEvent deduplicates replayed run event sequence", async () => {
  const emittedRequests: Request[] = [];
  const env = {
    TAKOS_OFFLOAD: {},
    RUN_NOTIFIER: {
      idFromName(name: string) {
        return name;
      },
      get() {
        return {
          async fetch(request: Request) {
            emittedRequests.push(request);
            return Response.json({ ok: true });
          },
        };
      },
    },
  };
  const body = {
    runId: `run-dedup-${crypto.randomUUID()}`,
    type: "progress",
    sequence: 42,
    skipDb: true,
    data: { message: "halfway" },
  };

  const first = await handleRunEvent(body, env as never);
  const second = await handleRunEvent(body, env as never);

  assertEquals(first.status, 200);
  assertEquals(await first.json(), { success: true });
  assertEquals(second.status, 200);
  assertEquals(await second.json(), { success: true, duplicate: true });
  assertEquals(emittedRequests.length, 1);
  const emittedBody = await emittedRequests[0].json() as Record<
    string,
    unknown
  >;
  assertEquals(
    emittedBody.dedup_key,
    `run:${body.runId}:sequence:${body.sequence}:type:${body.type}`,
  );
});
