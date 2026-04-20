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
        path: "/mcp",
        title: "Search MCP",
        spec: { protocol: "streamable-http" },
      },
      {
        name: "markdown",
        type: "com.example.FileEndpoint",
        publisher: "web",
        path: "/files/:id",
        title: "Markdown",
        spec: {
          contentTypes: ["text/markdown"],
        },
      },
      {
        name: "docs",
        type: "com.example.Surface",
        publisher: "web",
        path: "/",
        title: "Docs",
        spec: { placement: "sidebar" },
      },
    ],
    env: {},
  };

  const docs = buildBundleDocs(manifest, emptyBuildSources());

  assertEquals(docs.map((doc) => doc.kind), [
    "Package",
    "com.example.McpEndpoint",
    "com.example.FileEndpoint",
    "com.example.Surface",
  ]);
  assertEquals(docs[1]?.spec, {
    targetRef: "web",
    path: "/mcp",
    title: "Search MCP",
    protocol: "streamable-http",
  });
  assertEquals(docs[2]?.spec, {
    targetRef: "web",
    path: "/files/:id",
    title: "Markdown",
    contentTypes: ["text/markdown"],
  });
  assertEquals(docs[3]?.spec, {
    targetRef: "web",
    path: "/",
    title: "Docs",
    placement: "sidebar",
  });
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

  assertEquals(docs.map((doc) => doc.kind), [
    "Package",
    "Workload",
    "Workload",
    "Binding",
  ]);
  assertEquals(docs[2]?.spec, {
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
