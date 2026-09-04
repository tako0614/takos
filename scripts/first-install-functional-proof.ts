#!/usr/bin/env bun

import { resolve } from "node:path";

import {
  runAuthenticatedStagingFunctionalProof,
  type AuthenticatedOwnerSessionTransport,
} from "./local-agent-proof.ts";
import { readOwnerPrivateFile } from "./owner-private-input.ts";

const SESSION_COOKIE_NAME = "__Host-tp_session";
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/u;

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
one temporary Workspace.`;

function fail(message: string): never {
  throw new Error(message);
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
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1"
  ) {
    fail("--public-url must be a canonical non-local HTTPS origin");
  }
  return url.origin;
}

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
  fetchImpl?: typeof fetch;
}): Promise<AuthenticatedOwnerSessionTransport> {
  const origin = normalizedOrigin(options.publicUrl);
  let sessionId = (await readOwnerPrivateFile(options.ownerSessionFile, {
    repositoryRoot: options.repositoryRoot,
    maxBytes: 256,
  })).trim();
  if (!SESSION_ID.test(sessionId)) {
    fail("owner session file must contain exactly one valid Takos session id");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    kind: "takos.authenticated-owner-session-transport@v1",
    async request(request) {
      if (
        !request.path.startsWith("/") ||
        request.path.startsWith("//") ||
        request.path.includes("..") ||
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
      const response = await fetchImpl(`${origin}${request.path}`, {
        method: request.method,
        headers,
        ...(body === undefined ? {} : { body }),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
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
    const result = await runAuthenticatedStagingFunctionalProof({
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
    process.exitCode = 2;
  }
}

if (import.meta.main) await main();
