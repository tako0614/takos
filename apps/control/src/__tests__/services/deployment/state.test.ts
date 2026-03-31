import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { assertSpyCallArgs, assertSpyCalls } from "jsr:@std/testing/mock";

const mocks = {
  updateDeploymentRecord: ((..._args: any[]) => undefined) as any,
  logDeploymentEvent: ((..._args: any[]) => undefined) as any,
  getStuckDeployments: ((..._args: any[]) => undefined) as any,
};

// [Deno] vi.mock removed - manually stub imports from '@/services/deployment/store'
import {
  detectStuckDeployments,
  executeDeploymentStep,
  resetStuckDeployment,
  updateDeploymentState,
} from "@/services/deployment/state";

Deno.test("updateDeploymentState - updates status and deploy state", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.updateDeploymentRecord = (async () => undefined) as any;
  await updateDeploymentState(
    {} as any,
    "dep-1",
    "in_progress",
    "deploying_worker",
  );

  assertSpyCallArgs(mocks.updateDeploymentRecord, 0, [
    expect.anything(),
    "dep-1",
    {
      status: "in_progress",
      deployState: "deploying_worker",
    },
  ]);
});
Deno.test("updateDeploymentState - includes updatedAt timestamp", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.updateDeploymentRecord = (async () => undefined) as any;
  await updateDeploymentState({} as any, "dep-1", "success", "completed");

  const call = mocks.updateDeploymentRecord.calls[0][2];
  assert(call.updatedAt !== undefined);
});

Deno.test("executeDeploymentStep - executes a successful step", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.updateDeploymentRecord = (async () => undefined) as any;
  mocks.logDeploymentEvent = (async () => undefined) as any;
  const action = async () => undefined;

  await executeDeploymentStep(
    {} as any,
    "dep-1",
    "deploying_worker",
    "deploy_worker",
    action,
  );

  assertSpyCalls(action, 1);
  // Should log step_started and step_completed
  assertSpyCalls(mocks.logDeploymentEvent, 2);
  assertSpyCallArgs(mocks.logDeploymentEvent, 0, [
    expect.anything(),
    "dep-1",
    "step_started",
    "deploy_worker",
    /* expect.any(String) */ {} as any,
  ]);
  assertSpyCallArgs(mocks.logDeploymentEvent, 0, [
    expect.anything(),
    "dep-1",
    "step_completed",
    "deploy_worker",
    /* expect.any(String) */ {} as any,
  ]);
});
Deno.test("executeDeploymentStep - logs failure and rethrows on action error", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.updateDeploymentRecord = (async () => undefined) as any;
  mocks.logDeploymentEvent = (async () => undefined) as any;
  const error = new Error("deploy failed");
  const action = async () => {
    throw error;
  };

  await assertRejects(async () => {
    await executeDeploymentStep(
      {} as any,
      "dep-1",
      "deploying_worker",
      "deploy_worker",
      action,
    );
  }, "deploy failed");

  assertSpyCallArgs(mocks.logDeploymentEvent, 0, [
    expect.anything(),
    "dep-1",
    "step_failed",
    "deploy_worker",
    "deploy failed",
  ]);
  assertSpyCallArgs(mocks.updateDeploymentRecord, 0, [
    expect.anything(),
    "dep-1",
    { stepError: "deploy failed" },
  ]);
});
Deno.test("executeDeploymentStep - records step name on start", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.updateDeploymentRecord = (async () => undefined) as any;
  mocks.logDeploymentEvent = (async () => undefined) as any;
  const action = async () => undefined;

  await executeDeploymentStep(
    {} as any,
    "dep-1",
    "routing",
    "update_routing",
    action,
  );

  // First updateDeploymentRecord call should set deployState and currentStep
  assertSpyCallArgs(mocks.updateDeploymentRecord, 0, [
    expect.anything(),
    "dep-1",
    {
      deployState: "routing",
      currentStep: "update_routing",
      stepError: null,
    },
  ]);
});

Deno.test("detectStuckDeployments - returns stuck deployments using default timeout", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const stuckDeps = [{ id: "dep-1", current_step: "deploying_worker" }];
  mocks.getStuckDeployments = (async () => stuckDeps) as any;

  const result = await detectStuckDeployments({} as any);

  assertSpyCallArgs(mocks.getStuckDeployments, 0, [
    expect.anything(),
    /* expect.any(String) */ {} as any, // cutoff ISO string
  ]);
  assertEquals(result, stuckDeps);
});
Deno.test("detectStuckDeployments - uses custom timeout", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getStuckDeployments = (async () => []) as any;

  await detectStuckDeployments({} as any, 5 * 60 * 1000);

  assert(mocks.getStuckDeployments.calls.length > 0);
});

Deno.test("resetStuckDeployment - marks deployment as failed with reason", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.updateDeploymentRecord = (async () => undefined) as any;
  mocks.logDeploymentEvent = (async () => undefined) as any;
  await resetStuckDeployment({} as any, "dep-1", "stuck for too long");

  assertSpyCallArgs(mocks.updateDeploymentRecord, 0, [
    expect.anything(),
    "dep-1",
    {
      status: "failed",
      deployState: "failed",
      stepError: "stuck for too long",
    },
  ]);
  assertSpyCallArgs(mocks.logDeploymentEvent, 0, [
    expect.anything(),
    "dep-1",
    "stuck_reset",
    null,
    "stuck for too long",
  ]);
});
Deno.test("resetStuckDeployment - uses default reason", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.updateDeploymentRecord = (async () => undefined) as any;
  mocks.logDeploymentEvent = (async () => undefined) as any;
  await resetStuckDeployment({} as any, "dep-1");

  const call = mocks.updateDeploymentRecord.calls[0][2];
  assertStringIncludes(call.stepError, "timed out");
});
