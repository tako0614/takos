import { Command } from "commander";
import { assertEquals, assertRejects } from "jsr:@std/assert";
import { assertSpyCalls, stub } from "jsr:@std/testing/mock";
import { registerDeployCommand } from "../src/commands/deploy.ts";
import { CliCommandExit } from "../src/lib/command-exit.ts";

const translationReport = {
  provider: "cloudflare",
  supported: true,
  requirements: [],
  resources: [],
  workloads: [],
  routes: [],
  unsupported: [],
};

const diff = {
  hasChanges: true,
  entries: [{ name: "gateway", category: "worker", action: "create" }],
  summary: {
    create: 1,
    update: 0,
    delete: 0,
    unchanged: 0,
  },
};

const mutationResponse = {
  app_deployment: {
    id: "appdep-1",
    group: { id: "group-1", name: "demo-group" },
    source: {
      kind: "git_ref",
      repository_url: "https://github.com/acme/demo.git",
      ref: "main",
      ref_type: "branch",
      commit_sha: "sha-1",
      resolved_repo_id: null,
    },
    status: "applied",
    manifest_version: "1.0.0",
    hostnames: ["demo.example.com"],
    rollback_of_app_deployment_id: null,
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
  },
  apply_result: {
    applied: [
      {
        name: "gateway",
        category: "worker",
        action: "create",
        status: "success",
      },
    ],
    skipped: [],
    diff,
    translationReport,
  },
};

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerDeployCommand(program);
  return program;
}

function setAuthEnv() {
  Deno.env.set("TAKOS_TOKEN", "api-token");
  Deno.env.set("TAKOS_API_URL", "https://takos.dev");
  Deno.env.set("TAKOS_WORKSPACE_ID", "space-1");
}

function clearAuthEnv() {
  Deno.env.delete("TAKOS_TOKEN");
  Deno.env.delete("TAKOS_API_URL");
  Deno.env.delete("TAKOS_WORKSPACE_ID");
}

Deno.test("deploy command - creates a deployment from a repository URL", async () => {
  const fetchStub = stub(globalThis, "fetch", async (input, init) => {
    assertEquals(
      String(input),
      "https://takos.dev/api/spaces/space-1/app-deployments",
    );
    assertEquals(init?.method, "POST");
    return new Response(JSON.stringify(mutationResponse), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  });
  const logSpy = stub(console, "log", () => {});
  setAuthEnv();

  try {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "takos",
      "deploy",
      "https://github.com/acme/demo.git",
      "--ref",
      "main",
      "--ref-type",
      "branch",
      "--group",
      "demo-group",
      "--provider",
      "cloudflare",
      "--env",
      "production",
    ], { from: "node" });

    assertSpyCalls(fetchStub, 1);
    const requestInit = fetchStub.calls[0]?.args[1] as RequestInit | undefined;
    const body = JSON.parse(String(requestInit?.body));
    assertEquals(body.group_name, "demo-group");
    assertEquals(body.env, "production");
    assertEquals(body.provider, "cloudflare");
    assertEquals(body.source.kind, "git_ref");
    assertEquals(body.source.repository_url, "https://github.com/acme/demo.git");
    assertEquals(body.source.ref, "main");
    assertEquals(body.source.ref_type, "branch");
  } finally {
    fetchStub.restore();
    logSpy.restore();
    clearAuthEnv();
  }
});

Deno.test("deploy status command - fetches the requested deployment", async () => {
  const fetchStub = stub(globalThis, "fetch", async (input) => {
    assertEquals(
      String(input),
      "https://takos.dev/api/spaces/space-1/app-deployments/appdep-1",
    );
    return new Response(JSON.stringify({
      app_deployment: mutationResponse.app_deployment,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  const logSpy = stub(console, "log", () => {});
  setAuthEnv();

  try {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "takos",
      "deploy",
      "status",
      "appdep-1",
    ], { from: "node" });

    assertSpyCalls(fetchStub, 1);
  } finally {
    fetchStub.restore();
    logSpy.restore();
    clearAuthEnv();
  }
});

Deno.test("deploy rollback command - posts an empty rollback payload", async () => {
  const fetchStub = stub(globalThis, "fetch", async (input, init) => {
    assertEquals(
      String(input),
      "https://takos.dev/api/spaces/space-1/app-deployments/appdep-1/rollback",
    );
    assertEquals(init?.method, "POST");
    return new Response(JSON.stringify({
      ...mutationResponse,
      app_deployment: {
        ...mutationResponse.app_deployment,
        id: "appdep-2",
        rollback_of_app_deployment_id: "appdep-1",
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  const logSpy = stub(console, "log", () => {});
  setAuthEnv();

  try {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "takos",
      "deploy",
      "rollback",
      "appdep-1",
    ], { from: "node" });

    assertSpyCalls(fetchStub, 1);
    const requestInit = fetchStub.calls[0]?.args[1] as RequestInit | undefined;
    assertEquals(String(requestInit?.body), "{}");
  } finally {
    fetchStub.restore();
    logSpy.restore();
    clearAuthEnv();
  }
});

Deno.test("deploy command - requires a repository URL", async () => {
  const program = createProgram();
  const logSpy = stub(console, "log", () => {});

  try {
    await assertRejects(
      async () => {
        await program.parseAsync(["node", "takos", "deploy"], {
          from: "node",
        });
      },
      CliCommandExit,
    );
  } finally {
    logSpy.restore();
  }
});
