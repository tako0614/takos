import { test } from "bun:test";
import { assert, assertEquals } from "@takos/test/assert";
import { Hono } from "hono";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isAppError } from "@takos/worker-platform-utils/errors";

import { appsRouteDeps, registerAppApiRoutes } from "../apps/index.ts";

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

// Source-to-launcher proof (Takos boundary): a manifest-free OpenTofu Capsule
// retrieved from a Git source applies through OpenTofu, exposes a
// `service_exports` output, and the runtime projection surfaces as a
// launcher app on the Takos `/apps` route. The Takosumi-side install bookkeeping
// (plan/apply Runs, StateVersion, and Output from the same module) is proven
// separately by `takosumi run opentofu:deployment-output-proof`; this proof owns
// the Takos consumption boundary and does not reach into Takosumi internals.
test("OpenTofu Git source installs through Takosumi and appears on Takos launcher route", async () => {
  const originalGetDb = appsRouteDeps.getDb;
  const originalRequireSpaceAccess = appsRouteDeps.requireSpaceAccess;
  const workdir = await mkdtemp(join(tmpdir(), "takos-source-launcher-proof-"));
  const sourceUrl = "https://github.com/tako0614/opentofu-only-fixture.git";
  // The deployed launcher URL that the Takosumi Output projection binds
  // to the manifest's `launcher` publication (routeRef "root" -> route path "/").
  const launcherUrl = "https://opentofu-only.fixture.test/";
  const fixture = await createOpenTofuOnlyGitFixture(workdir);

  try {
    // Retrieve the Takosumi-specific-file-free Capsule from its Git source.
    const checkout = join(workdir, "checkout");
    runGit(["clone", "--quiet", fixture.repo, checkout], workdir);
    assertEquals(
      runGit(["rev-parse", "HEAD"], checkout).trim(),
      fixture.commit,
    );
    assertEquals(await pathExists(`${checkout}/outputs.tf`), true);
    assertEquals(await pathExists(`${checkout}/.takosumi`), false);
    assertEquals(await pathExists(`${checkout}/.takosumi.yml`), false);

    // Apply with OpenTofu and read the well-known runtime projection output.
    runTofu(["init", "-backend=false", "-input=false"], checkout);
    runTofu(["validate", "-no-color"], checkout);
    runTofu(
      [
        "apply",
        "-auto-approve",
        "-input=false",
        "-refresh=false",
        "-lock=false",
      ],
      checkout,
    );
    const serviceExports = parseOpenTofuServiceExportsOutput(
      runTofu(["output", "-json"], checkout),
      `${sourceUrl}/outputs.tf`,
    );
    const launcherExport =
      serviceExports.find((serviceExport) =>
        serviceExport.capabilities.includes("interface.ui.surface"),
      ) ?? null;
    assert(launcherExport, "OpenTofu service_exports must publish launcher");
    assertEquals(launcherExport.name, "launcher");

    const app = createAppsRouteHarness();
    appsRouteDeps.getDb = (() =>
      createPublicationQueryDb([
        {
          id: "pub_source_launcher",
          name: launcherExport.name,
          groupId: "inst_source_launcher",
          sourceType: "service_graph",
          publicationType: "interface.ui.surface",
          specJson: JSON.stringify({
            name: launcherExport.name,
            type: "interface.ui.surface",
            display: launcherExport.metadata,
            spec: { launcher: true },
          }),
          resolvedJson: JSON.stringify({ url: launcherUrl }),
          serviceConfig: JSON.stringify({ desiredSpec: { icon: "/icon.svg" } }),
          serviceHostname: null,
          serviceStatus: null,
          accountName: "Source Proof Space",
          accountSlug: "source-proof",
          accountType: "workspace",
          createdAt: "2026-06-02T00:00:00.000Z",
          updatedAt: "2026-06-02T00:00:00.000Z",
        },
      ])) as never;
    appsRouteDeps.requireSpaceAccess = async (_c, spaceId, userId) => {
      assertEquals(spaceId, "source-proof");
      assertEquals(userId, "user-1");
      return { space: { id: "space-1" } } as never;
    };

    const response = await app.request(
      "/apps",
      {
        headers: { "X-Takos-Space-Id": "source-proof" },
      },
      { DB: {} },
    );
    assertEquals(response.status, 200);
    const body = (await response.json()) as {
      apps: Array<Record<string, unknown>>;
    };
    assertEquals(body.apps.length, 1);
    assertEquals(body.apps[0].id, "pub_source_launcher");
    assertEquals(body.apps[0].name, "OpenTofu Only");
    assertEquals(body.apps[0].url, launcherUrl);
    assertEquals(body.apps[0].source_type, "service_graph");
    assertEquals(body.apps[0].publication_name, "launcher");
    assertEquals(body.apps[0].category, "test");
    assertEquals(body.apps[0].space_id, "source-proof");
    assertEquals(body.apps[0].service_status, "deployed");
    assertEquals(
      body.apps[0].icon,
      "https://opentofu-only.fixture.test/icon.svg",
    );
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
    `output "service_exports" {
  value = [
    {
      name         = "launcher"
      capabilities = ["interface.ui.surface"]
      endpoints = [
        {
          name     = "default"
          protocol = "https"
          url      = "https://opentofu-only.fixture.test/"
        }
      ]
      metadata = {
        title       = "OpenTofu Only"
        description = "Fixture app declared only through OpenTofu service_exports and package metadata."
        category    = "test"
        icon        = "/icon.svg"
      }
      visibility = "space"
    },
  ]
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

type ServiceExportOutput = {
  name: string;
  capabilities: string[];
  metadata?: Record<string, unknown>;
};

function parseOpenTofuServiceExportsOutput(
  raw: string,
  source: string,
): ServiceExportOutput[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${source} must be an OpenTofu output object`);
  }
  const output = (parsed as Record<string, unknown>).service_exports;
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    throw new Error(`${source} must include service_exports output`);
  }
  if ((output as { sensitive?: unknown }).sensitive === true) {
    throw new Error(`${source}.service_exports must not be sensitive`);
  }
  const value = (output as { value?: unknown }).value;
  if (!Array.isArray(value)) {
    throw new Error(`${source}.service_exports.value must be an array`);
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${source}.service_exports[${index}] must be an object`);
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.name !== "string" || record.name.length === 0) {
      throw new Error(`${source}.service_exports[${index}].name is required`);
    }
    if (
      !Array.isArray(record.capabilities) ||
      !record.capabilities.every((item) => typeof item === "string")
    ) {
      throw new Error(
        `${source}.service_exports[${index}].capabilities must be string[]`,
      );
    }
    const metadata =
      record.metadata &&
      typeof record.metadata === "object" &&
      !Array.isArray(record.metadata)
        ? (record.metadata as Record<string, unknown>)
        : undefined;
    return {
      name: record.name,
      capabilities: record.capabilities,
      ...(metadata ? { metadata } : {}),
    };
  });
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
  return `${command} ${args.join(" ")} failed in ${cwd} with exit ${result.exitCode}\nstdout:\n${result.stdout.toString()}\nstderr:\n${result.stderr.toString()}`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
