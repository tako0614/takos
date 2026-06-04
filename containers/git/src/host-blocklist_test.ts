import { test } from "bun:test";
import * as assert from "node:assert/strict";
import { classifyHost, parseIpv6 } from "./host-blocklist.ts";
import { deleteEnv, getEnv, setEnv } from "./runtime.ts";

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) deleteEnv(name);
  else setEnv(name, value);
}

test("classifyHost blocks IPv4 literals in private/metadata ranges", async () => {
  const blocked = [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "0.0.0.0",
    "100.64.0.1",
    "224.0.0.1",
    // Special-use ranges shared from the canonical classifier (previously
    // missed by this copy before the collapse onto ip-classification.ts).
    "192.0.0.1", // IETF protocol assignments
    "192.0.2.5", // TEST-NET-1
    "198.18.0.1", // benchmarking
    "198.51.100.7", // TEST-NET-2
    "203.0.113.9", // TEST-NET-3
    "255.255.255.255", // limited broadcast
  ];
  for (const host of blocked) {
    const result = await classifyHost(host);
    assert.equal(result.ok, false, `${host} should be blocked`);
  }
});

test("classifyHost blocks 6to4 / IPv4-compatible IPv6 wrapping metadata", async () => {
  const blocked = [
    "ff02::1", // multicast
    "2002:a9fe:a9fe::1", // 6to4 wrapping 169.254.169.254
    "::a9fe:a9fe", // deprecated IPv4-compatible 169.254.169.254
    "64:ff9b::169.254.169.254", // NAT64 dotted form
  ];
  for (const host of blocked) {
    const result = await classifyHost(host);
    assert.equal(result.ok, false, `${host} should be blocked`);
  }
});

test("classifyHost canonicalizes IPv6 loopback/link-local forms", async () => {
  // Abbreviated and fully-expanded forms must all classify as loopback.
  const blocked = [
    "::1",
    "0::1",
    "0:0:0:0:0:0:0:1",
    "[::1]",
    "[0::1]",
    "0000:0000:0000:0000:0000:0000:0000:0001",
    "fe80::1", // link-local
    "fc00::1", // unique-local
    "::ffff:169.254.169.254", // IPv4-mapped metadata
    "64:ff9b::169.254.169.254", // NAT64-wrapped metadata
  ];
  for (const host of blocked) {
    const result = await classifyHost(host);
    assert.equal(result.ok, false, `${host} should be blocked`);
  }
});

test("parseIpv6 treats non-IPv6 strings as hostnames (null)", () => {
  assert.equal(parseIpv6("example.com"), null);
  assert.equal(parseIpv6("10.0.0.1"), null);
  // Malformed IPv6 is not a valid literal -> null (caller treats as hostname,
  // which is then DNS-resolved and validated).
  assert.equal(parseIpv6(":::1"), null);
});

test("classifyHost resolves DNS hostnames to a loopback address and blocks", async () => {
  // `localhost` resolves to 127.0.0.1 / ::1 on every platform, so the
  // DNS-resolve-then-validate path must reject it.
  const result = await classifyHost("localhost");
  assert.equal(result.ok, false);
});

test("classifyHost fails closed for a hostname that does not resolve", async () => {
  const result = await classifyHost(
    "this-host-should-not-exist.invalid",
  );
  assert.equal(result.ok, false);
});

test("TAKOS_GIT_SSRF_SKIP_DNS_RESOLUTION opt-out skips DNS but still blocks IP literals", async () => {
  const original = getEnv("TAKOS_GIT_SSRF_SKIP_DNS_RESOLUTION");
  setEnv("TAKOS_GIT_SSRF_SKIP_DNS_RESOLUTION", "true");
  try {
    // Hostname is no longer resolved, so it passes (operator-egress model).
    const hostname = await classifyHost("localhost");
    assert.equal(hostname.ok, true);
    // IP literals are still always range-checked.
    const literal = await classifyHost("169.254.169.254");
    assert.equal(literal.ok, false);
  } finally {
    restoreEnv("TAKOS_GIT_SSRF_SKIP_DNS_RESOLUTION", original);
  }
});
