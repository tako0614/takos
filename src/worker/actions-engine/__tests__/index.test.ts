import { expect, test } from "bun:test";
import { JobScheduler } from "../scheduler/job.ts";
import { createBaseContext } from "../context.ts";
import { defaultShellExecutor } from "../scheduler/step-shell-executor.ts";
import type { Workflow } from "../workflow-models.ts";

test("JobScheduler - resets scheduler state across repeated runs and preserves listeners", async () => {
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
  expect(firstResults.build.conclusion).toEqual("failure");
  expect(firstResults.deploy.conclusion).toEqual("cancelled");
  expect(scheduler.getConclusion()).toEqual("failure");

  const secondContext = createBaseContext({
    env: { BUILD_COMMAND: "echo build=ok" },
  });
  const secondResults = await scheduler.run(secondContext);
  expect(secondResults.build.conclusion).toEqual("success");
  expect(secondResults.deploy.conclusion).toEqual("success");
  expect(scheduler.getConclusion()).toEqual("success");
  expect(lifecycleEvents).toEqual([
    "workflow:start",
    "workflow:complete",
    "workflow:start",
    "workflow:complete",
  ]);
});

test("defaultShellExecutor - caps buffered stdout", async () => {
  const result = await defaultShellExecutor("printf 'abcdefghijklmnop'", {
    maxStdoutBytes: 5,
  });

  expect(result.exitCode).toEqual(0);
  expect(result.stdout).toContain("abcde");
  expect(result.stdout).toContain("stdout truncated after 5 bytes");
});
