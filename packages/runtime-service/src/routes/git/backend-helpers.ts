import { Buffer } from "node:buffer";
import type { Context } from "hono";
import { runGitHttpBackend } from "../../runtime/git-http-backend.ts";
import { REPOS_BASE_DIR } from "../../shared/config.ts";
import type { RuntimeEnv } from "../../types/hono.d.ts";
import { validateRepoParams } from "./validators.ts";

export function validateGitPath(
  c: Context<RuntimeEnv>,
  suffix: string,
): string | { error: Response } {
  const params = validateRepoParams(c);
  if ("error" in params) return params;

  const { spaceId, repoName } = params;
  return `/${spaceId}/${repoName}.git/${suffix}`;
}

export function sendGitResult(
  result: { status: number; headers: Record<string, string>; body: Buffer },
): Response {
  const headers = new Headers();
  for (const [key, value] of Object.entries(result.headers)) {
    headers.set(key, value);
  }
  const responseBody = Uint8Array.from(result.body);
  return new Response(responseBody as unknown as BodyInit, {
    status: result.status,
    headers,
  });
}

export function createPackHandler(
  service: "git-upload-pack" | "git-receive-pack",
) {
  return async (c: Context<RuntimeEnv>) => {
    try {
      const gitPathResult = validateGitPath(c, service);
      if (typeof gitPathResult === "object" && "error" in gitPathResult) {
        return gitPathResult.error;
      }
      const gitPath = gitPathResult as string;

      const rawBody = Buffer.from(await c.req.arrayBuffer());

      return sendGitResult(
        await runGitHttpBackend({
          projectRoot: REPOS_BASE_DIR,
          gitPath,
          service,
          requestBody: rawBody,
          contentType: c.req.header("content-type"),
        }),
      );
    } catch (err) {
      c.get("log")?.error(`Git ${service} error`, { error: err as Error });
      return c.text("Internal server error", 500);
    }
  };
}
