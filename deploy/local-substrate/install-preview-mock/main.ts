/**
 * Mock install_preview service for local-substrate.
 *
 * The real preview service (takosumi-git) clones a git repo, parses
 * `.takosumi/app.yml`, resolves the commit + manifest digests, and returns
 * a structured response. Here we don't actually clone anything — we just
 * derive deterministic fake values from {gitUrl, ref} so the install
 * wizard can complete a full preview → install round-trip in local
 * testing without needing a real git mirror.
 *
 * Wire env (worker → mock):
 *   TAKOSUMI_ACCOUNTS_INSTALL_PREVIEW_URL=http://install-preview-mock:8788
 */

const PORT = Number(Deno.env.get("PORT") ?? "8788");

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function appIdFromGitUrl(gitUrl: string): string {
  try {
    const u = new URL(gitUrl);
    const last = u.pathname.split("/").filter(Boolean).pop() ?? "fake-app";
    return last.replace(/\.git$/, "");
  } catch {
    return "fake-app";
  }
}

Deno.serve({ port: PORT, hostname: "0.0.0.0" }, async (req) => {
  const url = new URL(req.url);
  if (url.pathname === "/healthz") {
    return new Response("ok", { headers: { "content-type": "text/plain" } });
  }
  if (url.pathname !== "/v1/install/preview") {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (req.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const source = (body.source ?? {}) as Record<string, unknown>;
  const gitUrl = String(source.gitUrl ?? source.url ?? body.gitUrl ?? "");
  const ref = String(source.ref ?? body.ref ?? "main");
  if (!gitUrl) {
    return Response.json({ error: "invalid_request", error_description: "source.gitUrl required" }, { status: 400 });
  }

  const fingerprint = await sha256Hex(`${gitUrl}@${ref}`);
  const appId = appIdFromGitUrl(gitUrl);
  const commit = fingerprint.slice(0, 40);
  const digest = fingerprint;
  console.log(`[install-preview-mock] preview ${appId} from ${gitUrl}@${ref} → commit=${commit.slice(0, 12)}...`);

  return Response.json({
    appId,
    source: {
      gitUrl,
      ref,
      commit,
      appManifestDigest: `sha256:${digest}`,
      compiledManifestDigest: `sha256:${digest}`,
    },
    bindings: [],
    grants: [],
    metadata: {
      mock: true,
      service: "install-preview-mock (local-substrate)",
      generatedAt: new Date().toISOString(),
    },
  });
});

console.log(`[install-preview-mock] listening on :${PORT}`);
