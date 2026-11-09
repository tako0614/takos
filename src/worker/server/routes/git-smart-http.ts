/**
 * Tombstone for retired Worker-native Git hosting.
 *
 * Standalone takos-git owns source.git.smart_http. Legacy repositories and
 * objects stay intact for explicit migration; this route neither reads them
 * nor resolves credentials, and never guesses a replacement remote.
 */
import { Hono } from "hono";
import type { Env } from "../../shared/types/index.ts";

export function isLegacyGitPath(pathname: string): boolean {
  return pathname === "/git" || pathname.startsWith("/git/");
}

export function legacyGitQuarantineResponse(): Response {
  return Response.json(
    {
      error: "Legacy Git hosting requires repository migration to the installed takos-git source.git.smart_http Interface.",
      code: "git_legacy_migration_required",
    },
    {
      status: 410,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

const gitSmartHttp = new Hono<{ Bindings: Env }>();
gitSmartHttp.all("/git", () => legacyGitQuarantineResponse());
gitSmartHttp.all("/git/*", () => legacyGitQuarantineResponse());

export default gitSmartHttp;
