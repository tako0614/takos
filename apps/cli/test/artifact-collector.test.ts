import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertEquals, assertExists } from "jsr:@std/assert";
import {
  type CollectedArtifact,
  collectArtifactsForManifest,
  resolveWorkspaceDir,
} from "../src/lib/artifact-collector.ts";
import type { AppManifest } from "../src/lib/app-manifest.ts";

function makeManifest(
  partial: Partial<AppManifest> & Pick<AppManifest, "compute">,
): AppManifest {
  return {
    name: "demo",
    compute: partial.compute,
    storage: partial.storage ?? {},
    routes: partial.routes ?? [],
    publish: partial.publish ?? [],
    env: partial.env ?? {},
    scopes: partial.scopes ?? [],
  };
}

function setupWorkspace(
  files: Record<string, string>,
): { workspace: string; cleanup: () => void } {
  const workspace = mkdtempSync(join(tmpdir(), "takos-artifact-test-"));
  for (const [relPath, content] of Object.entries(files)) {
    const abs = join(workspace, relPath);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  return {
    workspace,
    cleanup: () => rmSync(workspace, { recursive: true, force: true }),
  };
}

const SAMPLE_WORKFLOW = `name: deploy
on:
  push:
    branches: [main]
jobs:
  bundle:
    runs-on: ubuntu-latest
    steps:
      - run: deno task build
      - uses: actions/upload-artifact@v4
        with:
          name: web
          path: dist/worker
`;

Deno.test("artifact collector - packs files from a worker build directory", () => {
  const { workspace, cleanup } = setupWorkspace({
    ".takos/workflows/deploy.yml": SAMPLE_WORKFLOW,
    "dist/worker/index.js": "export default { fetch() { return new Response('hi'); } }",
    "dist/worker/sub/extra.js": "// extra module",
  });
  try {
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
    });

    const result = collectArtifactsForManifest(manifest, {
      workspaceDir: workspace,
    });

    assertEquals(result.warnings, []);
    assertEquals(result.artifacts.length, 1);
    const artifact = result.artifacts[0] as CollectedArtifact;
    assertEquals(artifact.compute, "web");
    assertEquals(artifact.workflow.job, "bundle");
    assertEquals(artifact.workflow.artifact, "web");
    assertEquals(artifact.workflow.artifactPath, "dist/worker");
    assertEquals(artifact.files.length, 2);
    const paths = artifact.files.map((f) => f.path).sort();
    assertEquals(paths, ["index.js", "sub/extra.js"]);
    for (const file of artifact.files) {
      assertEquals(file.encoding, "base64");
      assertExists(file.content);
      // Round-trip the base64 content to confirm we can decode it.
      const decoded = atob(file.content);
      assertEquals(typeof decoded, "string");
    }
  } finally {
    cleanup();
  }
});

Deno.test("artifact collector - packs a single artifact file", () => {
  const { workspace, cleanup } = setupWorkspace({
    ".takos/workflows/deploy.yml": SAMPLE_WORKFLOW,
    "dist/single.js": "console.log('hi')",
  });
  try {
    const manifest = makeManifest({
      compute: {
        web: {
          kind: "worker",
          build: {
            fromWorkflow: {
              path: ".takos/workflows/deploy.yml",
              job: "bundle",
              artifact: "web",
              artifactPath: "dist/single.js",
            },
          },
        },
      },
    });

    const result = collectArtifactsForManifest(manifest, {
      workspaceDir: workspace,
    });

    assertEquals(result.warnings, []);
    assertEquals(result.artifacts.length, 1);
    assertEquals(result.artifacts[0].files.length, 1);
    assertEquals(result.artifacts[0].files[0].path, "single.js");
  } finally {
    cleanup();
  }
});

Deno.test("artifact collector - warns when build output is missing", () => {
  const { workspace, cleanup } = setupWorkspace({
    ".takos/workflows/deploy.yml": SAMPLE_WORKFLOW,
  });
  try {
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
    });

    const result = collectArtifactsForManifest(manifest, {
      workspaceDir: workspace,
    });

    assertEquals(result.artifacts, []);
    assertEquals(result.warnings.length, 1);
    const message = result.warnings[0];
    if (!message.includes("Build output not found")) {
      throw new Error(`unexpected warning: ${message}`);
    }
  } finally {
    cleanup();
  }
});

Deno.test("artifact collector - warns when workflow file is missing", () => {
  const { workspace, cleanup } = setupWorkspace({
    "dist/worker/index.js": "// noop",
  });
  try {
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
    });

    const result = collectArtifactsForManifest(manifest, {
      workspaceDir: workspace,
    });

    assertEquals(result.artifacts, []);
    assertEquals(result.warnings.length, 1);
    const message = result.warnings[0];
    if (!message.includes("Workflow file not found")) {
      throw new Error(`unexpected warning: ${message}`);
    }
  } finally {
    cleanup();
  }
});

Deno.test("artifact collector - warns when referenced job is missing", () => {
  const workflowYaml = `name: deploy
on:
  push: { branches: [main] }
jobs:
  other:
    runs-on: ubuntu-latest
    steps:
      - run: noop
`;
  const { workspace, cleanup } = setupWorkspace({
    ".takos/workflows/deploy.yml": workflowYaml,
    "dist/worker/index.js": "// noop",
  });
  try {
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
    });

    const result = collectArtifactsForManifest(manifest, {
      workspaceDir: workspace,
    });

    assertEquals(result.artifacts, []);
    assertEquals(result.warnings.length, 1);
    if (!result.warnings[0].includes("Workflow job not found")) {
      throw new Error(`unexpected warning: ${result.warnings[0]}`);
    }
  } finally {
    cleanup();
  }
});

Deno.test("artifact collector - skips compute without build.fromWorkflow", () => {
  const { workspace, cleanup } = setupWorkspace({});
  try {
    const manifest = makeManifest({
      compute: {
        api: {
          kind: "service",
          image: "ghcr.io/example/api@sha256:abcd",
        },
      },
    });
    const result = collectArtifactsForManifest(manifest, {
      workspaceDir: workspace,
    });
    assertEquals(result.artifacts, []);
    assertEquals(result.warnings, []);
  } finally {
    cleanup();
  }
});

Deno.test("artifact collector - failOnMissing throws on missing build output", () => {
  const { workspace, cleanup } = setupWorkspace({
    ".takos/workflows/deploy.yml": SAMPLE_WORKFLOW,
  });
  try {
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
    });

    let threw = false;
    try {
      collectArtifactsForManifest(manifest, {
        workspaceDir: workspace,
        failOnMissing: true,
      });
    } catch (error) {
      threw = true;
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("Build output not found")) {
        throw new Error(`unexpected error message: ${message}`);
      }
    }
    if (!threw) {
      throw new Error("expected collectArtifactsForManifest to throw");
    }
  } finally {
    cleanup();
  }
});

Deno.test("resolveWorkspaceDir - parent of .takos directory", () => {
  const path = "/repo/.takos/app.yml";
  assertEquals(resolveWorkspaceDir(path), "/repo");
});
