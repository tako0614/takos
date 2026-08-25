import { test } from "bun:test";

import { assertEquals } from "@takos/test/assert";

import { exchangeAuthorizationCode } from "../oidc-token-exchange.ts";

test("OIDC token exchange omits a secret for public clients and sends one for confidential clients", async () => {
  const requests: URLSearchParams[] = [];
  const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new URLSearchParams(String(init?.body ?? "")));
    return Response.json({ id_token: "id-token" });
  };

  await exchangeAuthorizationCode({
    tokenEndpoint: "https://accounts.example.test/oauth/token",
    code: "public-code",
    clientId: "public-client",
    redirectUri: "https://takos.example.test/auth/oidc/callback",
    codeVerifier: "public-verifier",
    fetchImpl,
  });
  await exchangeAuthorizationCode({
    tokenEndpoint: "https://accounts.example.test/oauth/token",
    code: "confidential-code",
    clientId: "confidential-client",
    clientSecret: "confidential-secret",
    redirectUri: "https://takos.example.test/auth/oidc/callback",
    codeVerifier: "confidential-verifier",
    fetchImpl,
  });

  assertEquals(requests[0]?.get("client_id"), "public-client");
  assertEquals(requests[0]?.get("client_secret"), null);
  assertEquals(requests[1]?.get("client_id"), "confidential-client");
  assertEquals(requests[1]?.get("client_secret"), "confidential-secret");
});
