import { describe, expect, test } from "bun:test";
import {
  CapsulePlanTerminalError,
  completeCapsuleApply,
  parseCapsuleApplyResponse,
  parseCapsulePlanResponse,
  parseCapsulePlanReviewResponse,
  waitForCapsulePlanReview,
} from "../../../views/source/capsule-plan-response.ts";

const exactPlan = {
  expected: {
    workspaceId: "workspace-1",
    sourceId: "source-1",
    capsuleId: "capsule-1",
    runId: "run-1",
  },
  source: { id: "source-1", name: "App" },
  capsule: { id: "capsule-1", name: "App", status: "planned" },
  run: { id: "run-1", status: "planned" },
};

describe("Capsule plan response", () => {
  test("accepts one exact plan-to-apply reference", () => {
    expect(parseCapsulePlanResponse(exactPlan).expected).toEqual(
      exactPlan.expected,
    );
    expect(parseCapsulePlanResponse(exactPlan, "capsule-1").capsule?.name)
      .toBe("App");
  });

  test("rejects missing and conflicting authority references", () => {
    expect(() => parseCapsulePlanResponse({})).toThrow(TypeError);
    expect(() =>
      parseCapsulePlanResponse(exactPlan, "capsule-other")
    ).toThrow(TypeError);
    expect(() =>
      parseCapsulePlanResponse({
        ...exactPlan,
        run: { id: "run-other" },
      })
    ).toThrow(TypeError);
    expect(() =>
      parseCapsulePlanResponse({
        ...exactPlan,
        capsule: { id: "capsule-other" },
      })
    ).toThrow(TypeError);
  });

  test("validates the completed plan review and exposes only value-free changes", () => {
    const review = parseCapsulePlanReviewResponse({
      run: {
        id: "run-1",
        workspaceId: "workspace-1",
        capsuleId: "capsule-1",
        type: "plan",
        status: "waiting_approval",
        summary: { add: 1, change: 2, destroy: 3 },
        planResources: [
          {
            address: "cloudflare_worker.app",
            type: "cloudflare_worker",
            actions: ["create"],
            scope: { facts: { region: "global" } },
          },
        ],
        policyStatus: "pass",
        requiresApproval: true,
      },
    }, exactPlan.expected);
    expect(review).toMatchObject({
      id: "run-1",
      status: "waiting_approval",
      summary: { add: 1, change: 2, destroy: 3 },
      policyStatus: "pass",
      requiresApproval: true,
      totalPlanResources: 1,
    });
    expect(review.planResources).toEqual([{
      address: "cloudflare_worker.app",
      type: "cloudflare_worker",
      actions: ["create"],
    }]);
  });

  test("rejects plan review identity, Workspace, Capsule, and value-shape drift", () => {
    const run = {
      id: "run-1",
      workspaceId: "workspace-1",
      capsuleId: "capsule-1",
      type: "plan",
      status: "succeeded",
      summary: { add: 0, change: 0, destroy: 0 },
    };
    for (const changed of [
      { ...run, id: "run-other" },
      { ...run, workspaceId: "workspace-other" },
      { ...run, capsuleId: "capsule-other" },
      { ...run, type: "apply" },
      { ...run, status: "mystery" },
      { ...run, summary: { add: -1 } },
    ]) {
      expect(() =>
        parseCapsulePlanReviewResponse({ run: changed }, exactPlan.expected)
      ).toThrow(TypeError);
    }
  });

  test("waits for a reviewable plan instead of applying a queued Run", async () => {
    const statuses = ["queued", "running", "waiting_approval"] as const;
    let loads = 0;
    let sleeps = 0;
    const review = await waitForCapsulePlanReview(
      async () => ({
        run: {
          id: "run-1",
          workspaceId: "workspace-1",
          capsuleId: "capsule-1",
          type: "plan",
          status: statuses[loads++],
        },
      }),
      exactPlan.expected,
      {
        maxAttempts: 3,
        sleep: async () => {
          sleeps += 1;
        },
      },
    );
    expect(review.status).toBe("waiting_approval");
    expect(loads).toBe(3);
    expect(sleeps).toBe(2);
  });

  test("stops on a failed plan and never presents it for approval", async () => {
    await expect(waitForCapsulePlanReview(
      async () => ({
        run: {
          id: "run-1",
          workspaceId: "workspace-1",
          capsuleId: "capsule-1",
          type: "plan",
          status: "failed",
        },
      }),
      exactPlan.expected,
    )).rejects.toBeInstanceOf(CapsulePlanTerminalError);
  });

  test("stops polling when the caller cancels the plan review", async () => {
    let loads = 0;
    let keepWaiting = true;
    const result = waitForCapsulePlanReview(
      async () => {
        loads += 1;
        keepWaiting = false;
        return {
          run: {
            id: "run-1",
            workspaceId: "workspace-1",
            capsuleId: "capsule-1",
            type: "plan",
            status: "running",
          },
        };
      },
      exactPlan.expected,
      {
        maxAttempts: 3,
        sleep: async () => {
          throw new Error("cancelled polling must not sleep");
        },
        shouldContinue: () => keepWaiting,
      },
    );

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(loads).toBe(1);
  });

  test("validates the accepted apply Run before reporting install started", () => {
    expect(parseCapsuleApplyResponse({
      run: {
        id: "run-apply",
        workspaceId: "workspace-1",
        type: "apply",
        status: "queued",
      },
      capsule: { id: "capsule-1" },
    }, exactPlan.expected)).toEqual({ runId: "run-apply", status: "queued" });
    expect(() =>
      parseCapsuleApplyResponse({
        run: {
          id: "run-apply",
          workspaceId: "workspace-other",
          type: "apply",
          status: "queued",
        },
      }, exactPlan.expected)
    ).toThrow(TypeError);
  });
});

test("successful Capsule apply refreshes before closing the modal", async () => {
  const events: string[] = [];
  const refreshError = await completeCapsuleApply(
    async (spaceId) => {
      expect(spaceId).toBe("space-1");
      await Promise.resolve();
      events.push("refreshed");
    },
    () => events.push("closed"),
    "space-1",
  );
  expect(refreshError).toBeNull();
  expect(events).toEqual(["refreshed", "closed"]);
});

test("accepted apply closes once and reports refresh failure without becoming retryable", async () => {
  const events: string[] = [];
  const failure = new Error("refresh failed");
  const refreshError = await completeCapsuleApply(
    async () => {
      events.push("refresh-attempted");
      throw failure;
    },
    () => events.push("closed"),
    "space-1",
  );
  expect(refreshError).toBe(failure);
  expect(events).toEqual(["refresh-attempted", "closed"]);
});
