import { assert, assertEquals } from "jsr:@std/assert";

import type { AppManifest } from "../../source/app-manifest-types.ts";
import {
  type ParsedManifest,
  runDeployValidations,
  validateAttachedNotRouteTarget,
  validateConsumeEnvCollision,
  validateConsumeReferences,
  validatePublicationKnownFields,
  validateRouteUniqueness,
} from "../deploy-validation.ts";

function makeManifest(
  overrides: Partial<AppManifest> = {},
  name = "myapp",
): ParsedManifest {
  return {
    name,
    version: "1.0.0",
    compute: {},
    routes: [],
    publish: [],
    env: {},
    ...overrides,
  };
}

Deno.test("validateAttachedNotRouteTarget fails when a route targets an attached container", () => {
  const manifest = makeManifest({
    compute: {
      web: {
        kind: "worker",
        build: {
          fromWorkflow: {
            path: ".takos/workflows/deploy.yml",
            job: "bundle",
            artifact: "web",
            artifactPath: "dist/worker",
          },
        },
        containers: {
          sandbox: {
            kind: "attached-container",
            image: "ghcr.io/org/sandbox@sha256:def",
            port: 3000,
          },
        },
      },
    },
    routes: [{ target: "sandbox", path: "/sb" }],
  });
  const errors = validateAttachedNotRouteTarget(manifest);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "attached_not_route_target");
});

Deno.test("validateRouteUniqueness fails when two routes share path and overlapping methods", () => {
  const manifest = makeManifest({
    routes: [
      { target: "web", path: "/api", methods: ["GET", "POST"] },
      { target: "web", path: "/api", methods: ["POST"] },
    ],
  });
  const errors = validateRouteUniqueness(manifest);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "route_duplicate");
});

Deno.test("validateConsumeReferences allows known outputs on known publications", () => {
  const manifest = makeManifest({
    publish: [
      { name: "browser", type: "McpServer", path: "/mcp" },
      {
        name: "takos-api",
        provider: "takos",
        kind: "api",
        spec: { scopes: ["files:read"] },
      },
    ],
    compute: {
      web: {
        kind: "worker",
        build: {
          fromWorkflow: {
            path: ".takos/workflows/deploy.yml",
            job: "bundle",
            artifact: "web",
            artifactPath: "dist/worker",
          },
        },
        consume: [
          { publication: "browser" },
          { publication: "takos-api", env: { endpoint: "PRIMARY_API_URL" } },
        ],
      },
    },
  });
  const errors = validateConsumeReferences(manifest);
  assertEquals(errors.length, 0);
});

Deno.test("validateConsumeReferences fails when consume references missing publication", () => {
  const manifest = makeManifest({
    compute: {
      web: {
        kind: "worker",
        build: {
          fromWorkflow: {
            path: ".takos/workflows/deploy.yml",
            job: "bundle",
            artifact: "web",
            artifactPath: "dist/worker",
          },
        },
        consume: [{ publication: "missing" }],
      },
    },
  });
  const errors = validateConsumeReferences(manifest);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "consume_unknown_publication");
});

Deno.test("validateConsumeReferences fails when consume aliases unknown output", () => {
  const manifest = makeManifest({
    publish: [
      { name: "browser", type: "McpServer", path: "/mcp" },
    ],
    compute: {
      web: {
        kind: "worker",
        build: {
          fromWorkflow: {
            path: ".takos/workflows/deploy.yml",
            job: "bundle",
            artifact: "web",
            artifactPath: "dist/worker",
          },
        },
        consume: [{ publication: "browser", env: { nope: "NOPE" } }],
      },
    },
  });
  const errors = validateConsumeReferences(manifest);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "consume_unknown_output");
});

Deno.test("validateConsumeEnvCollision fails when consume aliases collide with local env", () => {
  const manifest = makeManifest({
    publish: [
      { name: "browser", type: "McpServer", path: "/mcp" },
    ],
    compute: {
      web: {
        kind: "worker",
        build: {
          fromWorkflow: {
            path: ".takos/workflows/deploy.yml",
            job: "bundle",
            artifact: "web",
            artifactPath: "dist/worker",
          },
        },
        env: {
          PUBLICATION_BROWSER_URL: "override",
        },
        consume: [{ publication: "browser" }],
      },
    },
  });
  const errors = validateConsumeEnvCollision(manifest);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "consume_env_collision");
});

Deno.test("validatePublicationKnownFields rejects unknown field on provider publication", () => {
  const manifest = makeManifest({
    publish: [
      {
        name: "takos-api",
        provider: "takos",
        kind: "api",
        spec: { scopes: ["files:read"] },
        // deno-lint-ignore no-explicit-any
        extras: "oops" as any,
      } as AppManifest["publish"][number],
    ],
  });
  const errors = validatePublicationKnownFields(manifest);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "publication_unknown_field");
});

Deno.test("runDeployValidations aggregates errors from every validator", () => {
  const manifest = makeManifest({
    publish: [
      { name: "browser", type: "McpServer", path: "/mcp" },
    ],
    compute: {
      api: {
        kind: "service",
        image: "ghcr.io/org/api@sha256:abc123",
        port: 8080,
        env: {
          PUBLICATION_BROWSER_URL: "override",
        },
        consume: [{ publication: "browser" }],
      },
    },
    routes: [
      { target: "api", path: "/" },
      { target: "api", path: "/" },
    ],
  });
  const errors = runDeployValidations(manifest);
  const codes = new Set(errors.map((e) => e.code));
  assert(codes.has("route_duplicate"));
  assert(codes.has("consume_env_collision"));
});
