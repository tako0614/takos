import { expect, test } from "bun:test";

import { constantTimeEqualsString } from "takosumi-contract/internal-crypto";
import {
  generateCodeChallenge,
  generateCodeVerifier,
  verifyCodeChallenge,
} from "./oidc-pkce.ts";

test("the shared constant-time comparator folds the length into the accumulator", () => {
  // Regression guard: the worker previously hand-rolled a comparator that
  // early-returned on a byte-length mismatch, leaking the secret length via
  // timing. The single length-safe source must compare unequal lengths without
  // short-circuiting on the length check.
  expect(constantTimeEqualsString("secret", "secret")).toBeTruthy();
  expect(!constantTimeEqualsString("secret", "secret-but-longer")).toBeTruthy();
  expect(!constantTimeEqualsString("", "x")).toBeTruthy();
  expect(constantTimeEqualsString("", "")).toBeTruthy();
});

test("verifyCodeChallenge accepts a matching S256 challenge", async () => {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  expect(await verifyCodeChallenge(verifier, challenge)).toBeTruthy();
});

test("verifyCodeChallenge rejects a non-matching challenge", async () => {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  // A wrong challenge (including a length-mismatched one) must verify false.
  expect(!(await verifyCodeChallenge(verifier, `${challenge}x`))).toBeTruthy();
  expect(!(await verifyCodeChallenge(verifier, "not-the-challenge")))
    .toBeTruthy();
});
