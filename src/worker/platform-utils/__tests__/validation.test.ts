import { expect, test } from "bun:test";
import { isLocalhost, isPrivateIP } from "../validation.ts";

test("isLocalhost - returns true for localhost", () => {
  expect(isLocalhost("localhost")).toEqual(true);
});
test("isLocalhost - returns true for 127.0.0.1", () => {
  expect(isLocalhost("127.0.0.1")).toEqual(true);
});
test("isLocalhost - returns true for ::1", () => {
  expect(isLocalhost("::1")).toEqual(true);
});
test("isLocalhost - returns true for .localhost suffix", () => {
  expect(isLocalhost("app.localhost")).toEqual(true);
});
test("isLocalhost - returns false for public hostnames", () => {
  expect(isLocalhost("example.com")).toEqual(false);
});

test("isPrivateIP - returns true for 10.x.x.x", () => {
  expect(isPrivateIP("10.0.0.1")).toEqual(true);
});
test("isPrivateIP - returns true for 192.168.x.x", () => {
  expect(isPrivateIP("192.168.1.1")).toEqual(true);
});
test("isPrivateIP - returns true for 172.16-31.x.x", () => {
  expect(isPrivateIP("172.16.0.1")).toEqual(true);
});
test("isPrivateIP - returns false for public IPs", () => {
  expect(isPrivateIP("8.8.8.8")).toEqual(false);
});

// The classifier is now the union of the previously-drifted in-repo copies
// (worker validation.ts + git host-blocklist.ts). These cases were missed by
// at least one copy before the collapse; lock in the stronger classification.
test("isPrivateIP - blocks special-use IPv4 ranges", () => {
  for (
    const ip of [
      "169.254.169.254", // link-local cloud metadata
      "100.64.0.1", // carrier-grade NAT
      "192.0.0.1", // IETF protocol assignments
      "192.0.2.5", // TEST-NET-1
      "198.18.0.1", // benchmarking
      "198.51.100.7", // TEST-NET-2
      "203.0.113.9", // TEST-NET-3
      "224.0.0.1", // multicast
      "255.255.255.255", // limited broadcast
    ]
  ) {
    expect(isPrivateIP(ip)).toEqual(true);
  }
});

test("isPrivateIP - canonicalizes equivalent IPv6 loopback forms", () => {
  for (
    const ip of [
      "::1",
      "0:0:0:0:0:0:0:1",
      "0000:0000:0000:0000:0000:0000:0000:0001",
      "[::1]",
    ]
  ) {
    expect(isPrivateIP(ip)).toEqual(true);
  }
});

test("isPrivateIP - blocks IPv6 multicast / unique-local / link-local", () => {
  for (const ip of ["ff02::1", "fc00::1", "fd00::1", "fe80::1", "::"]) {
    expect(isPrivateIP(ip)).toEqual(true);
  }
});

test("isPrivateIP - blocks IPv4-embedding IPv6 forms wrapping metadata", () => {
  for (
    const ip of [
      "::ffff:169.254.169.254", // IPv4-mapped
      "::ffff:c0a8:0101", // IPv4-mapped (hex) 192.168.1.1
      "64:ff9b::169.254.169.254", // NAT64 (dotted)
      "64:ff9b::a9fe:a9fe", // NAT64 (hex)
      "2002:a9fe:a9fe::1", // 6to4 wrapping 169.254.169.254
      "::a9fe:a9fe", // deprecated IPv4-compatible
    ]
  ) {
    expect(isPrivateIP(ip)).toEqual(true);
  }
});

test("isPrivateIP - does not over-block public IPv6", () => {
  for (const ip of ["2001:4860:4860::8888", "::1234:5678"]) {
    expect(isPrivateIP(ip)).toEqual(false);
  }
});
