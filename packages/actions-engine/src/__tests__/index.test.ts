import { JobScheduler } from "../scheduler/job.ts";
import { createBaseContext } from "../context.ts";
import type { Workflow } from "../workflow-models.ts";

import { assertEquals } from "jsr:@std/assert";

Deno.test("JobScheduler - resets scheduler state across repeated runs and preserves listeners", async () => {
  const workflow: Workflow = {
    name: "runner-reset",
    on: "push",
    jobs: {
      build: {
        "runs-on": "ubuntu-latest",
        steps: [{ run: "${{ env.BUILD_COMMAND }}" }],
      },
      deploy: {
        "runs-on": "ubuntu-latest",
        needs: "build",
        steps: [{ run: "echo deploy=ok" }],
      },
    },
  };

  const scheduler = new JobScheduler(workflow);
  const lifecycleEvents: string[] = [];
  scheduler.on((event) => {
    if (event.type === "workflow:start" || event.type === "workflow:complete") {
      lifecycleEvents.push(event.type);
    }
  });

  const firstContext = createBaseContext({
    env: { BUILD_COMMAND: "exit 1" },
  });
  const firstResults = await scheduler.run(firstContext);
  assertEquals(firstResults.build.conclusion, "failure");
  assertEquals(firstResults.deploy.conclusion, "cancelled");
  assertEquals(scheduler.getConclusion(), "failure");

  const secondContext = createBaseContext({
    env: { BUILD_COMMAND: "echo build=ok" },
  });
  const secondResults = await scheduler.run(secondContext);
  assertEquals(secondResults.build.conclusion, "success");
  assertEquals(secondResults.deploy.conclusion, "success");
  assertEquals(scheduler.getConclusion(), "success");
  assertEquals(lifecycleEvents, [
    "workflow:start",
    "workflow:complete",
    "workflow:start",
    "workflow:complete",
  ]);
});
