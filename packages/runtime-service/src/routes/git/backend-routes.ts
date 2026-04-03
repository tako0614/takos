import type { Hono } from "hono";
import type { RuntimeEnv } from "../../types/hono.d.ts";
import { runGitHttpBackend } from "../../runtime/git-http-backend.ts";
import { REPOS_BASE_DIR } from "../../shared/config.ts";
import {
  createPackHandler,
  sendGitResult,
  validateGitPath,
} from "./backend-helpers.ts";

export function registerGitBackendRoutes(app: Hono<RuntimeEnv>): void {
  app.get("/git/:spaceId/:repoName.git/info/refs", async (c) => {
    try {
      const service = c.req.query("service");

      if (
        !service || !["git-upload-pack", "git-receive-pack"].includes(service)
      ) {
        return c.text("Invalid service parameter", 400);
      }

      const gitPathResult = validateGitPath(c, "info/refs");
      if (typeof gitPathResult === "object" && "error" in gitPathResult) {
        return gitPathResult.error;
      }
      const gitPath = gitPathResult as string;

      return sendGitResult(
        await runGitHttpBackend({
          projectRoot: REPOS_BASE_DIR,
          gitPath,
          service,
          requestBody: null,
          contentType: undefined,
        }),
      );
    } catch (err) {
      c.get("log")?.error("Git info/refs error", { error: err as Error });
      return c.text("Internal server error", 500);
    }
  });

  app.post(
    "/git/:spaceId/:repoName.git/git-upload-pack",
    createPackHandler("git-upload-pack"),
  );

  app.post(
    "/git/:spaceId/:repoName.git/git-receive-pack",
    createPackHandler("git-receive-pack"),
  );
}
