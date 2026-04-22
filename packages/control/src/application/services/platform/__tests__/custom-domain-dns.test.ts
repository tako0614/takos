import { assertEquals } from "jsr:@std/assert";

import {
  customDomainVerificationRecord,
  dnsAnswerMatches,
  normalizeDnsAnswer,
} from "../custom-domains/dns.ts";

Deno.test("custom domain DNS verification uses exact normalized CNAME matches", () => {
  assertEquals(normalizeDnsAnswer("target.example.com."), "target.example.com");
  assertEquals(
    dnsAnswerMatches(
      "token.verify.example.com.",
      "token.verify.example.com",
      "cname",
    ),
    true,
  );
  assertEquals(
    dnsAnswerMatches(
      "evil-token.verify.example.com",
      "token.verify.example.com",
      "cname",
    ),
    false,
  );
});

Deno.test("custom domain DNS verification uses exact normalized TXT matches", () => {
  assertEquals(
    dnsAnswerMatches(
      '"takos-verify=token"',
      "token",
      "txt",
    ),
    true,
  );
  assertEquals(
    dnsAnswerMatches(
      '"takos-verify=token-extra"',
      "token",
      "txt",
    ),
    false,
  );
});

Deno.test("custom domain DNS verification records are scoped to ownership records", () => {
  assertEquals(customDomainVerificationRecord("docs.example.com", "cname"), {
    recordName: "_acme-challenge.docs.example.com",
    dnsType: "CNAME",
  });
  assertEquals(customDomainVerificationRecord("docs.example.com", "txt"), {
    recordName: "_takos-verify.docs.example.com",
    dnsType: "TXT",
  });
});
