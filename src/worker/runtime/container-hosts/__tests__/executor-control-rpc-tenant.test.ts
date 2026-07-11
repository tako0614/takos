import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import type { Env } from "../../../shared/types/index.ts";
import {
  handleConversationHistory,
  handleSkillCatalog,
  handleSkillPlan,
  handleSkillRuntimeContext,
  resolveRunThreadTenant,
} from "../executor-control-rpc.ts";

/**
 * Guards the TIER A invariant: control-RPC handlers derive tenant/thread from the
 * token-bound run row, NEVER from caller-supplied body fields, and fail closed
 * (404) when the run is missing. A regression that reintroduced body-spoofing
 * (reading body.spaceId/threadId) or dropped the run-existence gate would make a
 * compromised container reach a victim tenant's data — these tests would catch it.
 */

type RunRow = { accountId: string; threadId: string | null } | null;

// Minimal drizzle-like mock: getDb() returns it as-is (isDrizzleLikeDb checks for
// select/insert/update/delete), and every `.from(...).where(...).get()` resolves
// to the single configured run row. The handlers under test only need the run
// lookup to decide tenant / 404, so this is sufficient and deterministic.
function envWithRun(run: RunRow): Env {
  const db = {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                get: async () => run,
                all: async () => [],
              };
            },
          };
        },
      };
    },
    insert() {
      return { values: () => ({ run: async () => ({}) }) };
    },
    update() {
      return { set: () => ({ where: async () => ({}) }) };
    },
    delete() {
      return { where: async () => ({}) };
    },
    prepare() {
      return {};
    },
  };
  return { DB: db } as unknown as Env;
}

// Each handler funnels tenant resolution through the run row. With an attacker
// body that names a different tenant, the handler must still fail closed (404)
// when the run does not exist, rather than trusting body.spaceId/threadId.
const HANDLERS: Array<
  [string, (body: Record<string, unknown>, env: Env) => Promise<Response>]
> = [
  ["conversation-history", handleConversationHistory],
  ["skill-plan", handleSkillPlan],
  ["skill-catalog", handleSkillCatalog],
  ["skill-runtime-context", handleSkillRuntimeContext],
];

for (const [name, handler] of HANDLERS) {
  test(`${name} returns 404 when the token-bound run is missing (no body-spoofed tenant)`, async () => {
    const env = envWithRun(null);
    const response = await handler(
      {
        runId: "run_missing",
        // Attacker-controlled fields the handler must ignore:
        spaceId: "space_victim",
        threadId: "thread_victim",
        aiModel: "test-model",
        agentType: "default",
        history: [],
        availableToolNames: [],
      },
      env,
    );
    assertEquals(response.status, 404);
    const body = (await response.json()) as { error?: string };
    assertEquals(body.error, "Run not found");
  });
}

test("resolveRunThreadTenant binds tenant to the run row, not the request body", async () => {
  const env = envWithRun({ accountId: "space_A", threadId: "thread_A" });
  const tenant = await resolveRunThreadTenant(env, "run_1");
  assertEquals(tenant, { spaceId: "space_A", threadId: "thread_A" });
});

test("resolveRunThreadTenant fails closed for a missing run", async () => {
  const tenant = await resolveRunThreadTenant(envWithRun(null), "run_missing");
  assertEquals(tenant, null);
});

test("resolveRunThreadTenant fails closed when the run has no thread", async () => {
  const env = envWithRun({ accountId: "space_A", threadId: null });
  const tenant = await resolveRunThreadTenant(env, "run_1");
  assertEquals(tenant, null);
});
