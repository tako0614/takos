import {
  canAccessRepositoryOwner,
  readInternalAuth,
  repositoryAccessDenied,
} from "./auth.ts";
import {
  configuredRepositoryIsActive,
  configuredRepositoryRoot,
  isSafeSmartHttpPath,
  notImplemented,
  readConfiguredRepositoryRecord,
} from "./git.ts";
import {
  type ChildProcess,
  getEnv,
  makeTempDirSync,
  spawnCommand,
} from "./runtime.ts";

const textDecoder = new TextDecoder();

// Default push-size cap = 100 MiB. Operators can raise/lower via
// TAKOS_GIT_MAX_PUSH_SIZE (bytes). Receive-pack stdin is also re-counted
// while streaming so a chunked / unset content-length cannot bypass this.
const DEFAULT_MAX_PUSH_SIZE = 100 * 1024 * 1024;

export function isGitSmartHttpPath(pathname: string): boolean {
  return pathname.endsWith(".git") || pathname.includes(".git/");
}

export async function handleSmartHttp(request: Request): Promise<Response> {
  const auth = await readInternalAuth(request);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: 401 });

  const root = configuredRepositoryRoot();
  if (!root) {
    return Response.json(notImplemented("git_smart_http_not_implemented"), {
      status: 501,
    });
  }

  const url = new URL(request.url);
  if (!isSafeSmartHttpPath(url.pathname)) {
    return Response.json({
      error: "invalid Git Smart HTTP path",
      code: "invalid_git_smart_http_path",
    }, { status: 400 });
  }

  // Force smart HTTP only: reject `GET <repo>.git/info/refs` without an
  // explicit `?service=git-upload-pack` or `?service=git-receive-pack`
  // query param. Dumb HTTP (no service param) leaks loose-object packs
  // through git http-backend and we do not want to support it.
  if (url.pathname.endsWith("/info/refs")) {
    const service = url.searchParams.get("service");
    if (service !== "git-upload-pack" && service !== "git-receive-pack") {
      return Response.json({
        error:
          "info/refs requires ?service=git-upload-pack or git-receive-pack",
        code: "git_smart_http_service_required",
      }, { status: 400 });
    }
  }

  const repositoryId = repositoryIdFromSmartHttpPath(url.pathname);
  const active = await configuredRepositoryIsActive(repositoryId);
  if (active === false) {
    return Response.json({
      error: "repository not found",
      code: "git_repository_not_found",
      repositoryId,
    }, { status: 404 });
  }
  const repository = await readConfiguredRepositoryRecord(repositoryId);
  // ACL is metadata-driven: if the metadata layer has no record for this
  // repository id, deny the request even if the on-disk bare repo exists.
  // Falling through to `git http-backend` would expose an unmanaged repo.
  if (!repository) {
    return Response.json({
      error: "repository not found",
      code: "git_repository_not_found",
      repositoryId,
    }, { status: 404 });
  }
  const receivePack = isReceivePack(url.pathname, url.searchParams);
  const access = receivePack ? "write" : "read";
  if (!canAccessRepositoryOwner(auth, repository.ownerSpaceId, access)) {
    return Response.json(repositoryAccessDenied(repositoryId), {
      status: 403,
    });
  }

  // Enforce push size limit before spawning git http-backend so an
  // oversize body cannot fill disk via pack receive.
  const maxPushSize = configuredMaxPushSize();
  if (receivePack) {
    const contentLengthRaw = request.headers.get("content-length");
    if (contentLengthRaw) {
      const declared = Number(contentLengthRaw);
      if (
        Number.isFinite(declared) && declared >= 0 && declared > maxPushSize
      ) {
        return Response.json({
          error: "push body exceeds TAKOS_GIT_MAX_PUSH_SIZE",
          code: "git_smart_http_push_too_large",
          maxBytes: maxPushSize,
        }, { status: 413 });
      }
    }
  }

  const contentType = request.headers.get("content-type");
  const contentLength = request.headers.get("content-length") ?? "0";
  // Build a closed-shape env so `git http-backend` does not inherit
  // `GIT_DIR`, `GIT_CONFIG_*`, `SSH_*`, `LD_*`, `HTTP_PROXY`, or any
  // other env from the parent process that could redirect it at a
  // different repo / fetch path / shared library. The base env carries
  // only PATH (sanitized), HOME (temp dir), LANG=C/LC_ALL=C, plus the
  // CGI variables the http-backend protocol requires.
  const env: Record<string, string> = {
    ...buildSmartHttpBaseEnv(),
    GIT_PROJECT_ROOT: root,
    GIT_HTTP_EXPORT_ALL: "1",
    PATH_INFO: url.pathname,
    QUERY_STRING: url.search.startsWith("?") ? url.search.slice(1) : "",
    REQUEST_METHOD: request.method,
    CONTENT_TYPE: contentType ?? "",
    CONTENT_LENGTH: contentLength,
    REMOTE_USER: "takos-git",
  };

  const child = spawnCommand("git", {
    args: ["http-backend"],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  // Stream request body to subprocess stdin without buffering the entire
  // payload. For receive-pack, also re-count bytes as they stream so a
  // chunked or missing content-length still cannot bypass the size cap.
  let oversize = false;
  if (request.body) {
    try {
      let received = 0;
      for await (const chunk of request.body) {
        if (receivePack) {
          received += chunk.byteLength;
          if (received > maxPushSize) {
            oversize = true;
            break;
          }
        }
        await child.stdin.write(chunk);
      }
    } catch (_error) {
      // Subprocess may have closed stdin; treat as transport error below.
    } finally {
      try {
        child.stdin.end();
      } catch (_closeError) {
        // ignore close errors; output handling below reports the failure
      }
    }
  } else {
    try {
      child.stdin.end();
    } catch (_error) {
      // ignore
    }
  }

  if (oversize) {
    try {
      child.kill("SIGTERM");
    } catch (_error) {
      // process may already be gone
    }
    // Drain child to release resources; ignore output content.
    await child.output().catch(() => {});
    return Response.json({
      error: "push body exceeds TAKOS_GIT_MAX_PUSH_SIZE",
      code: "git_smart_http_push_too_large",
      maxBytes: maxPushSize,
    }, { status: 413 });
  }

  // Receive-pack (push) responses are small status reports, so keep the
  // buffered path: it lets us surface a clean structured 500/502 before any
  // bytes are flushed and preserves the push-size cap semantics above.
  if (receivePack) {
    return await collectAndRespond(child);
  }
  // Upload-pack (clone/fetch) is the hot path whose pack stream can dwarf any
  // sane buffer cap. Stream child.stdout straight through to the response body
  // so large clones succeed without buffering the whole pack in memory. Only
  // the tiny CGI header block is pre-buffered (bounded below) to peel headers.
  return await streamUploadPackResponse(child);
}

// Hard ceiling on how many bytes we pre-buffer while searching for the CGI
// header terminator. A `git http-backend` header block is a few hundred bytes;
// 64 KiB leaves generous slack while ensuring a backend that never emits the
// boundary cannot buffer unbounded into memory.
const MAX_CGI_HEADER_PREBUFFER_BYTES = 64 * 1024;

async function streamUploadPackResponse(
  child: ChildProcess,
): Promise<Response> {
  const reader = child.stdout.getReader();

  // Pre-buffer just enough of stdout to locate the CGI header terminator. The
  // boundary may span chunk boundaries, so accumulate and re-scan after each
  // read. Bound the pre-buffer so a backend that never terminates its headers
  // cannot exhaust memory here.
  const prefixChunks: Uint8Array[] = [];
  let prefixBytes = 0;
  let header: ParsedCgiHeader | undefined;
  let bodyStartChunk: Uint8Array | undefined;
  let backendBroken = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      prefixChunks.push(value);
      prefixBytes += value.byteLength;
      const joined = concatChunks(prefixChunks, prefixBytes);
      const boundary = findHeaderBoundary(joined);
      if (boundary) {
        header = parseCgiHeader(joined.slice(0, boundary.headerEnd));
        bodyStartChunk = joined.slice(boundary.bodyStart);
        break;
      }
      if (prefixBytes > MAX_CGI_HEADER_PREBUFFER_BYTES) {
        backendBroken = true;
        break;
      }
    }
  } catch (_error) {
    backendBroken = true;
  }

  // No valid CGI header before stdout ended or the pre-buffer ceiling was hit:
  // the backend failed before flushing anything, so we can still return a
  // clean structured error envelope (no body bytes were sent to the client).
  if (!header || !bodyStartChunk) {
    try {
      reader.releaseLock();
    } catch (_error) {
      // ignore
    }
    await drainStderr(child);
    if (backendBroken) {
      try {
        child.kill("SIGTERM");
      } catch (_error) {
        // process may already be gone
      }
    }
    await child.status.catch(() => {});
    return Response.json({
      error: "git http-backend returned an invalid CGI response",
      code: "git_smart_http_invalid_backend_response",
    }, { status: 500 });
  }

  // Drain stderr concurrently so the subprocess can make progress (a full
  // stderr pipe would otherwise block git http-backend mid-stream).
  const stderrDrained = drainStderr(child);

  const firstChunk = bodyStartChunk;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (firstChunk.byteLength > 0) controller.enqueue(firstChunk);
    },
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          try {
            reader.releaseLock();
          } catch (_error) {
            // ignore
          }
          // Surface a mid-stream backend failure by aborting the body. Headers
          // are already flushed, so the client sees a truncated transfer (git
          // treats an incomplete pack as a retryable error) rather than a
          // clean envelope — an accepted tradeoff for unbuffered streaming.
          await stderrDrained.catch(() => {});
          const status = await child.status.catch(() => undefined);
          if (status && !status.success) {
            controller.error(
              new Error("git http-backend exited with a non-zero status"),
            );
            return;
          }
          controller.close();
          return;
        }
        if (value && value.byteLength > 0) controller.enqueue(value);
      } catch (error) {
        try {
          reader.releaseLock();
        } catch (_releaseError) {
          // ignore
        }
        controller.error(error);
      }
    },
    cancel() {
      // Client hung up: stop the backend and release resources.
      try {
        child.kill("SIGTERM");
      } catch (_error) {
        // process may already be gone
      }
      try {
        reader.releaseLock();
      } catch (_error) {
        // ignore
      }
      void stderrDrained.catch(() => {});
      void child.status.catch(() => {});
    },
  });

  return new Response(stream, {
    status: header.status,
    headers: header.headers,
  });
}

async function drainStderr(child: ChildProcess): Promise<void> {
  try {
    const stderrReader = child.stderr.getReader();
    try {
      while (true) {
        const { done } = await stderrReader.read();
        if (done) break;
      }
    } finally {
      try {
        stderrReader.releaseLock();
      } catch (_error) {
        // ignore
      }
    }
  } catch (_error) {
    // ignore: stderr drain is best-effort and never consumed.
  }
}

interface ParsedCgiHeader {
  status: number;
  headers: Headers;
}

function parseCgiHeader(headerBytes: Uint8Array): ParsedCgiHeader {
  const headersText = textDecoder.decode(headerBytes);
  const headers = new Headers();
  let status = 200;
  for (const line of headersText.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (name.toLowerCase() === "status") {
      status = Number(value.split(/\s+/, 1)[0]) || status;
    } else {
      headers.append(name, value);
    }
  }
  return { status, headers };
}

const DEFAULT_MAX_BUFFERED_RESPONSE_BYTES = 500 * 1024 * 1024;

function configuredMaxBufferedResponseBytes(): number {
  const raw = getEnv("TAKOS_GIT_MAX_RESPONSE_SIZE")?.trim();
  if (!raw) return DEFAULT_MAX_BUFFERED_RESPONSE_BYTES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_BUFFERED_RESPONSE_BYTES;
  }
  return Math.floor(parsed);
}

// Buffered response path, used only for receive-pack (push) whose response is
// a small status report. Upload-pack (clone/fetch) streams instead (see
// streamUploadPackResponse) so large packs are never buffered. Buffering here
// lets us return a clean structured 500/502 before any bytes are flushed and
// keeps the TAKOS_GIT_MAX_RESPONSE_SIZE per-request memory cap on this path.
async function collectAndRespond(child: ChildProcess): Promise<Response> {
  const maxBufferedBytes = configuredMaxBufferedResponseBytes();
  // Collect stdout chunks into an array and concatenate once at the end, the
  // same O(n) pattern used for stderr below. The previous grow-and-copy
  // (allocate buffered+chunk and re-copy the whole accumulator per read) was
  // O(n^2). The cap bounds memory per request.
  const stdoutChunks: Uint8Array[] = [];
  let bufferedBytes = 0;
  let truncated = false;
  const reader = child.stdout.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (bufferedBytes + value.byteLength > maxBufferedBytes) {
        truncated = true;
        break;
      }
      stdoutChunks.push(value);
      bufferedBytes += value.byteLength;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch (_error) {
      // ignore
    }
  }

  // Drain stderr so the process can exit; output is not retained.
  await drainStderr(child);

  if (truncated) {
    try {
      child.kill("SIGTERM");
    } catch (_error) {
      // ignore
    }
    await child.status.catch(() => {});
    return Response.json({
      error: "git http-backend response exceeds buffered cap",
      code: "git_smart_http_response_too_large",
    }, { status: 502 });
  }

  const status = await child.status;
  if (!status.success) {
    return Response.json({
      error: "git http-backend failed",
      code: "git_smart_http_backend_failed",
    }, { status: 500 });
  }
  const buffered = concatChunks(stdoutChunks, bufferedBytes);
  return cgiResponse(buffered);
}

function concatChunks(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const out = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function configuredMaxPushSize(): number {
  const raw = getEnv("TAKOS_GIT_MAX_PUSH_SIZE")?.trim();
  if (!raw) return DEFAULT_MAX_PUSH_SIZE;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_PUSH_SIZE;
  return Math.floor(parsed);
}

function isReceivePack(path: string, params: URLSearchParams): boolean {
  return path.endsWith("/git-receive-pack") ||
    params.get("service") === "git-receive-pack";
}

function repositoryIdFromSmartHttpPath(pathname: string): string {
  const withoutPrefix = pathname.startsWith("/git/")
    ? pathname.slice("/git/".length)
    : pathname.slice(1);
  const gitIndex = withoutPrefix.indexOf(".git");
  const raw = gitIndex >= 0 ? withoutPrefix.slice(0, gitIndex) : withoutPrefix;
  return decodeURIComponent(raw);
}

function cgiResponse(output: Uint8Array): Response {
  const boundary = findHeaderBoundary(output);
  if (!boundary) {
    return Response.json({
      error: "git http-backend returned an invalid CGI response",
      code: "git_smart_http_invalid_backend_response",
    }, { status: 500 });
  }

  const { status, headers } = parseCgiHeader(
    output.slice(0, boundary.headerEnd),
  );
  const body = output.slice(boundary.bodyStart);
  // Copy into a fresh ArrayBuffer so the response body type is stable.
  const copy = new Uint8Array(body.byteLength);
  copy.set(body);
  return new Response(copy, { status, headers });
}

function findHeaderBoundary(
  output: Uint8Array,
): { headerEnd: number; bodyStart: number } | undefined {
  for (let index = 0; index < output.length - 3; index++) {
    if (
      output[index] === 13 && output[index + 1] === 10 &&
      output[index + 2] === 13 && output[index + 3] === 10
    ) {
      return { headerEnd: index, bodyStart: index + 4 };
    }
  }
  for (let index = 0; index < output.length - 1; index++) {
    if (output[index] === 10 && output[index + 1] === 10) {
      return { headerEnd: index, bodyStart: index + 2 };
    }
  }
}

let cachedSmartHttpHome: string | undefined;

function smartHttpHome(): string {
  if (cachedSmartHttpHome !== undefined) return cachedSmartHttpHome;
  try {
    cachedSmartHttpHome = makeTempDirSync("takos-git-http-home-");
  } catch {
    cachedSmartHttpHome = "/tmp";
  }
  return cachedSmartHttpHome;
}

/**
 * Closed-shape base environment for the `git http-backend` CGI process.
 * Drops `GIT_*` overrides, `SSH_*`, `LD_*`, `XDG_*`, and proxy vars from
 * the parent inherit so a hostile env cannot redirect smart HTTP at a
 * different repo or swap shared libraries under git.
 */
function buildSmartHttpBaseEnv(): Record<string, string> {
  const overridePath = getEnv("TAKOS_GIT_PATH")?.trim();
  const path = overridePath && overridePath.length > 0
    ? overridePath
    : "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
  return {
    PATH: path,
    HOME: smartHttpHome(),
    LANG: "C",
    LC_ALL: "C",
    GIT_TERMINAL_PROMPT: "0",
  };
}
