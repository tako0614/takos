#!/usr/bin/env bun

import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { resolve } from "node:path";
import { Readable } from "node:stream";

import {
  runAuthenticatedStagingFunctionalProof,
  type AuthenticatedOwnerSessionTransport,
  type AuthenticatedStagingFunctionalProofOptions,
  type FirstInstallFunctionalProof,
} from "./local-agent-proof.ts";
import { readOwnerPrivateFile } from "./owner-private-input.ts";

const SESSION_COOKIE_NAME = "__Host-tp_session";
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/u;
const OWNER_DNS_TIMEOUT_MS = 10_000;
const OWNER_REQUEST_TIMEOUT_MS = 30_000;
const OWNER_TRANSPORT_TIMEOUT_MS = 5 * 60_000;

type ResolvedOwnerAddress = Readonly<{
  address: string;
  family: 4 | 6;
}>;

type PinnedOwnerFetch = (
  input: string,
  init: RequestInit,
  address: ResolvedOwnerAddress,
) => Promise<Response>;

const NON_GLOBAL_IPV4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  NON_GLOBAL_IPV4.addSubnet(network, prefix, "ipv4");
}

const GLOBAL_IPV6 = new BlockList();
GLOBAL_IPV6.addSubnet("2000::", 3, "ipv6");
const NON_GLOBAL_IPV6 = new BlockList();
for (const [network, prefix] of [
  ["2001::", 23],
  ["2002::", 16],
  ["3fff::", 20],
] as const) {
  NON_GLOBAL_IPV6.addSubnet(network, prefix, "ipv6");
}

export type FirstInstallFunctionalProofCliOptions = Readonly<{
  environment: "integration";
  publicUrl: string;
  sourceCommit: string;
  servedVersion: string;
  ownerSessionFile: string;
  repositoryRoot: string;
}>;

export const FIRST_INSTALL_FUNCTIONAL_PROOF_USAGE = `Usage:
  bun run first-install:functional-proof -- --environment integration --public-url <https origin> --source-commit <40hex> --served-version <uuid> --owner-session-file <absolute 0600 file>

The owner completes OIDC and any human MFA first, then writes only the resulting
Takos ${SESSION_COOKIE_NAME} value to the canonical owner-only session file.
No bearer/API key fallback is accepted. The proof creates and always deletes
one temporary Workspace. Origin DNS is resolved once before the session is read;
every answer must be globally routable and one address is pinned with the
original TLS SNI/Host for all requests. Exit 2 is pre-mutation refusal, exit 3
is indeterminate mutation/cleanup, and exit 4 is a failed post-condition after
an acknowledged mutation.`;

function fail(message: string): never {
  throw new Error(message);
}

export type FirstInstallFunctionalProofFailureStage =
  | "refused"
  | "indeterminate"
  | "post-conditions";

const FUNCTIONAL_PROOF_EXIT_CODES = {
  refused: 2,
  indeterminate: 3,
  "post-conditions": 4,
} as const;

export class FirstInstallFunctionalProofError extends Error {
  readonly stage: FirstInstallFunctionalProofFailureStage;
  readonly exitCode: 2 | 3 | 4;

  constructor(stage: FirstInstallFunctionalProofFailureStage) {
    super(
      stage === "refused"
        ? "functional proof refused before any product mutation"
        : stage === "indeterminate"
          ? "functional proof mutation or cleanup outcome is indeterminate"
          : "functional proof mutation landed but a required post-condition failed",
    );
    this.name = "FirstInstallFunctionalProofError";
    this.stage = stage;
    this.exitCode = FUNCTIONAL_PROOF_EXIT_CODES[stage];
  }
}

/**
 * Run the fixed authenticated proof while retaining only the lifecycle facts
 * needed to classify a failure safely. A thrown transport request after a
 * mutation, a mutation without a 2xx acknowledgement, or cleanup without its
 * exact acknowledgement is indeterminate. Once a mutation has a 2xx
 * acknowledgement, a locally proven functional mismatch is a post-condition
 * failure. Before any mutation is attempted, retry remains safe and the
 * operation is refused.
 */
export async function runFirstInstallFunctionalProofOwnerOperation(
  options: AuthenticatedStagingFunctionalProofOptions,
): Promise<FirstInstallFunctionalProof> {
  if (
    options.transport?.kind !==
    "takos.authenticated-owner-session-transport@v1"
  ) {
    throw new FirstInstallFunctionalProofError("refused");
  }
  let acknowledgedMutation = false;
  let indeterminate = false;
  let workspaceCreationAcknowledged = false;
  let cleanupAttempted = false;
  let cleanupAcknowledged = false;
  const transport: AuthenticatedOwnerSessionTransport = {
    kind: "takos.authenticated-owner-session-transport@v1",
    async request(request) {
      const mutating = request.method === "POST" || request.method === "DELETE";
      const cleanup =
        request.method === "DELETE" && request.path.startsWith("/api/spaces/");
      if (cleanup) cleanupAttempted = true;
      try {
        const response = await options.transport.request(request);
        if (mutating) {
          if (response.status >= 200 && response.status < 300) {
            acknowledgedMutation = true;
            if (request.method === "POST" && request.path === "/api/spaces") {
              workspaceCreationAcknowledged = true;
            }
          } else {
            indeterminate = true;
          }
        }
        if (cleanup) {
          const body =
            typeof response.body === "object" &&
              response.body !== null &&
              !Array.isArray(response.body)
              ? response.body as Record<string, unknown>
              : null;
          cleanupAcknowledged =
            response.status === 200 && body?.success === true;
          if (!cleanupAcknowledged) indeterminate = true;
        }
        return response;
      } catch (error) {
        if (mutating || acknowledgedMutation) indeterminate = true;
        throw error;
      }
    },
  };

  try {
    return await runAuthenticatedStagingFunctionalProof({
      ...options,
      transport,
    });
  } catch {
    const stage: FirstInstallFunctionalProofFailureStage =
      indeterminate ||
        (cleanupAttempted && !cleanupAcknowledged) ||
        (workspaceCreationAcknowledged && !cleanupAcknowledged)
        ? "indeterminate"
        : acknowledgedMutation
          ? "post-conditions"
          : "refused";
    throw new FirstInstallFunctionalProofError(stage);
  }
}

export function parseFirstInstallFunctionalProofArgs(
  args: readonly string[],
  repositoryRoot: string = process.cwd(),
): FirstInstallFunctionalProofCliOptions {
  const values = new Map<string, string>();
  const allowed = new Set([
    "--environment",
    "--public-url",
    "--source-commit",
    "--served-version",
    "--owner-session-file",
  ]);
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!allowed.has(name)) fail(`unknown argument ${name}`);
    if (!value || value.startsWith("--")) fail(`${name} requires a value`);
    if (values.has(name)) fail(`${name} may be specified only once`);
    values.set(name, value);
  }
  if (values.get("--environment") !== "integration") {
    fail("--environment must be integration for the staging functional proof");
  }
  const required = (name: string): string =>
    values.get(name) ?? fail(`${name} is required`);
  const ownerSessionFile = required("--owner-session-file");
  if (!ownerSessionFile.startsWith("/")) {
    fail("--owner-session-file must be an absolute path");
  }
  return {
    environment: "integration",
    publicUrl: required("--public-url"),
    sourceCommit: required("--source-commit"),
    servedVersion: required("--served-version"),
    ownerSessionFile,
    repositoryRoot: resolve(repositoryRoot),
  };
}

function normalizedOrigin(raw: string): string {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.port ||
    isIP(url.hostname) !== 0 ||
    url.hostname.endsWith(".") ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1"
  ) {
    fail("--public-url must be a canonical non-local HTTPS origin");
  }
  return url.origin;
}

function isGloballyRoutableAddress(answer: ResolvedOwnerAddress): boolean {
  if (isIP(answer.address) !== answer.family) return false;
  if (answer.family === 4) {
    return !NON_GLOBAL_IPV4.check(answer.address, "ipv4");
  }
  return GLOBAL_IPV6.check(answer.address, "ipv6") &&
    !NON_GLOBAL_IPV6.check(answer.address, "ipv6");
}

async function defaultResolveAddresses(
  hostname: string,
): Promise<readonly ResolvedOwnerAddress[]> {
  return (await lookup(hostname, { all: true, verbatim: true })).flatMap(
    (answer) =>
      answer.family === 4 || answer.family === 6
        ? [{ address: answer.address, family: answer.family }]
        : [],
  );
}

async function resolveAddressesOnce(
  hostname: string,
  resolver: (hostname: string) => Promise<readonly ResolvedOwnerAddress[]>,
): Promise<ResolvedOwnerAddress> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answers = await Promise.race([
      resolver(hostname),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("owner origin DNS resolution timed out")),
          OWNER_DNS_TIMEOUT_MS,
        );
      }),
    ]);
    if (
      answers.length === 0 ||
      answers.length > 64 ||
      answers.some((answer) => !isGloballyRoutableAddress(answer))
    ) {
      fail("owner origin must resolve only to bounded globally routable DNS answers");
    }
    return [...answers].sort((left, right) =>
      left.family - right.family || left.address.localeCompare(right.address)
    )[0]!;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

const defaultPinnedOwnerFetch: PinnedOwnerFetch = async (
  input,
  init,
  pinned,
) => {
  const url = new URL(input);
  const headers = new Headers(init.headers);
  headers.set("Host", url.host);
  const response = await new Promise<Response>((resolveResponse, reject) => {
    const request = httpsRequest(
      {
        protocol: "https:",
        hostname: pinned.address,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: init.method,
        headers: Object.fromEntries(headers.entries()),
        servername: url.hostname,
        family: pinned.family,
        signal: init.signal ?? undefined,
        agent: false,
      },
      (incoming) => {
        const responseHeaders = new Headers();
        for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
          const name = incoming.rawHeaders[index];
          const value = incoming.rawHeaders[index + 1];
          if (name !== undefined && value !== undefined) {
            responseHeaders.append(name, value);
          }
        }
        const status = incoming.statusCode ?? 502;
        if (status < 200 || status > 599) {
          incoming.destroy();
          reject(new Error("owner origin returned an invalid HTTP status"));
          return;
        }
        resolveResponse(
          new Response(
            Readable.toWeb(incoming) as unknown as BodyInit,
            { status, headers: responseHeaders },
          ),
        );
      },
    );
    request.once("error", reject);
    if (typeof init.body === "string") request.end(init.body);
    else request.end();
  });
  return response;
};

function sessionFromSetCookie(headers: Headers): string | null {
  const values = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : [headers.get("set-cookie") ?? ""];
  for (const value of values) {
    for (const cookie of value.split(/,(?=\s*[^;,=]+=[^;,]*)/u)) {
      const first = cookie.trim().split(";", 1)[0];
      const equals = first.indexOf("=");
      if (equals <= 0 || first.slice(0, equals) !== SESSION_COOKIE_NAME) continue;
      const candidate = first.slice(equals + 1);
      if (!SESSION_ID.test(candidate)) {
        fail("server returned an invalid owner session rotation");
      }
      return candidate;
    }
  }
  return null;
}

export async function createAuthenticatedOwnerSessionFileTransport(options: {
  publicUrl: string;
  ownerSessionFile: string;
  repositoryRoot: string;
  resolveAddresses?: (
    hostname: string,
  ) => Promise<readonly ResolvedOwnerAddress[]>;
  pinnedFetchImpl?: PinnedOwnerFetch;
}): Promise<AuthenticatedOwnerSessionTransport> {
  const origin = normalizedOrigin(options.publicUrl);
  const originUrl = new URL(origin);
  const pinnedAddress = await resolveAddressesOnce(
    originUrl.hostname,
    options.resolveAddresses ?? defaultResolveAddresses,
  );
  const transportDeadline = Date.now() + OWNER_TRANSPORT_TIMEOUT_MS;
  let sessionId = (await readOwnerPrivateFile(options.ownerSessionFile, {
    repositoryRoot: options.repositoryRoot,
    maxBytes: 256,
  })).trim();
  if (!SESSION_ID.test(sessionId)) {
    fail("owner session file must contain exactly one valid Takos session id");
  }
  const pinnedFetchImpl = options.pinnedFetchImpl ?? defaultPinnedOwnerFetch;
  return {
    kind: "takos.authenticated-owner-session-transport@v1",
    async request(request) {
      if (
        !request.path.startsWith("/") ||
        request.path.startsWith("//") ||
        request.path.includes("..") ||
        request.path.includes("\\") ||
        request.path.includes("?") ||
        request.path.includes("#") ||
        !["GET", "POST", "DELETE"].includes(request.method)
      ) {
        fail("owner session transport refused a non-canonical request");
      }
      const headers = new Headers({ Accept: "application/json" });
      if (request.scope === "owner") {
        headers.set("Cookie", `${SESSION_COOKIE_NAME}=${sessionId}`);
        headers.set("Origin", origin);
      }
      let body: string | undefined;
      if (request.body !== undefined) {
        headers.set("Content-Type", "application/json");
        body = JSON.stringify(request.body);
      }
      const remaining = transportDeadline - Date.now();
      if (remaining <= 0) fail("functional proof transport exceeded its total timeout");
      const response = await pinnedFetchImpl(`${origin}${request.path}`, {
        method: request.method,
        headers,
        ...(body === undefined ? {} : { body }),
        redirect: "error",
        signal: AbortSignal.timeout(
          Math.min(OWNER_REQUEST_TIMEOUT_MS, remaining),
        ),
      }, pinnedAddress);
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => undefined);
        fail("functional proof transport refused an HTTP redirect");
      }
      const rotated = request.scope === "owner"
        ? sessionFromSetCookie(response.headers)
        : null;
      if (rotated) sessionId = rotated;
      const text = await readBoundedResponseText(response, 4 * 1024 * 1024);
      if (text === null) {
        fail("functional proof response exceeded its size bound");
      }
      let parsed: unknown = {};
      if (text) {
        try {
          parsed = JSON.parse(text) as unknown;
        } catch {
          fail(`functional proof endpoint returned non-JSON (${response.status})`);
        }
      }
      return { status: response.status, body: parsed };
    },
  };
}

async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
): Promise<string | null> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

async function main(): Promise<void> {
  try {
    const options = parseFirstInstallFunctionalProofArgs(
      process.argv.slice(2),
      process.cwd(),
    );
    const transport = await createAuthenticatedOwnerSessionFileTransport({
      publicUrl: options.publicUrl,
      ownerSessionFile: options.ownerSessionFile,
      repositoryRoot: options.repositoryRoot,
    });
    const result = await runFirstInstallFunctionalProofOwnerOperation({
      transport,
      sourceCommit: options.sourceCommit,
      publicUrl: options.publicUrl,
      servedVersion: options.servedVersion,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n${FIRST_INSTALL_FUNCTIONAL_PROOF_USAGE}\n`,
    );
    process.exitCode = error instanceof FirstInstallFunctionalProofError
      ? error.exitCode
      : 2;
  }
}

if (import.meta.main) await main();
