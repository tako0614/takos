import { assertEquals } from "jsr:@std/assert";

import type { AppManifest } from "../../source/app-manifest-types.ts";
import { compileGroupDesiredState } from "../group-state.ts";
import { selectScheduledDispatchTargets } from "../scheduled-triggers.ts";

function buildDesiredState() {
  const manifest: AppManifest = {
    name: "cron-app",
    compute: {
      api: {
        kind: "worker",
        build: {
          fromWorkflow: {
            path: ".takos/workflows/deploy.yml",
            job: "bundle",
            artifact: "api",
            artifactPath: "dist/worker",
          },
        },
        triggers: {
          schedules: [
            { cron: "*/15 * * * *" },
            { cron: "0 * * * *" },
          ],
        },
      },
      jobs: {
        kind: "worker",
        build: {
          fromWorkflow: {
            path: ".takos/workflows/deploy.yml",
            job: "bundle",
            artifact: "jobs",
            artifactPath: "dist/worker",
          },
        },
        triggers: {
          schedules: [
            { cron: "*/15 * * * *" },
            { cron: "*/15 * * * *" },
          ],
        },
      },
      service: {
        kind: "service",
        image: "ghcr.io/example/service:latest",
      },
    },
    routes: [],
    publish: [],
    env: {},
  };

  return compileGroupDesiredState(manifest, {
    groupName: "cron-app",
    backend: "cloudflare",
    envName: "default",
  });
}

Deno.test("selectScheduledDispatchTargets - selects only matching worker schedules", () => {
  const desiredState = buildDesiredState();
  const targets = selectScheduledDispatchTargets(desiredState, "*/15 * * * *", {
    groupId: "group-1",
    observedState: {
      workloads: {
        api: {
          routeRef: "cron-app-api-route",
        },
        jobs: {
          routeRef: "cron-app-jobs-route",
        },
      },
    },
  });

  assertEquals(targets, [
    {
      groupId: "group-1",
      groupName: "cron-app",
      workloadName: "api",
      routeRef: "cron-app-api-route",
      cron: "*/15 * * * *",
    },
    {
      groupId: "group-1",
      groupName: "cron-app",
      workloadName: "jobs",
      routeRef: "cron-app-jobs-route",
      cron: "*/15 * * * *",
    },
  ]);
});

Deno.test("selectScheduledDispatchTargets - falls back to workload name when routeRef is missing", () => {
  const desiredState = buildDesiredState();
  const targets = selectScheduledDispatchTargets(desiredState, "0 * * * *");

  assertEquals(targets, [
    {
      groupId: "cron-app",
      groupName: "cron-app",
      workloadName: "api",
      routeRef: "api",
      cron: "0 * * * *",
    },
  ]);
});

Deno.test("selectScheduledDispatchTargets - deduplicates duplicate cron entries", () => {
  const desiredState = buildDesiredState();
  const targets = selectScheduledDispatchTargets(desiredState, "*/15 * * * *");

  assertEquals(targets, [
    {
      groupId: "cron-app",
      groupName: "cron-app",
      workloadName: "api",
      routeRef: "api",
      cron: "*/15 * * * *",
    },
    {
      groupId: "cron-app",
      groupName: "cron-app",
      workloadName: "jobs",
      routeRef: "jobs",
      cron: "*/15 * * * *",
    },
  ]);
});

Deno.test("selectScheduledDispatchTargets - matches canonical quarter-hour schedules on offset control crons", () => {
  const desiredState = buildDesiredState();
  const targets = selectScheduledDispatchTargets(
    desiredState,
    "3,18,33,48 * * * *",
    {
      groupId: "group-1",
    },
  );

  assertEquals(targets, [
    {
      groupId: "group-1",
      groupName: "cron-app",
      workloadName: "api",
      routeRef: "api",
      cron: "*/15 * * * *",
    },
    {
      groupId: "group-1",
      groupName: "cron-app",
      workloadName: "jobs",
      routeRef: "jobs",
      cron: "*/15 * * * *",
    },
  ]);
});

Deno.test("selectScheduledDispatchTargets - matches canonical hourly schedules on offset control crons", () => {
  const desiredState = buildDesiredState();
  const targets = selectScheduledDispatchTargets(
    desiredState,
    "5 * * * *",
    {
      groupId: "group-1",
    },
  );

  assertEquals(targets, [
    {
      groupId: "group-1",
      groupName: "cron-app",
      workloadName: "api",
      routeRef: "api",
      cron: "0 * * * *",
    },
  ]);
});
