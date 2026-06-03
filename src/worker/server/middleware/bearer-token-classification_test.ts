import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import {
  isRetiredAppLocalBearerToken,
  isTakosumiAccountsBearerCandidate,
} from "./bearer-token-classification.ts";

test("bearer token classification keeps retired app-local prefixes out of Accounts candidates", () => {
  for (
    const token of [
      "tak_pat_retired",
      "tak_oat_header.payload.signature",
    ]
  ) {
    assertEquals(isRetiredAppLocalBearerToken(token), true);
    assertEquals(isTakosumiAccountsBearerCandidate(token), false);
  }
});

// A real JWT header base64url-decodes to a JSON object declaring `alg`.
const jwtHeader = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const realJwt = `${jwtHeader}.eyJzdWIiOiIxIn0.signature`;

test("bearer token classification accepts current Accounts token shapes", () => {
  for (const token of ["takpat_current", realJwt]) {
    assertEquals(isRetiredAppLocalBearerToken(token), false);
    assertEquals(isTakosumiAccountsBearerCandidate(token), true);
  }
});

test("bearer token classification rejects arbitrary 3-dot junk (not a JWT)", () => {
  for (
    const token of [
      "a.b.c",
      "header.payload.signature", // not base64url-decodable JSON header
      "..",
      "x.y", // only 2 segments
    ]
  ) {
    assertEquals(isTakosumiAccountsBearerCandidate(token), false);
  }
});
