import { assertEquals } from "@std/assert";
import { shouldUseLocalHostContainerRuntime } from "@/runtime/container-hosts/container-runtime.ts";

Deno.test("shouldUseLocalHostContainerRuntime - uses local runtime under Deno tests", () => {
  assertEquals(
    shouldUseLocalHostContainerRuntime(
      { Deno: {} } as typeof globalThis & { Deno: unknown },
      { versions: { node: "20.0.0" } },
    ),
    true,
  );
});

Deno.test("shouldUseLocalHostContainerRuntime - uses local runtime under plain Node", () => {
  assertEquals(
    shouldUseLocalHostContainerRuntime(
      {} as typeof globalThis,
      { versions: { node: "20.0.0" } },
    ),
    true,
  );
});

Deno.test("shouldUseLocalHostContainerRuntime - loads Cloudflare Container in Workers nodejs_compat", () => {
  assertEquals(
    shouldUseLocalHostContainerRuntime(
      { WebSocketPair: function WebSocketPair() {} } as typeof globalThis & {
        WebSocketPair: unknown;
      },
      { versions: { node: "20.0.0" } },
    ),
    false,
  );
});

Deno.test("shouldUseLocalHostContainerRuntime - loads Cloudflare Container in Workers without Node compat", () => {
  assertEquals(
    shouldUseLocalHostContainerRuntime(
      { WebSocketPair: function WebSocketPair() {} } as typeof globalThis & {
        WebSocketPair: unknown;
      },
      undefined,
    ),
    false,
  );
});
