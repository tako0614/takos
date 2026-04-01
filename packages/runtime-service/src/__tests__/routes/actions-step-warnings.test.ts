import { createTestApp, testRequest } from "../setup.ts";

import { assert, assertEquals, assertObjectMatch } from "@std/assert";

Deno.env.set("TAKOS_API_URL", "https://takos.example.test");

const { default: actionsRoutes } = await import(
  "../../routes/actions/index.ts"
);

function createStepJobBody(jobName: string) {
  return {
    space_id: "workspace-step-warnings",
    repoId: "acme/repo",
    ref: "refs/heads/main",
    sha: "a".repeat(40),
    workflowPath: ".takos/workflows/ci.yml",
    jobName,
    steps: [{ name: "step-1", run: "echo hello" }],
  };
}

Deno.test("actions step behavior - returns a successful step response", async () => {
  const app = createTestApp();
  app.route("/", actionsRoutes);

  const jobId = `step-mask-${Date.now()}`;

  try {
    const startResponse = await testRequest(app, {
      method: "POST",
      path: `/actions/jobs/${jobId}/start`,
      body: createStepJobBody("mask-job"),
    });

    assertEquals(startResponse.status, 200);

    const stepResponse = await testRequest(app, {
      method: "POST",
      path: `/actions/jobs/${jobId}/step/0`,
      body: {
        name: "step-1",
        run: "echo hello",
      },
    });

    assertEquals(stepResponse.status, 200);
    assertObjectMatch(stepResponse.body as Record<string, unknown>, {
      conclusion: "success",
    });
    assert(!("warnings" in (stepResponse.body as Record<string, unknown>)));
    assertEquals((stepResponse.body as { stdout?: string }).stdout, "hello\n");
  } finally {
    await testRequest(app, {
      method: "DELETE",
      path: `/actions/jobs/${jobId}`,
    });
  }
});

Deno.test("actions step behavior - completes repeat steps successfully", async () => {
  const app = createTestApp();
  app.route("/", actionsRoutes);

  const jobId = `with-run-id-${Date.now()}`;

  try {
    const startResponse = await testRequest(app, {
      method: "POST",
      path: `/actions/jobs/${jobId}/start`,
      body: createStepJobBody("run-id-job"),
    });
    assertEquals(startResponse.status, 200);

    const stepResponse = await testRequest(app, {
      method: "POST",
      path: `/actions/jobs/${jobId}/step/0`,
      body: {
        name: "step-1",
        run: "echo hello",
      },
    });

    assertEquals(stepResponse.status, 200);
    assertEquals((stepResponse.body as { stdout?: string }).stdout, "hello\n");
  } finally {
    await testRequest(app, {
      method: "DELETE",
      path: `/actions/jobs/${jobId}`,
    });
  }
});

Deno.test("actions step behavior - handles repeated job creation and execution", async () => {
  const app = createTestApp();
  app.route("/", actionsRoutes);

  const jobId = `fallback-run-id-${Date.now()}`;

  try {
    const startResponse = await testRequest(app, {
      method: "POST",
      path: `/actions/jobs/${jobId}/start`,
      body: createStepJobBody("fallback-run-id-job"),
    });
    assertEquals(startResponse.status, 200);

    const stepResponse = await testRequest(app, {
      method: "POST",
      path: `/actions/jobs/${jobId}/step/0`,
      body: {
        name: "step-1",
        run: "echo hello",
      },
    });

    assertEquals(stepResponse.status, 200);
    assertEquals((stepResponse.body as { stdout?: string }).stdout, "hello\n");
  } finally {
    await testRequest(app, {
      method: "DELETE",
      path: `/actions/jobs/${jobId}`,
    });
  }
});
