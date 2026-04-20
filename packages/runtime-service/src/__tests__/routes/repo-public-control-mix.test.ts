import { assertEquals } from "@std/assert";
import { createTestApp, testRequest } from "../setup.ts";

Deno.env.set("TAKOS_API_URL", "https://takos.example.test");

const repoReadRoutes = (await import("../../routes/repos/read.ts")).default;
const repoWriteRoutes = (await import("../../routes/repos/write.ts")).default;

Deno.test("runtime-service repo docs drift - public repoId routes return a common envelope", async () => {
  const app = createTestApp();
  app.route("/", repoReadRoutes);
  app.route("/", repoWriteRoutes);

  const getStatus = await testRequest(app, {
    method: "GET",
    path: "/repos/repo_123/status",
  });
  assertEquals(getStatus.status, 400);
  assertEquals(getStatus.body, {
    error: {
      code: "BAD_REQUEST",
      message:
        "Runtime-service repo routes use /repos/:spaceId/:repoName/*. Public repoId routes are handled by the control API under /api/repos/:repoId/*.",
    },
  });

  const postCommit = await testRequest(app, {
    method: "POST",
    path: "/repos/repo_123/commit",
    body: {},
  });
  assertEquals(postCommit.status, 400);
  assertEquals(postCommit.body, getStatus.body);
});
