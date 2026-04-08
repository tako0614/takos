import { assert, assertEquals } from "jsr:@std/assert";

import type { AppManifest } from "../../source/app-manifest-types.ts";
import {
  type ParsedManifest,
  runDeployValidations,
  validateAppTokenImmutable,
  validateAttachedNotRouteTarget,
  validateBindingsWorkerOnly,
  validatePublicationEnvCollision,
  validatePublicationKnownFields,
  validateRouteUniqueness,
} from "../deploy-validation.ts";

/**
 * Build a minimal valid flat-schema manifest. Each test extends this and
 * overrides only the fields it cares about so the assertions stay focused
 * on the validator under test.
 */
function makeManifest(
  overrides: Partial<AppManifest> = {},
  name = "myapp",
): ParsedManifest {
  return {
    name,
    version: "1.0.0",
    compute: {},
    storage: {},
    routes: [],
    publish: [],
    env: {},
    scopes: [],
    ...overrides,
  };
}

// ── 1. Storage bind worker-only ─────────────────────────────────────────────

Deno.test("validateBindingsWorkerOnly fails when a Service references an object-typed storage bind via env", () => {
  const manifest = makeManifest({
    storage: {
      maindb: { type: "sql", bind: "DB" },
    },
    compute: {
      api: {
        kind: "service",
        image: "ghcr.io/org/api@sha256:abc123",
        port: 8080,
        env: { DB: "ref" },
      },
    },
  });
  const errors = validateBindingsWorkerOnly(manifest);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "binding_worker_only");
  assert(errors[0].path.includes("storage.maindb"));
});

Deno.test("validateBindingsWorkerOnly allows secret bindings on a Service", () => {
  const manifest = makeManifest({
    storage: {
      apikey: { type: "secret", bind: "API_KEY" },
    },
    compute: {
      api: {
        kind: "service",
        image: "ghcr.io/org/api@sha256:abc123",
        port: 8080,
        env: { API_KEY: "ref" },
      },
    },
  });
  const errors = validateBindingsWorkerOnly(manifest);
  assertEquals(errors.length, 0);
});

// ── 2. Attached container as route target ───────────────────────────────────

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

Deno.test("validateAttachedNotRouteTarget allows worker as route target", () => {
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
      },
    },
    routes: [{ target: "web", path: "/" }],
  });
  const errors = validateAttachedNotRouteTarget(manifest);
  assertEquals(errors.length, 0);
});

// ── 3. Same path + method route uniqueness ──────────────────────────────────

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

Deno.test("validateRouteUniqueness allows fully disjoint methods at same path", () => {
  const manifest = makeManifest({
    routes: [
      { target: "web", path: "/api", methods: ["GET"] },
      { target: "web", path: "/api", methods: ["POST"] },
    ],
  });
  const errors = validateRouteUniqueness(manifest);
  assertEquals(errors.length, 0);
});

Deno.test("validateRouteUniqueness fails when two routes share path with no methods specified", () => {
  // No methods specified == all methods, so two such routes always overlap.
  const manifest = makeManifest({
    routes: [
      { target: "web", path: "/" },
      { target: "api", path: "/" },
    ],
  });
  const errors = validateRouteUniqueness(manifest);
  assertEquals(errors.length, 1);
});

// ── 4. Publication env collision ────────────────────────────────────────────

Deno.test("validatePublicationEnvCollision allows distinct McpServer publications", () => {
  const manifest = makeManifest({
    publish: [
      { type: "McpServer", name: "browser", path: "/mcp" },
      { type: "McpServer", name: "sandbox", path: "/sandbox/mcp" },
    ],
  });
  const errors = validatePublicationEnvCollision(manifest);
  assertEquals(errors.length, 0);
});

Deno.test("validatePublicationEnvCollision fails when two McpServer publications share the same name", () => {
  const manifest = makeManifest({
    publish: [
      { type: "McpServer", name: "shared", path: "/mcp" },
      { type: "McpServer", name: "shared", path: "/mcp2" },
    ],
  });
  const errors = validatePublicationEnvCollision(manifest);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "publication_env_collision");
});

// ── 5. Publication unknown field ────────────────────────────────────────────

Deno.test("validatePublicationKnownFields rejects unknown field on McpServer", () => {
  const manifest = makeManifest({
    publish: [
      // `extras` is not in the known McpServer schema.
      // deno-lint-ignore no-explicit-any
      { type: "McpServer", name: "browser", path: "/mcp", extras: "oops" } as any,
    ],
  });
  const errors = validatePublicationKnownFields(manifest);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "publication_unknown_field");
  assert(errors[0].path.endsWith(".extras"));
});

Deno.test("validatePublicationKnownFields allows known McpServer fields", () => {
  const manifest = makeManifest({
    publish: [
      {
        type: "McpServer",
        name: "browser",
        path: "/mcp",
        transport: "streamable-http",
        authSecretRef: "API_KEY",
      },
    ],
  });
  const errors = validatePublicationKnownFields(manifest);
  assertEquals(errors.length, 0);
});

// ── 6. App token immutable ──────────────────────────────────────────────────

Deno.test("validateAppTokenImmutable rejects TAKOS_APP_TOKEN in top-level env", () => {
  const manifest = makeManifest({
    env: { TAKOS_APP_TOKEN: "leak" },
  });
  const errors = validateAppTokenImmutable(manifest);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "app_token_immutable");
});

Deno.test("validateAppTokenImmutable rejects TAKOS_APP_TOKEN in compute env", () => {
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
        env: { TAKOS_APP_TOKEN: "leak" },
      },
    },
  });
  const errors = validateAppTokenImmutable(manifest);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "app_token_immutable");
});

// ── Aggregate ───────────────────────────────────────────────────────────────

Deno.test("runDeployValidations aggregates errors from every validator", () => {
  const manifest = makeManifest({
    storage: {
      maindb: { type: "sql", bind: "DB" },
    },
    compute: {
      api: {
        kind: "service",
        image: "ghcr.io/org/api@sha256:abc123",
        port: 8080,
        env: { DB: "ref" },
      },
    },
    env: { TAKOS_APP_TOKEN: "leak" },
    routes: [
      { target: "api", path: "/" },
      { target: "api", path: "/" },
    ],
  });
  const errors = runDeployValidations(manifest);
  const codes = new Set(errors.map((e) => e.code));
  assert(codes.has("binding_worker_only"));
  assert(codes.has("route_duplicate"));
  assert(codes.has("app_token_immutable"));
});
