#!/usr/bin/env -S bun
import { and, eq } from "drizzle-orm";
import * as jose from "jose";
import {
  accounts,
  authIdentities,
  getDb,
} from "../src/worker/infra/db/index.ts";
import { createNodeWebEnv } from "../src/worker/node-platform/env-builder.ts";
import { dispatchControlRpc } from "../src/worker/runtime/executor-proxy-api.ts";
import { isControlRpcPath } from "../src/worker/runtime/container-hosts/executor-utils.ts";
import type { Env } from "../src/worker/shared/types/index.ts";
import { LOCAL_AGENT_PROOF_ASSISTANT_MARKER } from "./local-agent-proof.ts";

type JsonRecord = Record<string, unknown>;

type ProofLease = {
  readonly runId: string;
  readonly serviceId: string;
  readonly leaseVersion?: number;
};

const port = positiveIntegerEnv("PORT", 8790);
const issuer = normalizedUrl(
  requiredEnv("OIDC_ISSUER_URL", `http://agent-proof-runtime:${port}`),
);
const publicControlBaseUrl = normalizedUrl(
  requiredEnv(
    "TAKOS_AGENT_PROOF_CONTROL_BASE_URL",
    `http://agent-proof-runtime:${port}`,
  ),
);
const agentBaseUrl = normalizedUrl(
  requiredEnv("TAKOS_AGENT_INTERNAL_URL", "http://takos-agent:8789"),
);
const startToken = requiredEnv(
  "TAKOS_AGENT_START_TOKEN",
  "local-agent-start-token",
);
const proofSecret = requiredEnv(
  "TAKOS_AGENT_PROOF_SECRET",
  "local-agent-proof-secret",
);
const dispatchSecret = requiredSecretEnv("TAKOS_AGENT_PROOF_DISPATCH_SECRET");
const modelKey = requiredEnv(
  "TAKOS_AGENT_PROOF_MODEL_KEY",
  "local-agent-proof-model-key",
);
const modelBaseUrl = normalizedUrl(
  requiredEnv(
    "TAKOS_AGENT_PROOF_MODEL_BASE_URL",
    `http://agent-proof-runtime:${port}/v1`,
  ),
);

const { publicKey, privateKey } = await jose.generateKeyPair("RS256", {
  extractable: true,
});
const signingKeyId = "local-agent-proof-rs256";
const publicJwk = {
  ...(await jose.exportJWK(publicKey)),
  alg: "RS256",
  kid: signingKeyId,
  use: "sig",
};

let proofEnvPromise: Promise<Env> | null = null;
const leases = new Map<string, ProofLease>();

const server = Bun.serve({
  hostname: "0.0.0.0",
  port,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") {
      return json({
        status: "ok",
        service: "takos-local-agent-proof-runtime",
      });
    }

    if (url.pathname === "/oauth/jwks" && request.method === "GET") {
      return json({ keys: [publicJwk] });
    }

    if (
      url.pathname === "/.well-known/openid-configuration" &&
      request.method === "GET"
    ) {
      return json({
        issuer,
        jwks_uri: `${issuer}/oauth/jwks`,
        token_endpoint: `${issuer}/__proof/token-not-public`,
      });
    }

    if (url.pathname === "/__proof/bootstrap" && request.method === "POST") {
      if (!hasBearer(request, proofSecret)) return unauthorized();
      const proofEnv = await getProofEnv();
      const identity = await ensureProofIdentity(proofEnv, issuer);
      const accessToken = await new jose.SignJWT({
        scope: "admin",
        token_use: "access",
      })
        .setProtectedHeader({ alg: "RS256", kid: signingKeyId, typ: "at+jwt" })
        .setIssuer(issuer)
        .setSubject(identity.subject)
        .setIssuedAt()
        .setExpirationTime("10m")
        .sign(privateKey);
      return json({
        accessToken,
        userId: identity.userId,
        issuer,
      });
    }

    if (url.pathname === "/v1/models" && request.method === "GET") {
      return json({
        object: "list",
        data: [{ id: "gpt-5.5", object: "model", owned_by: "local-proof" }],
      });
    }

    if (url.pathname === "/v1/chat/completions" && request.method === "POST") {
      if (!hasBearer(request, modelKey)) return unauthorized();
      return json({
        id: "chatcmpl-local-agent-proof",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "local-agent-proof",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: LOCAL_AGENT_PROOF_ASSISTANT_MARKER,
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 11,
          completion_tokens: 9,
          total_tokens: 20,
        },
      });
    }

    if (url.pathname === "/dispatch" && request.method === "POST") {
      if (!hasBearer(request, dispatchSecret)) return unauthorized();
      await getProofEnv();
      const body = await readJsonRecord(request);
      const runId = nonEmptyString(body.runId);
      const serviceId =
        nonEmptyString(body.serviceId) ?? nonEmptyString(body.workerId);
      if (!runId || !serviceId) {
        return json({ error: "Missing runId or serviceId" }, 400);
      }
      const controlRpcToken = crypto.randomUUID();
      const leaseVersion =
        typeof body.leaseVersion === "number" ? body.leaseVersion : undefined;
      leases.set(controlRpcToken, { runId, serviceId, leaseVersion });

      const startPayload = {
        ...body,
        runId,
        serviceId,
        workerId: serviceId,
        controlRpcBaseUrl: publicControlBaseUrl,
        controlRpcToken,
        startToken,
      };
      let agentResponse: Response;
      try {
        agentResponse = await fetch(`${agentBaseUrl}/start`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${startToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(startPayload),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (error) {
        leases.delete(controlRpcToken);
        return json(
          {
            error: `Failed to call takos-agent /start: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
          502,
        );
      }
      const responseBody = await agentResponse.text();
      if (!agentResponse.ok) leases.delete(controlRpcToken);
      return new Response(responseBody, {
        status: agentResponse.status,
        headers: {
          "content-type":
            agentResponse.headers.get("content-type") ?? "application/json",
        },
      });
    }

    if (isControlRpcPath(url.pathname)) {
      if (request.method !== "POST" && request.method !== "GET") {
        return json({ error: "Method not allowed" }, 405);
      }
      const token = bearerToken(request);
      const lease = token ? leases.get(token) : undefined;
      const headerRunId = request.headers.get("x-takos-run-id")?.trim();
      if (!lease || !headerRunId || headerRunId !== lease.runId) {
        return unauthorized();
      }
      const proofEnv = await getProofEnv();
      const body =
        request.method === "POST"
          ? await readJsonRecord(request)
          : Object.fromEntries(url.searchParams.entries());
      body.runId = lease.runId;
      body.serviceId = lease.serviceId;
      body.workerId = lease.serviceId;
      if (lease.leaseVersion !== undefined) {
        body.leaseVersion = lease.leaseVersion;
      }
      const dispatched = dispatchControlRpc(url.pathname, body, proofEnv);
      if (!dispatched) return json({ error: "Unknown control RPC" }, 404);
      return await dispatched;
    }

    return json({ error: "Not found" }, 404);
  },
});

console.log(
  `[local-agent-proof-runtime] listening on ${server.hostname}:${server.port}`,
);

function getProofEnv(): Promise<Env> {
  if (!proofEnvPromise) {
    proofEnvPromise = createNodeWebEnv()
      .then(
        (nodeEnv) =>
          ({
            ...nodeEnv,
            OPENAI_API_KEY: modelKey,
            OPENAI_BASE_URL: modelBaseUrl,
            // This is a separate process, so its in-memory offload bucket cannot
            // be observed by the public worker. Keep proof evidence in shared SQL.
            TAKOS_OFFLOAD: undefined,
          }) as Env,
      )
      .catch((error) => {
        proofEnvPromise = null;
        throw error;
      });
  }
  return proofEnvPromise;
}

async function ensureProofIdentity(
  env: Env,
  normalizedIssuer: string,
): Promise<{ userId: string; subject: string }> {
  const userId = "acct_local_agent_proof";
  const subject = "local-agent-proof-subject";
  const now = new Date().toISOString();
  const db = getDb(env.DB);
  const account = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, userId))
    .get();
  if (!account) {
    await db.insert(accounts).values({
      id: userId,
      type: "user",
      status: "active",
      name: "Local Agent Proof",
      slug: "local-agent-proof",
      email: "agent-proof@local.test",
      ownerAccountId: userId,
      aiModel: "gpt-5.5",
      modelBackend: "openai",
      securityPosture: "standard",
      setupCompleted: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  const providerSub = `${normalizedIssuer}#${subject}`;
  const identity = await db
    .select({ id: authIdentities.id })
    .from(authIdentities)
    .where(
      and(
        eq(authIdentities.provider, "oidc"),
        eq(authIdentities.providerSub, providerSub),
      ),
    )
    .get();
  if (!identity) {
    await db.insert(authIdentities).values({
      id: "auth_local_agent_proof",
      userId,
      provider: "oidc",
      providerSub,
      emailSnapshot: "agent-proof@local.test",
      emailKind: "verified",
      linkedAt: now,
      lastLoginAt: now,
      tokenScope: "admin",
    });
  }
  return { userId, subject };
}

async function readJsonRecord(request: Request): Promise<JsonRecord> {
  const value = await request.json().catch(() => null);
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function unauthorized(): Response {
  return json({ error: "Unauthorized" }, 401);
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice(7).trim() || null;
}

function hasBearer(request: Request, expected: string): boolean {
  const presented = bearerToken(request);
  return presented !== null && presented === expected;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredEnv(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function requiredSecretEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizedUrl(value: string): string {
  return new URL(value).toString().replace(/\/$/u, "");
}
