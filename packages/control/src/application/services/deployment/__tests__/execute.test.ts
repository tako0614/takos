import { assertEquals } from "jsr:@std/assert";

import {
  resolveCandidateBaseUrlFromBackendState,
  resolveCompletedStepNames,
} from "../execute.ts";
import type { DeploymentEvent } from "../models.ts";

function event(
  eventType: string,
  stepName: string,
): DeploymentEvent {
  return {
    id: Math.floor(Math.random() * 1_000_000),
    deployment_id: "dep-1",
    actor_user_id: null,
    event_type: eventType,
    step_name: stepName,
    message: null,
    details: null,
    created_at: new Date().toISOString(),
  };
}

Deno.test("resolveCompletedStepNames ignores steps rolled back after completion", () => {
  assertEquals(
    resolveCompletedStepNames([
      event("step_completed", "deploy_worker"),
      event("step_completed", "update_routing"),
      event("rollback_step", "update_routing"),
      event("rollback_step", "deploy_worker"),
    ]),
    [],
  );
});

Deno.test("resolveCompletedStepNames allows retry to complete a rolled-back step again", () => {
  assertEquals(
    resolveCompletedStepNames([
      event("step_completed", "deploy_worker"),
      event("rollback_step", "deploy_worker"),
      event("step_completed", "deploy_worker"),
    ]),
    ["deploy_worker"],
  );
});

Deno.test("resolveCandidateBaseUrlFromBackendState restores resumed deployment candidate URL", () => {
  assertEquals(
    resolveCandidateBaseUrlFromBackendState(JSON.stringify({
      resolved_endpoint: {
        base_url: " https://candidate.example.test ",
      },
    })),
    "https://candidate.example.test",
  );
  assertEquals(resolveCandidateBaseUrlFromBackendState("{}"), null);
  assertEquals(resolveCandidateBaseUrlFromBackendState("not json"), null);
});
