import { Buffer } from "node:buffer";
import * as crypto from "node:crypto";

import { assertEquals } from "jsr:@std/assert";
import { assertSpyCalls, stub } from "jsr:@std/testing/mock";
import { testRequest } from "../setup.ts";

function generateKeyPair() {
  return crypto.generateKeyPairSync("rsa", {
    modulusLength: 1024,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

const runtimeJwtKeys = generateKeyPair();
Deno.env.set("TAKOS_API_URL", "https://takos.example.test");
Deno.env.set("PROXY_BASE_URL", "https://runtime-host.example.test");
Deno.env.set("JWT_PUBLIC_KEY", runtimeJwtKeys.publicKey);

function signServiceToken(options: {
  issuer: string;
  subject: string;
  audience: string;
  privateKey: string;
  scope_space_id?: string;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload: Record<string, unknown> = {
    iss: options.issuer,
    sub: options.subject,
    aud: options.audience,
    iat: now,
    exp: now + 120,
    jti: crypto.randomUUID(),
  };
  if (options.scope_space_id) {
    payload.scope_space_id = options.scope_space_id;
  }
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString(
    "base64url",
  );
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signingInput);
  sign.end();
  const signature = sign.sign(options.privateKey).toString("base64url");
  return `${signingInput}.${signature}`;
}

async function loadRuntimeApp() {
  const { createRuntimeServiceApp } = await import("../../app.ts");
  const { sessionStore } = await import("../../routes/sessions/storage.ts");
  return { createRuntimeServiceApp, sessionStore };
}

Deno.test({
  name:
    "runtime space scope - exact POST /sessions rejects mismatched scoped tokens",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { createRuntimeServiceApp } = await loadRuntimeApp();
    const app = createRuntimeServiceApp({ isProduction: false });
    const token = signServiceToken({
      issuer: "takos-control",
      subject: "takos-runtime-test",
      audience: "takos-runtime",
      privateKey: runtimeJwtKeys.privateKey,
      scope_space_id: "ws-alpha",
    });

    const response = await testRequest(app as never, {
      method: "POST",
      path: "/sessions",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: {
        session_id: "a12345678901234j",
        space_id: "ws-beta",
      },
    });
    assertEquals(response.status, 403);
    assertEquals(response.body, {
      error: {
        code: "FORBIDDEN",
        message: "Token space scope does not match requested space",
      },
    });
  },
});

Deno.test({
  name:
    "runtime space scope - cli-proxy honors scoped JWT space over X-Takos-Space-Id",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const heartbeatFetchStub = stub(
      globalThis,
      "fetch",
      (async () =>
        new Response(null, {
          status: 204,
        })) as typeof globalThis.fetch,
    );
    let heartbeatRestored = false;

    try {
      const { createRuntimeServiceApp, sessionStore } = await loadRuntimeApp();
      const sessionId = "a12345678901234k";
      await sessionStore.getSessionDir(
        sessionId,
        "ws-alpha",
        undefined,
        "proxy-token",
      );

      heartbeatFetchStub.restore();
      heartbeatRestored = true;

      const app = createRuntimeServiceApp({ isProduction: false });
      const token = signServiceToken({
        issuer: "takos-control",
        subject: "takos-runtime-test",
        audience: "takos-runtime",
        privateKey: runtimeJwtKeys.privateKey,
        scope_space_id: "ws-beta",
      });

      const fetchSpy = stub(
        globalThis,
        "fetch",
        (async () =>
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })) as typeof globalThis.fetch,
      );

      try {
        const response = await testRequest(app as never, {
          method: "GET",
          path: "/cli-proxy/api/repos/repo-1/status",
          headers: {
            Authorization: `Bearer ${token}`,
            "X-Takos-Session-Id": sessionId,
            "X-Takos-Space-Id": "ws-alpha",
          },
        });

        assertEquals(response.status, 403);
        assertEquals(response.body, {
          error: {
            code: "FORBIDDEN",
            message: "Session does not belong to the specified space",
          },
        });
        assertSpyCalls(fetchSpy, 0);
      } finally {
        fetchSpy.restore();
        await sessionStore.destroySession(sessionId, "ws-alpha");
      }
    } finally {
      if (!heartbeatRestored) {
        heartbeatFetchStub.restore();
      }
    }
  },
});

Deno.test({
  name:
    "runtime space scope - actions follow-up routes reject mismatched job scope",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const jobId = `scope-job-${Date.now()}`;
    let wsAlphaToken = "";

    try {
      const { createRuntimeServiceApp } = await loadRuntimeApp();
      const app = createRuntimeServiceApp({ isProduction: false });
      wsAlphaToken = signServiceToken({
        issuer: "takos-control",
        subject: "takos-runtime-test",
        audience: "takos-runtime",
        privateKey: runtimeJwtKeys.privateKey,
        scope_space_id: "ws-alpha",
      });
      const wsBetaToken = signServiceToken({
        issuer: "takos-control",
        subject: "takos-runtime-test",
        audience: "takos-runtime",
        privateKey: runtimeJwtKeys.privateKey,
        scope_space_id: "ws-beta",
      });
      const startResponse = await testRequest(app as never, {
        method: "POST",
        path: `/actions/jobs/${jobId}/start`,
        headers: {
          Authorization: `Bearer ${wsAlphaToken}`,
        },
        body: {
          space_id: "ws-alpha",
          repoId: "acme/repo",
          ref: "refs/heads/main",
          sha: "a".repeat(40),
          workflowPath: ".takos/workflows/ci.yml",
          steps: [{ name: "step-1", run: "echo hello" }],
        },
      });
      assertEquals(startResponse.status, 200);

      const mismatchHeaders = {
        Authorization: `Bearer ${wsBetaToken}`,
      };

      const checkoutResponse = await testRequest(app as never, {
        method: "POST",
        path: `/actions/jobs/${jobId}/checkout`,
        headers: mismatchHeaders,
        body: {},
      });
      assertEquals(checkoutResponse.status, 403);

      const stepResponse = await testRequest(app as never, {
        method: "POST",
        path: `/actions/jobs/${jobId}/step/0`,
        headers: mismatchHeaders,
        body: {
          run: "echo hello",
        },
      });
      assertEquals(stepResponse.status, 403);

      const completeResponse = await testRequest(app as never, {
        method: "POST",
        path: `/actions/jobs/${jobId}/complete`,
        headers: mismatchHeaders,
        body: {
          conclusion: "success",
        },
      });
      assertEquals(completeResponse.status, 403);

      const deleteResponse = await testRequest(app as never, {
        method: "DELETE",
        path: `/actions/jobs/${jobId}`,
        headers: mismatchHeaders,
      });
      assertEquals(deleteResponse.status, 403);
    } finally {
      if (wsAlphaToken) {
        const { createRuntimeServiceApp } = await loadRuntimeApp();
        const app = createRuntimeServiceApp({ isProduction: false });
        await testRequest(app as never, {
          method: "DELETE",
          path: `/actions/jobs/${jobId}`,
          headers: {
            Authorization: `Bearer ${wsAlphaToken}`,
          },
        }).catch(() => undefined);
      }
    }
  },
});
