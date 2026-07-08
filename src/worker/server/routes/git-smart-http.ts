/**
 * Git Smart HTTP (v0/v1) — read-only clone/fetch served directly from the
 * worker-native, R2-backed loose-object store. This is the user-facing git
 * remote: `git clone https://<host>/git/<owner>/<repo>.git`.
 *
 * Scope: `git-upload-pack` (clone/fetch) only. `git-receive-pack` (push) is
 * intentionally refused — writes go through the Takos repository API/UI. Objects
 * are streamed as an undeltified packfile (see `pack.ts`).
 *
 * Auth: HTTP Basic where the password is a Takos access token (username is
 * ignored, matching the GitHub PAT convention). Public repositories allow
 * anonymous read; private repositories require a token whose user has read
 * access to the owning space.
 */

import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import type { Env } from "../../shared/types/index.ts";
import { accounts, getDb, repositories } from "../../infra/db/index.ts";
import * as gitStore from "../../application/services/takos-git/index.ts";
import { writePackFromShas } from "../../application/services/takos-git/local/core/pack.ts";
import {
  parsePktLines,
  PKT_FLUSH,
  pktLineString,
} from "../../application/services/takos-git/local/core/pack-common.ts";
import { concatBytes } from "../../application/services/takos-git/local/core/sha1.ts";
import { checkRepoAccess } from "../../application/services/source/repos.ts";
import { resolveAccountsBearerFromHeader } from "../middleware/accounts-bearer.ts";
import { authDeps } from "../middleware/auth.ts";
import { toGitBucket } from "../../shared/utils/git-bucket.ts";
import { logError } from "../../shared/utils/logger.ts";

const ZERO_OID = "0".repeat(40);
const AGENT = "agent=takos-git/0.1";

/** Return a plain ArrayBuffer view suitable for a Response body. */
function bytesToBody(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes.buffer as ArrayBuffer;
  }
  return bytes.slice().buffer as ArrayBuffer;
}

interface ResolvedRepo {
  readonly id: string;
  readonly visibility: string;
}

async function resolveRepo(
  env: Pick<Env, "DB">,
  owner: string,
  repoParam: string,
): Promise<ResolvedRepo | null> {
  const name = repoParam.replace(/\.git$/, "");
  if (!owner || !name) return null;
  const db = getDb(env.DB);
  const account = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.slug, owner))
    .get();
  if (!account) return null;
  const repo = await db
    .select({ id: repositories.id, visibility: repositories.visibility })
    .from(repositories)
    .where(
      and(eq(repositories.accountId, account.id), eq(repositories.name, name)),
    )
    .get();
  return repo ?? null;
}

/** Decode the `password` from an HTTP Basic header; git sends the token there. */
function basicPassword(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, encoded] = header.split(" ", 2);
  if (scheme?.toLowerCase() !== "basic" || !encoded) return null;
  try {
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(encoded), (ch) => ch.charCodeAt(0)),
    );
    const colon = decoded.indexOf(":");
    return colon === -1 ? decoded : decoded.slice(colon + 1);
  } catch {
    return null;
  }
}

type AuthOutcome =
  | { ok: true; userId: string | null }
  | { ok: false; response: Response };

function unauthorized(): Response {
  return new Response(
    JSON.stringify({ error: "authentication required", code: "git_unauthorized" }),
    {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": 'Basic realm="Takos Git", charset="UTF-8"',
      },
    },
  );
}

function notFoundResponse(): Response {
  return new Response(
    JSON.stringify({ error: "repository not found", code: "git_repository_not_found" }),
    { status: 404, headers: { "content-type": "application/json" } },
  );
}

/**
 * Authenticate a read request. Returns the resolved user id (or null for an
 * anonymous read of a public repo). On failure, returns a ready Response:
 * missing credentials → 401 (prompt); present-but-no-access → 404 (no
 * existence leak), matching how the JSON API hides private repos.
 */
// deno-lint-ignore no-explicit-any
async function authenticateRead(
  c: any,
  repo: ResolvedRepo,
): Promise<AuthOutcome> {
  const authHeader = c.req.header("Authorization");
  const token = basicPassword(authHeader);

  let userId: string | null = null;
  if (token) {
    const bearer = await resolveAccountsBearerFromHeader(
      c,
      authDeps,
      `Bearer ${token}`,
    );
    if (bearer.kind === "ok") {
      userId = bearer.userId;
    } else {
      // A supplied-but-invalid token is a hard failure, not an anonymous read.
      return { ok: false, response: unauthorized() };
    }
  }

  const access = await checkRepoAccess(c.env, repo.id, userId, undefined, {
    allowPublicRead: true,
  });
  if (access) return { ok: true, userId };

  if (!token) return { ok: false, response: unauthorized() };
  return { ok: false, response: notFoundResponse() };
}

interface AdvertisedRefs {
  readonly lines: Array<{ sha: string; name: string }>;
  readonly tips: Set<string>;
  readonly headSymref: string | null;
  readonly headSha: string | null;
}

async function loadAdvertisedRefs(
  env: Pick<Env, "DB">,
  repoId: string,
): Promise<AdvertisedRefs> {
  const [refs, defaultBranch] = await Promise.all([
    gitStore.listAllRefs(env.DB, repoId),
    gitStore.getDefaultBranch(env.DB, repoId),
  ]);

  const lines: Array<{ sha: string; name: string }> = [];
  const tips = new Set<string>();
  let headSymref: string | null = null;
  let headSha: string | null = null;

  if (defaultBranch) {
    headSymref = `refs/heads/${defaultBranch.name}`;
    headSha = defaultBranch.commit_sha;
    lines.push({ sha: headSha, name: "HEAD" });
    tips.add(headSha);
  }

  for (const ref of refs) {
    lines.push({ sha: ref.target, name: ref.name });
    tips.add(ref.target);
  }

  return { lines, tips, headSymref, headSha };
}

function buildUploadPackAdvertisement(refs: AdvertisedRefs): Uint8Array {
  const capParts = [AGENT, "object-format=sha1"];
  if (refs.headSymref) capParts.unshift(`symref=HEAD:${refs.headSymref}`);
  const caps = capParts.join(" ");

  const parts: Uint8Array[] = [
    pktLineString("# service=git-upload-pack\n"),
    PKT_FLUSH,
  ];

  if (refs.lines.length === 0) {
    parts.push(pktLineString(`${ZERO_OID} capabilities^{}\0${caps}\n`));
  } else {
    refs.lines.forEach((line, index) => {
      const suffix = index === 0 ? `\0${caps}` : "";
      parts.push(pktLineString(`${line.sha} ${line.name}${suffix}\n`));
    });
  }
  parts.push(PKT_FLUSH);
  return concatBytes(...parts);
}

function parseUploadPackRequest(
  body: Uint8Array,
): { wants: string[]; haves: string[] } {
  const wants: string[] = [];
  const haves: string[] = [];
  const decoder = new TextDecoder();
  for (const line of parsePktLines(body)) {
    if (!line.payload) continue;
    const text = decoder.decode(line.payload).trimEnd();
    if (text.startsWith("want ")) {
      const sha = text.slice(5, 45);
      if (/^[0-9a-f]{40}$/.test(sha)) wants.push(sha);
    } else if (text.startsWith("have ")) {
      const sha = text.slice(5, 45);
      if (/^[0-9a-f]{40}$/.test(sha)) haves.push(sha);
    }
  }
  return { wants, haves };
}

const gitSmartHttp = new Hono<{ Bindings: Env }>();

// Push is not served here — the object store is written through the repo API.
function pushDisabled(): Response {
  return new Response(
    JSON.stringify({
      error: "push over git is disabled; commit through the Takos API or UI",
      code: "git_push_disabled",
    }),
    { status: 403, headers: { "content-type": "application/json" } },
  );
}

gitSmartHttp.get("/git/:owner/:repo/info/refs", async (c) => {
  const service = c.req.query("service");
  if (service === "git-receive-pack") return pushDisabled();
  if (service !== "git-upload-pack") {
    return c.json(
      {
        error: "info/refs requires ?service=git-upload-pack",
        code: "git_smart_http_service_required",
      },
      400,
    );
  }

  const repo = await resolveRepo(c.env, c.req.param("owner"), c.req.param("repo"));
  if (!repo) return notFoundResponse();

  const auth = await authenticateRead(c, repo);
  if (!auth.ok) return auth.response;

  const refs = await loadAdvertisedRefs(c.env, repo.id);
  const body = buildUploadPackAdvertisement(refs);
  return new Response(bytesToBody(body), {
    status: 200,
    headers: {
      "content-type": "application/x-git-upload-pack-advertisement",
      "cache-control": "no-cache",
    },
  });
});

gitSmartHttp.post("/git/:owner/:repo/git-upload-pack", async (c) => {
  const repo = await resolveRepo(c.env, c.req.param("owner"), c.req.param("repo"));
  if (!repo) return notFoundResponse();

  const auth = await authenticateRead(c, repo);
  if (!auth.ok) return auth.response;

  if (!c.env.GIT_OBJECTS) {
    return c.json(
      { error: "git object storage is not configured", code: "git_storage_not_configured" },
      501,
    );
  }

  const body = new Uint8Array(await c.req.arrayBuffer());
  const { wants, haves } = parseUploadPackRequest(body);

  if (wants.length === 0) {
    return c.json({ error: "no want lines", code: "git_no_wants" }, 400);
  }

  // IDOR guard: object keys are content-addressed and NOT tenant-prefixed, so a
  // `want` must be an advertised tip of THIS repo. Anything else could pull
  // another tenant's objects by SHA.
  const refs = await loadAdvertisedRefs(c.env, repo.id);
  for (const want of wants) {
    if (!refs.tips.has(want)) {
      return c.json(
        { error: "want is not an advertised ref of this repository", code: "git_invalid_want" },
        400,
      );
    }
  }

  try {
    const bucket = toGitBucket(c.env.GIT_OBJECTS);
    const shas = await gitStore.collectReachableObjects(
      c.env.DB,
      bucket,
      repo.id,
      wants,
      new Set(haves),
    );
    const { pack, missing } = await writePackFromShas(bucket, shas);
    if (missing.length > 0) {
      logError("upload-pack: reachable objects missing from store", undefined, {
        module: "routes/git-smart-http",
        repoId: repo.id,
        missing: missing.length,
      });
      return c.json(
        { error: "repository objects are incomplete", code: "git_repository_incomplete" },
        500,
      );
    }

    const response = concatBytes(pktLineString("NAK\n"), pack);
    return new Response(bytesToBody(response), {
      status: 200,
      headers: {
        "content-type": "application/x-git-upload-pack-result",
        "cache-control": "no-cache",
      },
    });
  } catch (err) {
    logError("upload-pack failed", err, { module: "routes/git-smart-http" });
    return c.json({ error: "failed to build pack", code: "git_pack_failed" }, 500);
  }
});

gitSmartHttp.post("/git/:owner/:repo/git-receive-pack", () => pushDisabled());

export default gitSmartHttp;
