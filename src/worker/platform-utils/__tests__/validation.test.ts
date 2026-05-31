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
