import { Buffer } from "node:buffer";
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { assertEquals } from "jsr:@std/assert";
import { testRequest } from "../../setup.ts";

function generateKeyPair() {
  return crypto.generateKeyPairSync("rsa", {
    modulusLength: 1024,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

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
  const { createRuntimeServiceApp } = await import("../../../app.ts");
  const { sessionStore } = await import("../../../routes/sessions/storage.ts");
  return { createRuntimeServiceApp, sessionStore };
}

Deno.test({
  name:
    "repo write scope - requires scoped space to match session-backed workDir",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const originalTakosApiUrl = Deno.env.get("TAKOS_API_URL");
    const originalJwtPublicKey = Deno.env.get("JWT_PUBLIC_KEY");
    const { privateKey, publicKey } = generateKeyPair();
    Deno.env.set("TAKOS_API_URL", "https://takos.example.test");
    Deno.env.set("JWT_PUBLIC_KEY", publicKey);

    let sessionId = "";
    let workDir = "";

    try {
      const { createRuntimeServiceApp, sessionStore } = await loadRuntimeApp();
      const app = createRuntimeServiceApp({ isProduction: false });
      const token = signServiceToken({
        issuer: "takos-control",
        subject: "takos-runtime-test",
        audience: "takos-runtime",
        privateKey,
        scope_space_id: "ws-beta",
      });

      sessionId = `a12345678901234${Date.now().toString().slice(-1)}`;
      workDir = await sessionStore.getSessionDir(sessionId, "ws-alpha");
      await fs.mkdir(path.join(workDir, ".git"), { recursive: true });

      const commitResponse = await testRequest(app as never, {
        method: "POST",
        path: "/repos/commit",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: {
          workDir,
          message: "test commit",
        },
      });

      assertEquals(commitResponse.status, 403);
      assertEquals(commitResponse.body, {
        error: {
          code: "FORBIDDEN",
          message: "Token space scope does not match requested space",
        },
      });

      const pushResponse = await testRequest(app as never, {
        method: "POST",
        path: "/repos/push",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: {
          workDir,
          space_id: "ws-beta",
        },
      });

      assertEquals(pushResponse.status, 403);
      assertEquals(pushResponse.body, {
        error: {
          code: "FORBIDDEN",
          message: "workDir does not belong to the specified space",
        },
      });
    } finally {
      if (sessionId) {
        const { sessionStore } = await loadRuntimeApp();
        await sessionStore.destroySession(sessionId, "ws-alpha").catch(() =>
          undefined
        );
      } else if (workDir) {
        await fs.rm(workDir, { recursive: true, force: true }).catch(() =>
          undefined
        );
      }

      if (originalTakosApiUrl === undefined) {
        Deno.env.delete("TAKOS_API_URL");
      } else {
        Deno.env.set("TAKOS_API_URL", originalTakosApiUrl);
      }

      if (originalJwtPublicKey === undefined) {
        Deno.env.delete("JWT_PUBLIC_KEY");
      } else {
        Deno.env.set("JWT_PUBLIC_KEY", originalJwtPublicKey);
      }
    }
  },
});
