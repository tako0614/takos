import { isLocalhost, isPrivateIP } from "../validation.ts";

import { assertEquals } from "jsr:@std/assert";

Deno.test("isLocalhost - returns true for localhost", () => {
  assertEquals(isLocalhost("localhost"), true);
});
Deno.test("isLocalhost - returns true for 127.0.0.1", () => {
  assertEquals(isLocalhost("127.0.0.1"), true);
});
Deno.test("isLocalhost - returns true for ::1", () => {
  assertEquals(isLocalhost("::1"), true);
});
Deno.test("isLocalhost - returns true for .localhost suffix", () => {
  assertEquals(isLocalhost("app.localhost"), true);
});
Deno.test("isLocalhost - returns false for public hostnames", () => {
  assertEquals(isLocalhost("example.com"), false);
});

Deno.test("isPrivateIP - returns true for 10.x.x.x", () => {
  assertEquals(isPrivateIP("10.0.0.1"), true);
});
Deno.test("isPrivateIP - returns true for 192.168.x.x", () => {
  assertEquals(isPrivateIP("192.168.1.1"), true);
});
Deno.test("isPrivateIP - returns true for 172.16-31.x.x", () => {
  assertEquals(isPrivateIP("172.16.0.1"), true);
});
Deno.test("isPrivateIP - returns false for public IPs", () => {
  assertEquals(isPrivateIP("8.8.8.8"), false);
});
