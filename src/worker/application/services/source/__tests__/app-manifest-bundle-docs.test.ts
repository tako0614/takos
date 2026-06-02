import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";

import type {
  AppManifest,
  AppManifestBuildSource,
} from "../app-manifest-types.ts";
import { buildBundleDocs } from "../app-manifest-bundle-docs.ts";

function emptyBuildSources(): Map<string, AppManifestBuildSource> {
  return new Map();
}

function workerBuildSources(): Map<string, AppManifestBuildSource> {
  return new Map([
    ["web", {
      service_name: "web",
      artifact_path: "dist/worker.js",
    }],
  ]);
}

test("buildBundleDocs emits route publication kinds for bundle manifest", () => {
  const manifest: AppManifest = {
    name: "publication-bundle-app",
    compute: {},
    routes: [],
    publish: [
      {
        name: "search",
        type: "com.example.McpEndpoint",
        publisher: "web",
        outputs: { url: { kind: "url", routeRef: "mcp" } },
        display: { title: "Search MCP" },
        spec: { protocol: "streamable-http" },
      },
      {
        name: "markdown",
        type: "com.example.FileEndpoint",
        publisher: "web",
        outputs: { url: { kind: "url", routeRef: "files" } },
        display: { title: "Markdown" },
        spec: {
          contentTypes: ["text/markdown"],
        },
      },
      {
        name: "docs",
        type: "com.example.Surface",
        publisher: "web",
        outputs: { url: { kind: "url", routeRef: "root" } },
        display: { title: "Docs" },
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
    outputs: { url: { kind: "url", routeRef: "mcp" } },
    display: { title: "Search MCP" },
    protocol: "streamable-http",
  });
  assertEquals(docs[2]?.config, {
    targetRef: "web",
    outputs: { url: { kind: "url", routeRef: "files" } },
    display: { title: "Markdown" },
    contentTypes: ["text/markdown"],
  });
  assertEquals(docs[3]?.config, {
    targetRef: "web",
    outputs: { url: { kind: "url", routeRef: "root" } },
    display: { title: "Docs" },
    placement: "sidebar",
  });
});

test("buildBundleDocs preserves platform service consumes on workloads", () => {
  const manifest: AppManifest = {
    name: "consume-bundle-app",
    compute: {
      web: {
        kind: "worker",
        consume: [{
          publication: "search",
          as: "search-api",
          request: { plan: "read-only" },
        }],
      },
    },
    routes: [],
    publish: [],
    env: {},
  };

  const docs = buildBundleDocs(manifest, workerBuildSources());

  assertEquals(docs.map((doc) => doc.type), ["Package", "Workload"]);
  assertEquals(docs[1]?.name, "web");
  assertEquals(docs[1]?.config?.consume, [{
    publication: "search",
    as: "search-api",
    request: { plan: "read-only" },
  }]);
});

test("buildBundleDocs emits image-backed attached container workloads with dockerfile metadata", () => {
  const manifest: AppManifest = {
    name: "container-bundle-app",
    compute: {
      web: {
        kind: "worker",
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

  const docs = buildBundleDocs(manifest, workerBuildSources());

  assertEquals(docs.map((doc) => doc.type), [
    "Package",
    "Workload",
    "Workload",
    "Binding",
  ]);
  assertEquals(docs[1]?.config?.type, "takos.worker");
  assertEquals(docs[2]?.config, {
    type: "container",
    runtimeConfig: {
      imageRef:
        "ghcr.io/org/sandbox@sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
      dockerfile: "containers/sandbox.Dockerfile",
      port: 3000,
    },
    parentRef: "web",
  });
});
