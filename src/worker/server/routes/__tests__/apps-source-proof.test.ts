import { test } from "bun:test";
import { assert, assertEquals } from "@takos/test/assert";
import { Hono } from "hono";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitRunner } from "takosumi-contract/reference/runtime-capability";
import { InstallerPipeline } from "../../../../../../takosumi/src/service/domains/installer/mod.ts";
import { isAppError } from "@takos/worker-platform-utils/errors";

import type { AppPublication } from "../../../application/services/source/app-manifest-types.ts";
import { parseOpenTofuAppManifestOutputs } from "../../../application/services/source/opentofu-app-manifest.ts";
import { appsRouteDeps, registerAppApiRoutes } from "../apps.ts";

type PublicationAppRow = {
  id: string;
  name: string;
  groupId: string | null;
  sourceType: string | null;
  publicationType: string | null;
  specJson: string | null;
  resolvedJson: string | null;
  serviceConfig?: string | null;
  serviceHostname: string | null;
  serviceStatus: string | null;
  accountName: string | null;
  accountSlug: string | null;
  accountType: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

test("OpenTofu Git source installs through Takosumi and appears on Takos launcher route", async () => {
  const originalGetDb = appsRouteDeps.getDb;
  const originalRequireSpaceAccess = appsRouteDeps.requireSpaceAccess;
  const workdir = await mkdtemp(join(tmpdir(), "takos-source-launcher-proof-"));
  const sourceUrl = "https://github.com/tako0614/opentofu-only-fixture.git";
  const fixture = await createOpenTofuOnlyGitFixture(workdir);
  let manifestPublication: AppPublication | null = null;
  const pipeline = new InstallerPipeline({
    gitRunner: rewriteGitCloneUrl(sourceUrl, fixture.repo),
    providers: {
      async apply(context) {
        assertEquals(context.source.kind, "git");
        assertEquals(context.source.commit, fixture.commit);
        assertEquals(await pathExists(`${context.sourceDirectory}/outputs.tf`), true);
        assertEquals(await pathExists(`${context.sourceDirectory}/.takosumi`), false);
        assertEquals(
          await pathExists(`${context.sourceDirectory}/.takosumi.yml`),
          false,
        );
        runTofu(["init", "-backend=false", "-input=false"], context.sourceDirectory);
        runTofu(["validate", "-no-color"], context.sourceDirectory);
        runTofu([
          "apply",
          "-auto-approve",
          "-input=false",
          "-refresh=false",
          "-lock=false",
        ], context.sourceDirectory);
        const outputJson = runTofu(["output", "-json"], context.sourceDirectory);
        const manifest = parseOpenTofuAppManifestOutputs(
          outputJson,
          `${sourceUrl}/outputs.tf`,
        );
        assertEquals(manifest.name, "opentofu-only-app");
        manifestPublication = manifest.publish.find((publication) =>
          publication.name === "launcher"
        ) ?? null;
        assert(manifestPublication, "OpenTofu manifest must publish launcher");
        assertEquals(manifestPublication.type, "takos.ui-surface.v1");
        assertEquals(manifestPublication.publisher, "web");
        return {
          outputs: {
            public: {
              launcher: { url: "https://opentofu-only.fixture.test/" },
            },
          },
        };
      },
    },
  });

  try {
    const applied = await pipeline.installationApply({
      spaceId: "space-1",
      source: {
        kind: "git",
        url: sourceUrl,
        ref: "HEAD",
      },
    });
    assert(manifestPublication, "provider apply must capture launcher publication");
    assertEquals(applied.deployment.source.kind, "git");
    assertEquals(applied.deployment.source.url, sourceUrl);
    assertEquals(applied.deployment.source.ref, "HEAD");
    assertEquals(applied.deployment.source.commit, fixture.commit);
    assertEquals(
      applied.deployment.outputs.public?.launcher,
      { url: "https://opentofu-only.fixture.test/" },
    );

    const app = createAppsRouteHarness();
    appsRouteDeps.getDb = (() =>
      createPublicationQueryDb([{
        id: "pub_source_launcher",
        name: manifestPublication.name,
        groupId: applied.installation.id,
        sourceType: "manifest",
        publicationType: manifestPublication.type,
        specJson: JSON.stringify(manifestPublication),
        resolvedJson: JSON.stringify({
          url: applied.deployment.outputs.public?.launcher?.url,
        }),
        serviceConfig: JSON.stringify({ desiredSpec: { icon: "/icon.svg" } }),
        serviceHostname: null,
        serviceStatus: null,
        accountName: "Source Proof Space",
        accountSlug: "source-proof",
        accountType: "workspace",
        createdAt: "2026-06-02T00:00:00.000Z",
        updatedAt: "2026-06-02T00:00:00.000Z",
      }])) as never;
    appsRouteDeps.requireSpaceAccess = async (_c, spaceId, userId) => {
      assertEquals(spaceId, "source-proof");
      assertEquals(userId, "user-1");
      return { space: { id: "space-1" } } as never;
    };

    const response = await app.request("/apps", {
      headers: { "X-Takos-Space-Id": "source-proof" },
    }, { DB: {} });
    assertEquals(response.status, 200);
    const body = await response.json() as { apps: Array<Record<string, unknown>> };
    assertEquals(body.apps.length, 1);
    assertEquals(body.apps[0].id, "pub_source_launcher");
    assertEquals(body.apps[0].name, "OpenTofu Only");
    assertEquals(body.apps[0].url, "https://opentofu-only.fixture.test/");
    assertEquals(body.apps[0].source_type, "manifest");
    assertEquals(body.apps[0].publication_name, "launcher");
    assertEquals(body.apps[0].category, "test");
    assertEquals(body.apps[0].space_id, "source-proof");
    assertEquals(body.apps[0].service_status, "deployed");
    assertEquals(body.apps[0].icon, "https://opentofu-only.fixture.test/icon.svg");
  } finally {
    appsRouteDeps.getDb = originalGetDb;
    appsRouteDeps.requireSpaceAccess = originalRequireSpaceAccess;
    await rm(workdir, { recursive: true, force: true });
  }
});

function createAppsRouteHarness() {
  const app = new Hono<{
    Bindings: { DB: unknown };
    Variables: {
      user: { id: string; principal_id: string };
    };
  }>();

  app.onError((error, c) => {
    if (isAppError(error)) {
      return c.json(
        error.toResponse(),
        error.statusCode as
          | 400
          | 401
          | 403
          | 404
          | 409
          | 410
          | 422
          | 429
          | 500
          | 501
          | 502
          | 503
          | 504,
      );
    }
    throw error;
  });
  app.use("*", async (c, next) => {
    c.set("user", {
      id: "user-1",
      principal_id: "principal-1",
    });
    await next();
  });
  registerAppApiRoutes(app as never);
  return app;
}

function createPublicationQueryDb(rows: PublicationAppRow[]) {
  const query = {
    from: () => query,
    leftJoin: () => query,
    where: () => query,
    orderBy: () => query,
    all: async () => rows,
    get: async () => rows[0] ?? null,
  };
  return {
    select: () => query,
  };
}

async function createOpenTofuOnlyGitFixture(
  root: string,
): Promise<{ repo: string; commit: string }> {
  const repo = join(root, "opentofu-only-origin");
  await mkdir(repo, { recursive: true });
  await writeFile(
    `${repo}/package.json`,
    JSON.stringify(
      {
        name: "@takos-fixtures/opentofu-only-app",
        version: "0.1.0",
        private: true,
        type: "module",
      },
      null,
      2,
    ),
  );
  await writeFile(
    `${repo}/outputs.tf`,
    `output "takos_app_manifest" {
  value = {
    name    = "opentofu-only-app"
    version = "0.1.0"

    compute = {
      web = {
        kind      = "worker"
        readiness = "/healthz"
      }
    }

    routes = [
      {
        id     = "root"
        target = "web"
        path   = "/"
      },
    ]

    publish = [
      {
        name      = "launcher"
        publisher = "web"
        type      = "UiSurface"
        outputs = {
          url = {
            kind     = "url"
            routeRef = "root"
          }
        }
        display = {
          title       = "OpenTofu Only"
          description = "Fixture app declared only through OpenTofu output and package metadata."
          category    = "test"
          icon        = "/icon.svg"
        }
        spec = {
          launcher = true
        }
      },
    ]

    env = {}
  }
}
`,
  );
  assertEquals(await pathExists(`${repo}/.takosumi`), false);
  assertEquals(await pathExists(`${repo}/.takosumi.yml`), false);

  runGit(["init"], repo);
  runGit(["config", "user.email", "fixture@example.test"], repo);
  runGit(["config", "user.name", "Takos Fixture"], repo);
  runGit(["add", "package.json", "outputs.tf"], repo);
  runGit(["commit", "-m", "Add OpenTofu-only app fixture"], repo);

  return { repo, commit: runGit(["rev-parse", "HEAD"], repo).trim() };
}

function rewriteGitCloneUrl(sourceUrl: string, localRepo: string): GitRunner {
  return {
    async run(args, cwd) {
      const rewritten = args.map((arg) => arg === sourceUrl ? localRepo : arg);
      const result = Bun.spawnSync(["git", ...rewritten], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
      return {
        ok: result.exitCode === 0,
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
      };
    },
  };
}

function runGit(args: string[], cwd: string): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(formatCommandError("git", args, cwd, result));
  }
  return result.stdout.toString();
}

function runTofu(args: string[], cwd: string): string {
  const result = Bun.spawnSync(["tofu", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(formatCommandError("tofu", args, cwd, result));
  }
  return result.stdout.toString();
}

function formatCommandError(
  command: string,
  args: string[],
  cwd: string,
  result: { exitCode: number; stdout: Uint8Array; stderr: Uint8Array },
): string {
  return `${command} ${args.join(" ")} failed in ${cwd} with exit ${result.exitCode}\nstdout:\n${
    result.stdout.toString()
  }\nstderr:\n${result.stderr.toString()}`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
