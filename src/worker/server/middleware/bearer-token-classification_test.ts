import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import {
  isUnsupportedAppLocalBearerToken,
  isTakosumiAccountsBearerCandidate,
} from "./bearer-token-classification.ts";

test("bearer token classification keeps unsupported app-local prefixes out of Accounts candidates", () => {
  for (const token of ["tak_pat_retired", "tak_oat_header.payload.signature"]) {
    assertEquals(isUnsupportedAppLocalBearerToken(token), true);
    assertEquals(isTakosumiAccountsBearerCandidate(token), false);
  }
});

test("bearer token classification delegates every non-retired opaque token to Accounts", () => {
  for (
    const token of [
      "takpat_current",
      "takat_oauth_access",
      "plain-opaque-token",
      "a.b.c",
    ]
  ) {
    assertEquals(isUnsupportedAppLocalBearerToken(token), false);
    assertEquals(isTakosumiAccountsBearerCandidate(token), true);
  }
});

test("bearer token classification rejects empty tokens", () => {
  assertEquals(isTakosumiAccountsBearerCandidate(""), false);
  assertEquals(isTakosumiAccountsBearerCandidate("   "), false);
});
