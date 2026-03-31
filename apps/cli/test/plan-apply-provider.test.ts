import fs from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";

import { assertEquals } from "jsr:@std/assert";
import { assertSpyCalls, stub } from "jsr:@std/testing/mock";

import { registerApplyCommand } from "../src/commands/apply.ts";
import { registerPlanCommand } from "../src/commands/plan.ts";

const manifestYaml = `apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: sample-app
  appId: dev.takos.sample-app
spec:
  version: 1.0.0
  description: Sample app
  workers:
    gateway:
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build-gateway
          artifact: gateway-dist
          artifactPath: dist/gateway.mjs
`;

const translationReport = {
  provider: "cloudflare",
  supported: true,
  requirements: [],
  resources: [],
  workloads: [],
  routes: [],
  unsupported: [],
};

const noChangeDiff = {
  hasChanges: false,
  entries: [],
  summary: {
    create: 0,
    update: 0,
    delete: 0,
    unchanged: 0,
  },
};

async function withCliProject<T>(
  fn: (projectDir: string) => Promise<T>,
): Promise<T> {
  const originalCwd = Deno.cwd();
  const projectDir = await Deno.makeTempDir({ prefix: "takos-cli-provider-" });
  const takosDir = path.join(projectDir, ".takos");
  const distDir = path.join(projectDir, "dist");

  await fs.mkdir(takosDir, { recursive: true });
  await fs.mkdir(distDir, { recursive: true });
  await fs.writeFile(path.join(takosDir, "app.yml"), manifestYaml, "utf8");
  await fs.writeFile(
    path.join(distDir, "gateway.mjs"),
    'export default { async fetch() { return new Response("ok"); } };',
    "utf8",
  );
  Deno.chdir(projectDir);

  try {
    return await fn(projectDir);
  } finally {
    Deno.chdir(originalCwd);
    await fs.rm(projectDir, { recursive: true, force: true });
  }
}

function createProgram(): Command {
  const program = new Command();
  registerPlanCommand(program);
  registerApplyCommand(program);
  program.exitOverride();
  return program;
}

Deno.test("plan/apply provider option - passes provider in the plan API payload", async () => {
  const fetchStub = stub(globalThis, "fetch", async (input, init) => {
    const url = String(input);
    assertEquals(
      url,
      "https://takos.dev/api/spaces/space-1/groups/plan",
    );
    assertEquals(init?.method, "POST");

    return new Response(
      JSON.stringify({
        group: { id: "group-1", name: "sample-app" },
        diff: noChangeDiff,
        translationReport,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  });

  Deno.env.set("TAKOS_TOKEN", "api-token");
  Deno.env.set("TAKOS_API_URL", "https://takos.dev");
  Deno.env.set("TAKOS_WORKSPACE_ID", "space-1");

  try {
    await withCliProject(async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "takos",
        "plan",
        "--provider",
        "aws",
        "--env",
        "production",
      ]);
    });

    assertSpyCalls(fetchStub, 1);
    const requestInit = fetchStub.calls[0]?.args[1] as RequestInit | undefined;
    const planBody = JSON.parse(String(requestInit?.body));
    assertEquals(planBody.group_name, "sample-app");
    assertEquals(planBody.env, "production");
    assertEquals(planBody.provider, "aws");
    assertEquals(planBody.manifest.apiVersion, "takos.dev/v1alpha1");
    assertEquals(planBody.manifest.kind, "App");
    assertEquals(planBody.manifest.metadata.name, "sample-app");
    assertEquals(planBody.manifest.metadata.appId, "dev.takos.sample-app");
    assertEquals(typeof planBody.manifest.spec.workers.gateway, "object");
  } finally {
    fetchStub.restore();
    Deno.env.delete("TAKOS_TOKEN");
    Deno.env.delete("TAKOS_API_URL");
    Deno.env.delete("TAKOS_WORKSPACE_ID");
  }
});

Deno.test("plan/apply provider option - passes provider in both plan and apply API payloads", async () => {
  let callIndex = 0;
  const fetchStub = stub(globalThis, "fetch", async (_input, init) => {
    callIndex += 1;

    if (callIndex === 1) {
      return new Response(
        JSON.stringify({
          group: { id: "group-1", name: "sample-app" },
          diff: {
            ...noChangeDiff,
            hasChanges: true,
            entries: [{ name: "x", category: "resource", action: "create" }],
          },
          translationReport,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        id: "g-1",
        groupId: "g-1",
        applied: [{
          name: "x",
          category: "resource",
          action: "create",
          status: "success",
        }],
        skipped: [],
        diff: {
          ...noChangeDiff,
          hasChanges: true,
          entries: [{ name: "x", category: "resource", action: "create" }],
        },
        translationReport,
        group: { id: "group-1", name: "sample-app" },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  });

  Deno.env.set("TAKOS_TOKEN", "api-token");
  Deno.env.set("TAKOS_API_URL", "https://takos.dev");
  Deno.env.set("TAKOS_WORKSPACE_ID", "space-1");

  try {
    await withCliProject(async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "takos",
        "apply",
        "--provider",
        "gcp",
        "--auto-approve",
        "--env",
        "staging",
      ]);
    });

    assertSpyCalls(fetchStub, 2);

    const planRequest = fetchStub.calls[0];
    assertEquals(
      String(planRequest?.args[0]),
      "https://takos.dev/api/spaces/space-1/groups/plan",
    );
    const planBody = JSON.parse(
      String((planRequest?.args[1] as RequestInit | undefined)?.body),
    );
    assertEquals(planBody.group_name, "sample-app");
    assertEquals(planBody.env, "staging");
    assertEquals(planBody.provider, "gcp");
    assertEquals(planBody.manifest.apiVersion, "takos.dev/v1alpha1");
    assertEquals(planBody.manifest.kind, "App");
    assertEquals(planBody.manifest.metadata.name, "sample-app");
    assertEquals(planBody.manifest.metadata.appId, "dev.takos.sample-app");

    const applyRequest = fetchStub.calls[1];
    assertEquals(
      String(applyRequest?.args[0]),
      "https://takos.dev/api/spaces/space-1/groups/apply",
    );
    const applyBody = JSON.parse(
      String((applyRequest?.args[1] as RequestInit | undefined)?.body),
    );
    assertEquals(applyBody.group_name, "sample-app");
    assertEquals(applyBody.env, "staging");
    assertEquals(applyBody.provider, "gcp");
    assertEquals(applyBody.manifest.apiVersion, "takos.dev/v1alpha1");
    assertEquals(applyBody.manifest.kind, "App");
    assertEquals(applyBody.manifest.metadata.name, "sample-app");
    assertEquals(applyBody.manifest.metadata.appId, "dev.takos.sample-app");
    assertEquals(applyBody.artifacts.gateway.kind, "worker-bundle");
    assertEquals(
      applyBody.artifacts.gateway.bundleContent,
      'export default { async fetch() { return new Response("ok"); } };',
    );
  } finally {
    fetchStub.restore();
    Deno.env.delete("TAKOS_TOKEN");
    Deno.env.delete("TAKOS_API_URL");
    Deno.env.delete("TAKOS_WORKSPACE_ID");
  }
});
