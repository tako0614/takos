import { test } from "bun:test";
import { assertEquals } from "@std/assert";

import { buildStoredEndpointForRuntime } from "../infra.ts";

test("buildStoredEndpointForRuntime maps backend-neutral workload runtimes to service-ref", () => {
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

test("buildStoredEndpointForRuntime maps URL runtimes to http-url", () => {
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

test("buildStoredEndpointForRuntime drops unknown non-url runtime targets", () => {
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
