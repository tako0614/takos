import { Buffer } from "node:buffer";
import * as crypto from "node:crypto";

import { assertEquals } from "jsr:@std/assert";
import { createTestApp, testRequest } from "../setup.ts";

function generateTestKeyPair() {
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
}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: options.issuer,
    sub: options.subject,
    aud: options.audience,
    iat: now,
    exp: now + 120,
    jti: crypto.randomUUID(),
  };
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

async function freshImport<T>(relativePath: string): Promise<T> {
  const url = new URL(relativePath, import.meta.url);
  url.searchParams.set("test", crypto.randomUUID());
  return await import(url.href) as T;
}

Deno.test({
  name:
    "runtime service exact rate-limit middleware covers /exec, /sessions, and /session/snapshot",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const originalTakosApiUrl = Deno.env.get("TAKOS_API_URL");
    const originalJwtPublicKey = Deno.env.get("JWT_PUBLIC_KEY");
    const { privateKey, publicKey } = generateTestKeyPair();

    Deno.env.set("TAKOS_API_URL", "https://takos.example.test");
    Deno.env.set("JWT_PUBLIC_KEY", publicKey);

    try {
      const configModule = await freshImport<
        typeof import("../../shared/config.ts")
      >(
        "../../shared/config.ts",
      );
      const { createRuntimeServiceApp } = await freshImport<{
        createRuntimeServiceApp:
          typeof import("../../app.ts").createRuntimeServiceApp;
      }>("../../app.ts");
      const app = createRuntimeServiceApp({ isProduction: false });
      const token = signServiceToken({
        issuer: "takos-control",
        subject: "takos-runtime-test",
        audience: "takos-runtime",
        privateKey,
      });
      const headers = {
        Authorization: `Bearer ${token}`,
      };

      const execResponse = await testRequest(app as never, {
        method: "POST",
        path: "/exec",
        headers,
        body: {},
      });
      assertEquals(execResponse.status, 400);
      assertEquals(
        execResponse.headers.get("x-ratelimit-limit"),
        String(configModule.RATE_LIMIT_EXEC_MAX),
      );

      const sessionsResponse = await testRequest(app as never, {
        method: "POST",
        path: "/sessions",
        headers,
        body: {},
      });
      assertEquals(sessionsResponse.status, 400);
      assertEquals(
        sessionsResponse.headers.get("x-ratelimit-limit"),
        String(configModule.RATE_LIMIT_SESSION_MAX),
      );

      const snapshotResponse = await testRequest(app as never, {
        method: "POST",
        path: "/session/snapshot",
        headers,
        body: {},
      });
      assertEquals(snapshotResponse.status, 400);
      assertEquals(
        snapshotResponse.headers.get("x-ratelimit-limit"),
        String(configModule.RATE_LIMIT_SNAPSHOT_MAX),
      );
    } finally {
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

Deno.test({
  name:
    "runtime service /execute-tool returns a 5xx error envelope on tool failure",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const originalTakosApiUrl = Deno.env.get("TAKOS_API_URL");
    Deno.env.set("TAKOS_API_URL", "https://takos.example.test");

    try {
      const toolsRoutes =
        (await freshImport<typeof import("../../routes/runtime/tools.ts")>(
          "../../routes/runtime/tools.ts",
        )).default;
      const app = createTestApp();
      app.route("/", toolsRoutes);

      const response = await testRequest(app, {
        method: "POST",
        path: "/execute-tool",
        body: {
          code: `
          module.exports = {
            boom() {
              throw new Error("boom");
            },
          };
        `,
          toolName: "boom",
          parameters: {},
          secrets: {},
          config: {},
          permissions: {
            allowedDomains: [],
            filePermission: "none",
          },
        },
      });

      assertEquals(response.status, 500);
      assertEquals(response.body, {
        error: {
          code: "INTERNAL_ERROR",
          message: "boom",
        },
      });
    } finally {
      if (originalTakosApiUrl === undefined) {
        Deno.env.delete("TAKOS_API_URL");
      } else {
        Deno.env.set("TAKOS_API_URL", originalTakosApiUrl);
      }
    }
  },
});
