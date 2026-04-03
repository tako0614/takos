import { assertEquals } from "jsr:@std/assert";
import { resolveAppUrl } from "../../hooks/app-route-resolution.ts";

Deno.test("resolveAppUrl - keeps internal absolute URLs on same origin", () => {
  assertEquals(
    resolveAppUrl("https://takos.jp/app/demo", "https://takos.jp"),
    {
      kind: "redirect",
      href: "https://takos.jp/app/demo",
    },
  );
});

Deno.test("resolveAppUrl - keeps internal relative URLs as routes", () => {
  assertEquals(resolveAppUrl("/chat/ws-1", "https://takos.jp"), {
    kind: "route",
    path: "/chat/ws-1",
    search: "",
  });
});

Deno.test("resolveAppUrl - preserves query strings for internal relative URLs", () => {
  assertEquals(
    resolveAppUrl("/chat/ws-1/thread-9?message=abc", "https://takos.jp"),
    {
      kind: "route",
      path: "/chat/ws-1/thread-9",
      search: "?message=abc",
    },
  );
});

Deno.test("resolveAppUrl - falls back for cross-origin URLs", () => {
  assertEquals(
    resolveAppUrl("https://evil.example/app/demo", "https://takos.jp"),
    { kind: "fallback" },
  );
});

Deno.test("resolveAppUrl - falls back for invalid absolute URLs", () => {
  assertEquals(resolveAppUrl("https://[invalid", "https://takos.jp"), {
    kind: "fallback",
  });
});
