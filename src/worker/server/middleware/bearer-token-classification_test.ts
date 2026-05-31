import { assertEquals } from "@std/assert";
import {
  isRetiredAppLocalBearerToken,
  isTakosumiAccountsBearerCandidate,
} from "./bearer-token-classification.ts";

Deno.test("bearer token classification keeps retired app-local prefixes out of Accounts candidates", () => {
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

Deno.test("bearer token classification accepts current Accounts token shapes", () => {
  for (
    const token of [
      "takpat_current",
      "header.payload.signature",
    ]
  ) {
    assertEquals(isRetiredAppLocalBearerToken(token), false);
    assertEquals(isTakosumiAccountsBearerCandidate(token), true);
  }
});
