import { assertEquals } from "jsr:@std/assert";

import { buildStoredEndpointForRuntime } from "../infra.ts";

Deno.test("buildStoredEndpointForRuntime maps backend-neutral worker runtimes to service-ref", () => {
  assertEquals(
    buildStoredEndpointForRuntime({
      endpointName: "web",
      routes: [{ pathPrefix: "/", methods: ["GET"] }],
      targetServiceRef: "web-worker",
      runtime: "runtime-host.worker",
      serviceRef: "web-worker-v2",
      timeoutMs: 5000,
    }),
    {
      name: "web",
      routes: [{ pathPrefix: "/", methods: ["GET"] }],
      target: { kind: "service-ref", ref: "web-worker-v2" },
      timeoutMs: 5000,
    },
  );
});

Deno.test("buildStoredEndpointForRuntime maps URL runtimes to http-url", () => {
  assertEquals(
    buildStoredEndpointForRuntime({
      endpointName: "api",
      routes: [],
      targetServiceRef: "api",
      runtime: "container-service",
      serviceRef: "https://api.internal.example.com",
    }),
    {
      name: "api",
      routes: [],
      target: {
        kind: "http-url",
        baseUrl: "https://api.internal.example.com",
      },
    },
  );
});

Deno.test("buildStoredEndpointForRuntime drops unknown non-url runtime targets", () => {
  assertEquals(
    buildStoredEndpointForRuntime({
      endpointName: "api",
      routes: [],
      targetServiceRef: "api",
      runtime: "container-service",
    }),
    null,
  );
});
