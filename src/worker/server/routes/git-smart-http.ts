/**
 * Takos built-in Git Smart HTTP compatibility quarantine.
 *
 * Legacy repository metadata and R2 objects are preserved for a separate,
 * explicit migration. Until that migration can preserve repository ownership
 * and access control, this route must not inspect repositories, authenticate a
 * read, advertise refs, consume upload-pack bodies, or access object storage.
 * Clone, fetch, push, and collaborative hosting belong to the installed
 * `takos-git` Capsule through its `source.git.smart_http` Interface.
 */

import { Hono } from "hono";
import type { Env } from "../../shared/types/index.ts";

const gitSmartHttp = new Hono<{ Bindings: Env }>();

function jsonResponse(
  body: Record<string, string>,
  status: number,
  cacheControl?: string,
): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (cacheControl) headers["cache-control"] = cacheControl;
  return new Response(JSON.stringify(body), { status, headers });
}

function compatibilityQuarantined(): Response {
  return jsonResponse(
    {
      error:
        "Takos built-in Git compatibility is quarantined pending an explicit migration; use the installed takos-git source.git.smart_http Interface",
      code: "git_compatibility_quarantined",
    },
    503,
    "no-store",
  );
}

function pushDisabled(): Response {
  return jsonResponse(
    {
      error:
        "push is unavailable on the Takos compatibility endpoint; use the installed takos-git source.git.smart_http Interface",
      code: "git_push_disabled",
    },
    403,
  );
}

gitSmartHttp.get("/git/:owner/:repo/info/refs", (c) => {
  const service = c.req.query("service");
  if (service === "git-receive-pack") return pushDisabled();
  if (service === "git-upload-pack") return compatibilityQuarantined();
  return jsonResponse(
    {
      error: "info/refs requires ?service=git-upload-pack",
      code: "git_smart_http_service_required",
    },
    400,
  );
});

gitSmartHttp.post(
  "/git/:owner/:repo/git-upload-pack",
  compatibilityQuarantined,
);

gitSmartHttp.post("/git/:owner/:repo/git-receive-pack", pushDisabled);

export default gitSmartHttp;
