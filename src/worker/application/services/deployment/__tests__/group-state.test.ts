import { test } from "bun:test";
import { assertEquals, assertNotEquals } from "@takos/test/assert";

import { compileGroupDesiredState } from "../group-state.ts";

test("compileGroupDesiredState fingerprints root manifest env changes", () => {
  const base = compileGroupDesiredState({
    name: "demo",
    compute: {
      web: {
        kind: "worker",
      },
    },
    routes: [],
    publish: [],
    env: {
      FOO: "one",
    },
  });

  const changed = compileGroupDesiredState({
    name: "demo",
    compute: {
      web: {
        kind: "worker",
      },
    },
    routes: [],
    publish: [],
    env: {
      FOO: "two",
    },
  });

  assertNotEquals(
    base.workloads.web.specFingerprint,
    changed.workloads.web.specFingerprint,
  );
});

test("compileGroupDesiredState keeps native Cloudflare containers inside parent worker", () => {
  const desired = compileGroupDesiredState({
    name: "computer",
    compute: {
      web: {
        kind: "worker",
        containers: {
          sandbox: {
            kind: "attached-container",
            image: "apps/sandbox/Dockerfile",
            port: 8080,
            cloudflare: {
              container: {
                binding: "SANDBOX_CONTAINER",
                className: "SandboxSessionContainer",
              },
            },
          },
        },
      },
    },
    routes: [{ target: "web", path: "/" }],
    publish: [],
    env: {},
  });

  assertEquals(Object.keys(desired.workloads).sort(), ["web"]);
  assertEquals(
    desired.workloads.web.spec.containers?.sandbox.cloudflare?.container
      ?.className,
    "SandboxSessionContainer",
  );
});
