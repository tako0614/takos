import { assertEquals } from "jsr:@std/assert";

import type {
  AppManifest,
  GroupDeploymentSnapshotBuildSource,
} from "../app-manifest-types.ts";
import { buildBundleDocs } from "../app-manifest-bundle-docs.ts";

function emptyBuildSources(): Map<string, GroupDeploymentSnapshotBuildSource> {
  return new Map();
}

Deno.test("buildBundleDocs emits route publication kinds for bundle manifest", () => {
  const manifest: AppManifest = {
    name: "publication-bundle-app",
    compute: {},
    routes: [],
    publish: [
      {
        name: "search",
        type: "com.example.McpEndpoint",
        publisher: "web",
        outputs: { url: { route: "/mcp" } },
        title: "Search MCP",
        spec: { protocol: "streamable-http" },
      },
      {
        name: "markdown",
        type: "com.example.FileEndpoint",
        publisher: "web",
        outputs: { url: { route: "/files/:id" } },
        title: "Markdown",
        spec: {
          contentTypes: ["text/markdown"],
        },
      },
      {
        name: "docs",
        type: "com.example.Surface",
        publisher: "web",
        outputs: { url: { route: "/" } },
        title: "Docs",
        spec: { placement: "sidebar" },
      },
    ],
    env: {},
  };

  const docs = buildBundleDocs(manifest, emptyBuildSources());

  assertEquals(docs.map((doc) => doc.type), [
    "Package",
    "com.example.McpEndpoint",
    "com.example.FileEndpoint",
    "com.example.Surface",
  ]);
  assertEquals(docs[1]?.config, {
    targetRef: "web",
    outputs: { url: { route: "/mcp" } },
    title: "Search MCP",
    protocol: "streamable-http",
  });
  assertEquals(docs[2]?.config, {
    targetRef: "web",
    outputs: { url: { route: "/files/:id" } },
    title: "Markdown",
    contentTypes: ["text/markdown"],
  });
  assertEquals(docs[3]?.config, {
    targetRef: "web",
    outputs: { url: { route: "/" } },
    title: "Docs",
    placement: "sidebar",
  });
});

Deno.test("buildBundleDocs preserves Takos built-in provider publication consumes on workloads", () => {
  const manifest: AppManifest = {
    name: "grant-bundle-app",
    compute: {
      web: {
        kind: "worker",
        build: {
          fromWorkflow: {
            path: ".takos/workflows/deploy.yml",
            job: "bundle",
            artifact: "web",
          },
        },
        consume: [{
          publication: "takos.api-key",
          as: "takos-api",
          request: { scopes: ["files:read", "files:write"] },
        }],
      },
    },
    routes: [],
    publish: [],
    env: {},
  };

  const docs = buildBundleDocs(manifest, emptyBuildSources());

  assertEquals(docs.map((doc) => doc.type), ["Package", "Workload"]);
  assertEquals(docs[1]?.name, "web");
  assertEquals(docs[1]?.config?.consume, [{
    publication: "takos.api-key",
    as: "takos-api",
    request: { scopes: ["files:read", "files:write"] },
  }]);
});

Deno.test("buildBundleDocs emits image-backed attached container workloads with dockerfile metadata", () => {
  const manifest: AppManifest = {
    name: "container-bundle-app",
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
            image:
              "ghcr.io/org/sandbox@sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
            dockerfile: "containers/sandbox.Dockerfile",
            port: 3000,
          },
        },
      },
    },
    routes: [],
    publish: [],
    env: {},
  };

  const docs = buildBundleDocs(manifest, emptyBuildSources());

  assertEquals(docs.map((doc) => doc.type), [
    "Package",
    "Workload",
    "Workload",
    "Binding",
  ]);
  assertEquals(docs[1]?.config?.type, "takos.worker");
  assertEquals(docs[2]?.config, {
    type: "container",
    pluginConfig: {
      imageRef:
        "ghcr.io/org/sandbox@sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
      dockerfile: "containers/sandbox.Dockerfile",
      port: 3000,
    },
    parentRef: "web",
  });
});
