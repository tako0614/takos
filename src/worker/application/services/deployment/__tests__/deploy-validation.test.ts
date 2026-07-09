import { test } from "bun:test";
import { assert, assertEquals } from "@takos/test/assert";

import type { AppManifest } from "../../source/app-manifest-types.ts";
import { applyManifestOverrides } from "../group-state.ts";
import {
  assertDeployValid,
  type ParsedManifest,
  runDeployValidations,
  validateAttachedNotRouteTarget,
  validateConsumeEnvCollision,
  validateConsumeReferences,
  validateLocalEnvNames,
  validateOnlineDeployImageSources,
  validatePublicationKnownFields,
  validatePublicationRouteMatches,
  validatePublicationUniqueness,
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

test("validateAttachedNotRouteTarget fails when a route targets an attached container", () => {
  const manifest = makeManifest({
    compute: {
      web: {
        kind: "worker",
        containers: {
          sandbox: {
            kind: "attached-container",
            image:
              "ghcr.io/org/sandbox@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
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

test("validateAttachedNotRouteTarget fails when a route targets an unknown compute", () => {
  const manifest = makeManifest({
    routes: [{ target: "missing", path: "/missing" }],
  });
  const errors = validateAttachedNotRouteTarget(manifest);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "route_unknown_target");
});

test("validateAttachedNotRouteTarget accepts override routes after compute merge", () => {
  const manifest = makeManifest({
    compute: {
      web: {
        kind: "worker",
      },
    },
    routes: [{ target: "web", path: "/" }],
    overrides: {
      production: {
        compute: {
          api: {
            kind: "service",
            image:
              "ghcr.io/org/api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            port: 8080,
          },
        },
        routes: [{ target: "api", path: "/api" }],
      },
    },
  });

  const resolved = applyManifestOverrides(manifest, "production");
  assertEquals(validateAttachedNotRouteTarget(resolved), []);
});

test("validateAttachedNotRouteTarget fails when a route targets an internal attached workload name", () => {
  const manifest = makeManifest({
    compute: {
      web: {
        kind: "worker",
        containers: {
          sandbox: {
            kind: "attached-container",
            image:
              "ghcr.io/org/sandbox@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            port: 3000,
          },
        },
      },
    },
    routes: [{ target: "web-sandbox", path: "/sb" }],
  });
  const errors = validateAttachedNotRouteTarget(manifest);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "attached_not_route_target");
});

test("validateRouteUniqueness fails when same target/path is repeated", () => {
  const manifest = makeManifest({
    routes: [
      { target: "web", path: "/api", methods: ["GET"] },
      { target: "web", path: "/api", methods: ["POST"] },
    ],
  });
  const errors = validateRouteUniqueness(manifest);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "route_duplicate");
});

test("validateRouteUniqueness allows same path with disjoint methods", () => {
  const manifest = makeManifest({
    routes: [
      { target: "web", path: "/api", methods: ["GET"] },
      { target: "api", path: "/api", methods: ["POST"] },
    ],
  });
  const errors = validateRouteUniqueness(manifest);
  assertEquals(errors.length, 0);
});

test("validateRouteUniqueness fails when same path has overlapping methods", () => {
  const manifest = makeManifest({
    routes: [
      { target: "web", path: "/api", methods: ["GET", "POST"] },
      { target: "api", path: "/api", methods: ["POST"] },
    ],
  });
  const errors = validateRouteUniqueness(manifest);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "route_duplicate");
});

test("validateRouteUniqueness treats omitted methods as all methods", () => {
  const manifest = makeManifest({
    routes: [
      { target: "web", path: "/api" },
      { target: "api", path: "/api", methods: ["DELETE"] },
    ],
  });
  const errors = validateRouteUniqueness(manifest);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "route_duplicate");
});

test("validateOnlineDeployImageSources rejects dockerfile-only attached containers", () => {
  const manifest = makeManifest({
    compute: {
      web: {
        kind: "worker",
        containers: {
          sandbox: {
            kind: "attached-container",
            dockerfile: "containers/sandbox.Dockerfile",
            port: 3000,
          },
        },
      },
    },
  });
  const errors = validateOnlineDeployImageSources(manifest);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "deploy_image_required");
  assertEquals(errors[0].path, "compute.web.containers.sandbox");
});

test("validateOnlineDeployImageSources accepts native Cloudflare Dockerfile containers", () => {
  const manifest = makeManifest({
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
  });
  const errors = validateOnlineDeployImageSources(manifest);
  assertEquals(errors, []);
});

test("validateOnlineDeployImageSources rejects unpinned service images", () => {
  const manifest = makeManifest({
    compute: {
      api: {
        kind: "service",
        image: "ghcr.io/org/api:latest",
        port: 8080,
      },
    },
  });
  const errors = validateOnlineDeployImageSources(manifest);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "deploy_image_invalid");
  assertEquals(errors[0].path, "compute.api.image");
});

test("validateConsumeReferences rejects reserved Takos publication consumes", () => {
  const manifest = makeManifest({
    publish: [
      {
        name: "search",
        type: "com.example.McpEndpoint",
        publisher: "web",
        outputs: { url: { kind: "url", routeRef: "mcp" } },
      },
    ],
    compute: {
      web: {
        kind: "worker",
        consume: [
          { publication: "search" },
          {
            publication: "takos.api-key",
            as: "takos-api",
            request: { scopes: ["files:read"] },
            inject: { env: { endpoint: "PRIMARY_API_URL" } },
          },
        ],
      },
    },
  });
  const errors = validateConsumeReferences(manifest);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "publication_reserved");
  assertEquals(errors[0].path, "compute.web.consume[1]");
});

test("validateConsumeReferences allows built-in Takos runtime projection consumes", () => {
  const manifest = makeManifest({
    compute: {
      web: {
        kind: "worker",
        consume: [
          {
            publication: "storage.filesystem",
            request: { scopes: ["files:read", "files:write"] },
            inject: { env: { url: "TAKOS_STORAGE_API_URL" } },
          },
        ],
      },
    },
  });
  const errors = validateConsumeReferences(manifest);
  assertEquals(errors.length, 0);
  assertDeployValid(manifest);
});

test("validateConsumeReferences allows external catalog publication references", () => {
  const manifest = makeManifest({
    compute: {
      web: {
        kind: "worker",
        consume: [{ publication: "missing" }],
      },
    },
  });
  const errors = validateConsumeReferences(manifest);
  assertEquals(errors.length, 0);
  assertDeployValid(manifest);
});

test("validateConsumeReferences allows attached container external catalog consumes", () => {
  const manifest = makeManifest({
    compute: {
      web: {
        kind: "worker",
        containers: {
          sandbox: {
            kind: "attached-container",
            image:
              "ghcr.io/org/sandbox@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            port: 3000,
            consume: [{ publication: "missing" }],
          },
        },
      },
    },
  });
  const errors = validateConsumeReferences(manifest);
  assertEquals(errors.length, 0);
});

test("validateConsumeReferences fails when consume aliases unknown output", () => {
  const manifest = makeManifest({
    publish: [
      {
        name: "search",
        type: "com.example.McpEndpoint",
        publisher: "web",
        outputs: { url: { kind: "url", routeRef: "mcp" } },
      },
    ],
    compute: {
      web: {
        kind: "worker",
        consume: [{ publication: "search", inject: { env: { nope: "NOPE" } } }],
      },
    },
  });
  const errors = validateConsumeReferences(manifest);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "consume_unknown_output");
});

test("validateConsumeEnvCollision fails when consume aliases collide with local env", () => {
  const manifest = makeManifest({
    publish: [
      {
        name: "search",
        type: "com.example.McpEndpoint",
        publisher: "web",
        outputs: { url: { kind: "url", routeRef: "mcp" } },
      },
    ],
    compute: {
      web: {
        kind: "worker",
        env: {
          PUBLICATION_SEARCH_URL: "override",
        },
        consume: [{ publication: "search", inject: { defaults: true } }],
      },
    },
  });
  const errors = validateConsumeEnvCollision(manifest);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "consume_env_collision");
});

test("validateLocalEnvNames rejects top-level and compute env collisions", () => {
  const manifest = makeManifest({
    env: {
      DATABASE_URL: "sqlite://top",
    },
    compute: {
      web: {
        kind: "worker",
        env: {
          database_url: "sqlite://local",
        },
      },
    },
  });
  const errors = validateLocalEnvNames(manifest);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "env_collision");
});

test("validatePublicationKnownFields rejects unknown publication fields", () => {
  const manifest = makeManifest({
    publish: [
      {
        name: "search",
        publisher: "web",
        type: "protocol.mcp.server",
        outputs: { url: { kind: "url", routeRef: "mcp" } },
        extras: "oops",
      } as AppManifest["publish"][number],
    ],
  });
  const errors = validatePublicationKnownFields(manifest);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "publication_unknown_field");
});

test("validatePublicationKnownFields rejects unknown publication spec fields", () => {
  const manifest = makeManifest({
    publish: [
      {
        name: "takos-api",
        publisher: "takos",
        type: "api-key",
        spec: { scopes: ["files:read"], extra: "oops" },
      },
      {
        name: "markdown",
        publisher: "web",
        type: "interface.file.handler",
        outputs: { url: { kind: "url", routeRef: "files" } },
        spec: { mimeTypes: ["text/markdown"], note: "oops" },
      },
    ],
  });
  const errors = validatePublicationKnownFields(manifest);
  assertEquals(errors.length, 1);
  assertEquals(
    errors.map((error) => error.path).sort(),
    ["publish[1].spec.note"],
  );
  assert(errors.every((error) => error.code === "publication_unknown_field"));
});

test("validatePublicationDefinitions rejects reserved Takos publisher", () => {
  const manifest = makeManifest({
    publish: [
      {
        name: "takos-api",
        publisher: "takos",
        type: "api-key",
        outputs: { url: { kind: "url", routeRef: "mcp" } },
        display: { title: "Takos API" },
        spec: { scopes: ["files:read"] },
      },
    ],
  });
  const errors = runDeployValidations(manifest);
  const definitionError = errors.find((error) =>
    error.code === "publication_invalid_definition"
  );
  assert(definitionError);
  assert(
    definitionError.message.includes(
      "uses reserved publisher 'takos'",
    ),
  );
});

test("validatePublicationUniqueness rejects duplicate publish names", () => {
  const manifest = makeManifest({
    publish: [
      {
        name: "search",
        type: "com.example.McpEndpoint",
        publisher: "web",
        outputs: { url: { kind: "url", routeRef: "mcp" } },
      },
      {
        name: "search",
        type: "com.example.FileEndpoint",
        publisher: "web",
        outputs: { url: { kind: "url", routeRef: "files" } },
      },
    ],
  });
  const errors = validatePublicationUniqueness(manifest);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "publication_duplicate");
});

test("validatePublicationUniqueness rejects duplicate route publisher/route", () => {
  const manifest = makeManifest({
    routes: [{ id: "mcp", target: "web", path: "/mcp" }],
    publish: [
      {
        name: "notes",
        type: "com.example.McpEndpoint",
        publisher: "web",
        outputs: { url: { kind: "url", routeRef: "mcp" } },
      },
      {
        name: "search",
        type: "com.example.SearchEndpoint",
        publisher: "web",
        outputs: { url: { kind: "url", routeRef: "mcp" } },
      },
    ],
  });
  const errors = validatePublicationUniqueness(manifest);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "publication_duplicate");
  assert(
    errors[0].message.includes(
      "route publication target/path 'web /mcp' duplicates publish[0]",
    ),
  );
});

test("validatePublicationRouteMatches checks resolved routes after overrides", () => {
  const manifest = makeManifest({
    compute: {
      web: {
        kind: "worker",
      },
    },
    routes: [{ id: "mcp", target: "web", path: "/mcp" }],
    publish: [
      {
        name: "search",
        type: "com.example.McpEndpoint",
        publisher: "web",
        outputs: { url: { kind: "url", routeRef: "mcp" } },
      },
    ],
    overrides: {
      production: {
        routes: [{ target: "web", path: "/other" }],
      },
    },
  });

  const resolved = applyManifestOverrides(manifest, "production");
  const errors = validatePublicationRouteMatches(resolved);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "publication_route_mismatch");
});

test("validatePublicationRouteMatches allows method-split routes for one publication", () => {
  const manifest = makeManifest({
    routes: [
      { id: "mcp-get", target: "web", path: "/mcp", methods: ["GET"] },
      { id: "mcp-post", target: "web", path: "/mcp", methods: ["POST"] },
    ],
    publish: [
      {
        name: "tools",
        type: "com.example.McpEndpoint",
        publisher: "web",
        outputs: { url: { kind: "url", routeRef: "mcp-get" } },
      },
    ],
  });
  assertEquals(validatePublicationRouteMatches(manifest), []);
});

test("runDeployValidations aggregates publication normalization failures", () => {
  const manifest = makeManifest({
    publish: [
      {
        name: "bad-kind",
        publisher: "takos",
        type: "nope",
        spec: {},
      },
      {
        name: "bad-resource",
        publisher: "takos",
        type: "resource",
        spec: { resource: "notes-db" },
      },
    ],
  });
  const errors = runDeployValidations(manifest);
  const publicationErrors = errors.filter((error) =>
    error.code === "publication_invalid_definition"
  );
  assertEquals(publicationErrors.length, 2);
  assert(
    publicationErrors.some((error) =>
      error.message.includes(
        "publication 'bad-kind' uses reserved publisher 'takos'",
      )
    ),
  );
  assert(
    publicationErrors.some((error) =>
      error.message.includes(
        "publication 'bad-resource' uses reserved publisher 'takos'",
      )
    ),
  );
});

test("runDeployValidations aggregates errors from every validator", () => {
  const manifest = makeManifest({
    publish: [
      {
        name: "search",
        type: "com.example.McpEndpoint",
        publisher: "api",
        outputs: { url: { kind: "url", routeRef: "mcp" } },
      },
    ],
    compute: {
      api: {
        kind: "service",
        image:
          "ghcr.io/org/api@sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
        port: 8080,
        env: {
          PUBLICATION_SEARCH_URL: "override",
        },
        consume: [{ publication: "search", inject: { defaults: true } }],
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
