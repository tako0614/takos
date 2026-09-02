import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  discoverBuildOutput,
  immutableDeploymentUrl,
  mutatesTarget,
  parseStaticSiteArgs,
  runStaticSiteRecorded,
  scanPublishedBytes,
  STATIC_SITE_USAGE,
  TAKOS_DOCS_DEFINITION,
  TAKOS_DOCS_SURFACE,
  TAKOS_SITE_DEFINITION,
  TAKOS_SITE_SURFACE,
  type CommandRequest,
  type CommandResult,
  type StaticSiteDefinition,
  type SurfaceRuntime,
} from "./static-site-deploy.ts";

const repositoryRoot = resolve(import.meta.dir, "..");
const HEAD = "a".repeat(40);
const OTHER = "b".repeat(40);
const DEPLOYMENT = "11111111-2222-3333-4444-555555555555";
const PREVIOUS_URL = `https://${"c".repeat(8)}.takos-landing.pages.dev`;
const NEW_URL = `https://${"d".repeat(8)}.takos-landing.pages.dev`;
const DOCS_URL = `https://${"e".repeat(8)}.takos-docs.pages.dev`;

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/** The bytes a fixture build produces, keyed by path inside the output dir. */
function siteFiles(marker = "landing"): Record<string, string> {
  return {
    "index.html": `<!doctype html><html lang="ja">${marker}</html>\n`,
    "en/index.html": `<!doctype html><html lang="en">${marker}</html>\n`,
    "assets/app.css": "body{}\n",
  };
}

function docsFiles(marker = "docs"): Record<string, string> {
  return {
    "index.html": `<!doctype html><html lang="ja">${marker} home</html>\n`,
    "deploy/index.html": `<!doctype html><html lang="ja">${marker} deploy</html>\n`,
  };
}

async function fixtureRoot(
  definition: StaticSiteDefinition,
  files: Record<string, string> | null,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "takos-static-site-"));
  if (files !== null) await writeOutput(definition, root, files);
  return root;
}

async function writeOutput(
  definition: StaticSiteDefinition,
  root: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [name, contents] of Object.entries(files)) {
    const path = join(root, definition.outputDir, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents);
  }
}

type FakeOptions = {
  commit?: string;
  branch?: string;
  clean?: boolean;
  /** null = the project is not visible to this token. */
  deployments?: unknown[] | null;
  deployStdout?: string;
  deployExitCode?: number;
  gateExitCode?: number;
  /** What each fetched URL serves. Missing = 404. */
  served?: Record<string, string>;
  /** null = no credential in the environment at all. */
  token?: string | null;
  onGate?: () => Promise<void>;
};

function fakeRuntime(options: FakeOptions = {}): {
  runtime: SurfaceRuntime;
  fetched: string[];
} {
  const fetched: string[] = [];
  const runtime: SurfaceRuntime = {
    env: {
      CLOUDFLARE_API_TOKEN:
        options.token === null ? undefined : (options.token ?? "fixture-token"),
    },
    sleep: async () => {},
    async run(request: CommandRequest): Promise<CommandResult> {
      const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: "" });
      if (request.command === "git") {
        const args = request.args.join(" ");
        if (args === "rev-parse HEAD") return ok(`${options.commit ?? HEAD}\n`);
        if (args === "rev-parse --abbrev-ref HEAD") {
          return ok(`${options.branch ?? "main"}\n`);
        }
        if (args.startsWith("log")) return ok("fixture subject\n");
        if (args === "status --porcelain") {
          return ok(options.clean === false ? " M website/src/app.tsx\n" : "");
        }
        throw new Error(`unexpected git ${args}`);
      }
      if (request.command === "bun" || request.command === "npm") {
        if (options.onGate) await options.onGate();
        return options.gateExitCode
          ? { exitCode: options.gateExitCode, stdout: "", stderr: "gate said no\n" }
          : ok("gate ok\n");
      }
      if (request.command === "wrangler") {
        const args = request.args.join(" ");
        if (args.startsWith("pages deployment list")) {
          if (options.deployments === null) {
            return {
              exitCode: 1,
              stdout: "",
              stderr: "✘ Project not found. [code: 8000007]\n",
            };
          }
          return ok(JSON.stringify(options.deployments ?? [previousRow()]));
        }
        if (args.startsWith("pages deploy")) {
          return {
            exitCode: options.deployExitCode ?? 0,
            stdout:
              options.deployStdout ??
              `✨ Deployment complete! Take a peek over at ${NEW_URL}\n`,
            stderr: "",
          };
        }
        throw new Error(`unexpected wrangler ${args}`);
      }
      throw new Error(`unexpected command ${request.command}`);
    },
    async fetch(url: string): Promise<Response> {
      fetched.push(url);
      const body = options.served?.[url];
      if (body === undefined) return new Response("missing", { status: 404 });
      return new Response(body, { status: 200 });
    },
  };
  return { runtime, fetched };
}

function previousRow(): unknown {
  return {
    id: DEPLOYMENT,
    url: PREVIOUS_URL,
    environment: "production",
    created_on: "2026-08-01T00:00:00Z",
    deployment_trigger: { metadata: { commit_hash: OTHER } },
  };
}

/** Everything a happy production publication must be able to read back. */
function servedForSite(files: Record<string, string>): Record<string, string> {
  return {
    [`${NEW_URL}/`]: files["index.html"],
    "https://takos.jp/": files["index.html"],
    "https://takos.jp/en/": files["en/index.html"],
  };
}

/* ------------------------------------------------------------- contract */

test("both static surfaces answer the obligations the policy makes them owe", async () => {
  const packageJson = JSON.parse(
    await readFile(join(repositoryRoot, "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };

  for (const surface of [TAKOS_SITE_SURFACE, TAKOS_DOCS_SURFACE] as const) {
    // Prerendered bytes: no durable state, no consumer-pinned identity, so the
    // triggers are empty and only the baseline four are owed.
    expect([...surface.triggers]).toEqual([]);
    for (const obligation of [
      "provenance",
      "post-conditions",
      "reversal",
      "failure-handling",
    ] as const) {
      expect(surface.obligations[obligation].trim().length).toBeGreaterThan(0);
    }
    // Not owed, answered anyway: a static site pins nothing.
    expect(surface.obligations["no-overwrite"]).toContain(
      "mints no identity a consumer pins",
    );
    // The control gate requires every declared variable to be discoverable
    // from this surface's own answers.
    const answers = Object.values(surface.obligations).join("\n");
    for (const variable of surface.requiresEnv) {
      expect(answers).toContain(variable);
    }
    // ... and every named package script to exist.
    for (const script of surface.requiresScripts) {
      expect(packageJson.scripts[script]).toEqual(expect.any(String));
    }
  }

  expect(TAKOS_SITE_SURFACE.target).toBe("cloudflare-pages:takos-landing");
  expect(TAKOS_DOCS_SURFACE.target).toBe("cloudflare-pages:takos-docs");
  // docs.takos.jp is its own origin, which is what the docs are built for: the
  // VitePress config declares no `base`, so every asset link is root-relative.
  expect(TAKOS_DOCS_DEFINITION.publicUrl).toBe("https://docs.takos.jp");
  expect(TAKOS_SITE_DEFINITION.publicUrl).toBe("https://takos.jp");
  expect(STATIC_SITE_USAGE).toContain("--status never issues a command");
});

test("the entrypoint dispatches both static surfaces and maps the refusal exit code", async () => {
  for (const surface of ["takos-site", "takos-docs"] as const) {
    // No phase: the refusal has to happen before anything reaches the account,
    // and the operator has to be told how to invoke this.
    const attempt = Bun.spawn(["bun", "scripts/deploy.mjs", surface], {
      cwd: repositoryRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, CLOUDFLARE_API_TOKEN: "" },
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(attempt.stdout).text(),
      new Response(attempt.stderr).text(),
      attempt.exited,
    ]);
    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toContain("a phase is required");
    expect(stderr).toContain(`bun run deploy -- ${surface} --status`);
  }
});

test("naming a static surface without a phase is refused, not guessed", () => {
  expect(() => parseStaticSiteArgs("takos-site", [], repositoryRoot)).toThrow(
    "a phase is required",
  );
  expect(() =>
    parseStaticSiteArgs("takos-site", ["--apply"], repositoryRoot),
  ).toThrow("--environment is required");
  expect(() =>
    parseStaticSiteArgs(
      "takos-site",
      ["--apply", "--environment", "staging"],
      repositoryRoot,
    ),
  ).toThrow("--environment must be one of");
  expect(() =>
    parseStaticSiteArgs(
      "takos-site",
      ["--apply", "--status", "--environment", "production"],
      repositoryRoot,
    ),
  ).toThrow("only one phase");
  expect(() =>
    parseStaticSiteArgs(
      "takos-site",
      ["--apply", "--environment", "production", "--commit", "abc"],
      repositoryRoot,
    ),
  ).toThrow("--commit must be a full 40-character commit id");
  expect(() => parseStaticSiteArgs("takos-worker", [], repositoryRoot)).toThrow(
    "unknown static site surface",
  );
});

/* ------------------------------------------------------ target mutation */

test("only the upload is classified as touching the Pages project", () => {
  expect(
    mutatesTarget({
      command: "wrangler",
      args: ["pages", "deployment", "list", "--project-name", "takos-landing"],
    }),
  ).toBe(false);
  expect(mutatesTarget({ command: "wrangler", args: ["pages", "project", "list"] })).toBe(
    false,
  );
  expect(
    mutatesTarget({ command: "wrangler", args: ["pages", "deploy", "dist"] }),
  ).toBe(true);
  expect(
    mutatesTarget({
      command: "wrangler",
      args: ["pages", "deployment", "delete", DEPLOYMENT],
    }),
  ).toBe(true);
  expect(mutatesTarget({ command: "git", args: ["rev-parse", "HEAD"] })).toBe(false);
  expect(mutatesTarget({ command: "git", args: ["push"] })).toBe(true);
  expect(mutatesTarget({ command: "bun", args: ["run", "docs:build"] })).toBe(false);
  expect(mutatesTarget({ command: "npm", args: ["run", "build"] })).toBe(false);
  // Unrecognized is a mutation. The allowlist fails closed.
  expect(mutatesTarget({ command: "curl", args: ["-X", "POST", "https://api"] })).toBe(
    true,
  );
});

/* ------------------------------------------------- build output discovery */

test("build output discovery reaches the bytes and names the build when it cannot", async () => {
  const empty = await fixtureRoot(TAKOS_SITE_DEFINITION, null);
  await expect(
    discoverBuildOutput(TAKOS_SITE_DEFINITION, empty),
  ).rejects.toThrow("cd website && npm ci && npm run build");

  const partial = await fixtureRoot(TAKOS_SITE_DEFINITION, {
    "index.html": "<html></html>\n",
  });
  // A page the surface promises to smoke must exist before publication, or the
  // post-condition could never be evaluated.
  await expect(
    discoverBuildOutput(TAKOS_SITE_DEFINITION, partial),
  ).rejects.toThrow("website/.output/public/en/index.html is missing");

  const files = siteFiles();
  const complete = await fixtureRoot(TAKOS_SITE_DEFINITION, files);
  const output = await discoverBuildOutput(TAKOS_SITE_DEFINITION, complete);
  expect(output.files).toEqual(["assets/app.css", "en/index.html", "index.html"]);
  expect(output.entryDigest).toBe(digest(files["index.html"]));
  expect(output.digests["en/index.html"]).toBe(digest(files["en/index.html"]));

  const docsRoot = await fixtureRoot(TAKOS_DOCS_DEFINITION, docsFiles());
  const docsOutput = await discoverBuildOutput(TAKOS_DOCS_DEFINITION, docsRoot);
  expect(Object.keys(docsOutput.digests).sort()).toEqual([
    "deploy/index.html",
    "index.html",
  ]);
});

test("the published tree is scanned for credential shapes", async () => {
  const files = siteFiles();
  const root = await fixtureRoot(TAKOS_SITE_DEFINITION, {
    ...files,
    "assets/app.css": "body{}\n",
    "config.json": '{"token":"ghp_' + "z".repeat(36) + '"}\n',
  });
  const output = await discoverBuildOutput(TAKOS_SITE_DEFINITION, root);
  const leaks = await scanPublishedBytes(output);
  expect(leaks.join("\n")).toContain("config.json");

  const clean = await fixtureRoot(TAKOS_SITE_DEFINITION, files);
  expect(
    await scanPublishedBytes(
      await discoverBuildOutput(TAKOS_SITE_DEFINITION, clean),
    ),
  ).toEqual([]);
});

/* -------------------------------------------------------------- --status */

test("--status reads the project and refuses to issue anything that mutates", async () => {
  const files = siteFiles();
  const root = await fixtureRoot(TAKOS_SITE_DEFINITION, files);
  const { runtime, fetched } = fakeRuntime({
    served: {
      "https://takos.jp/": files["index.html"],
      "https://takos.jp/en/": files["en/index.html"],
    },
  });
  const { report, issued } = await runStaticSiteRecorded(
    parseStaticSiteArgs(
      "takos-site",
      ["--status", "--environment", "production"],
      root,
    ),
    runtime,
  );

  expect(issued.every((request) => !mutatesTarget(request))).toBe(true);
  expect(
    issued.some(
      (request) =>
        request.command === "wrangler" && request.args[1] === "deploy",
    ),
  ).toBe(false);
  // The scoped gate is a phase of --apply. --status builds nothing.
  expect(issued.some((request) => request.command === "npm")).toBe(false);

  expect(report.kind).toBe("takos.static-site-status@v1");
  expect(report.projectPresent).toBe(true);
  expect(report.productionDeployment).toMatchObject({
    id: DEPLOYMENT,
    commit: OTHER,
  });
  expect(report.buildOutput).toMatchObject({ present: true, files: 3 });
  expect(fetched).toEqual(["https://takos.jp/", "https://takos.jp/en/"]);
  // production serves a different commit than HEAD, and that is drift, not a
  // failure: --status never decides to deploy.
  expect((report.drift as string[]).join("\n")).toContain(
    `production serves the build of ${OTHER}`,
  );
});

test("--status reports an absent project and an absent build instead of failing", async () => {
  const root = await fixtureRoot(TAKOS_DOCS_DEFINITION, null);
  const { runtime } = fakeRuntime({ deployments: null });
  const { report } = await runStaticSiteRecorded(
    parseStaticSiteArgs(
      "takos-docs",
      ["--status", "--environment", "production"],
      root,
    ),
    runtime,
  );
  expect(report.projectPresent).toBe(false);
  const drift = (report.drift as string[]).join("\n");
  expect(drift).toContain("does not exist or the token cannot see it");
  expect(drift).toContain("no publishable build output");
  expect(report.buildOutput).toMatchObject({ present: false });
});

/* --------------------------------------------------------------- refusals */

test("nothing is uploaded without --execute", async () => {
  const files = siteFiles();
  const root = await fixtureRoot(TAKOS_SITE_DEFINITION, files);
  const { runtime, fetched } = fakeRuntime();
  const { report, issued } = await runStaticSiteRecorded(
    parseStaticSiteArgs(
      "takos-site",
      ["--apply", "--environment", "production"],
      root,
    ),
    runtime,
  );
  expect(report.outcome).toBe("planned");
  expect(report.mutation).toBe("none");
  expect(report.rollback).toContain(DEPLOYMENT);
  expect(report.gate).toEqual([
    "bun run check:website-host",
    "npm run build",
  ]);
  expect(issued.every((request) => !mutatesTarget(request))).toBe(true);
  expect(fetched).toEqual([]);
});

test("--apply refuses before the account is touched when the credential is absent", async () => {
  const root = await fixtureRoot(TAKOS_SITE_DEFINITION, siteFiles());
  const { runtime, fetched } = fakeRuntime({ token: null });
  await expect(
    runStaticSiteRecorded(
      parseStaticSiteArgs(
        "takos-site",
        ["--apply", "--environment", "production", "--execute"],
        root,
      ),
      runtime,
    ),
  ).rejects.toMatchObject({
    exitCode: 2,
    message: expect.stringContaining("CLOUDFLARE_API_TOKEN is not set"),
  });
  expect(fetched).toEqual([]);
});

test("production refuses a dirty worktree and an unpinned branch", async () => {
  const root = await fixtureRoot(TAKOS_SITE_DEFINITION, siteFiles());

  const dirty = fakeRuntime({ clean: false });
  await expect(
    runStaticSiteRecorded(
      parseStaticSiteArgs(
        "takos-site",
        ["--apply", "--environment", "production", "--execute"],
        root,
      ),
      dirty.runtime,
    ),
  ).rejects.toMatchObject({
    exitCode: 2,
    message: expect.stringContaining("the worktree is not clean"),
  });

  const branch = fakeRuntime({ branch: "feature/site" });
  await expect(
    runStaticSiteRecorded(
      parseStaticSiteArgs(
        "takos-site",
        ["--apply", "--environment", "production", "--execute"],
        root,
      ),
      branch.runtime,
    ),
  ).rejects.toMatchObject({
    exitCode: 2,
    message: expect.stringContaining("clean main or an exact --commit"),
  });

  // The same non-main HEAD is publishable when the operator pins it exactly.
  const pinned = fakeRuntime({
    branch: "feature/site",
    served: servedForSite(siteFiles()),
  });
  const { report } = await runStaticSiteRecorded(
    parseStaticSiteArgs(
      "takos-site",
      [
        "--apply",
        "--environment",
        "production",
        "--commit",
        HEAD,
        "--execute",
      ],
      root,
    ),
    pinned.runtime,
  );
  expect(report.outcome).toBe("deployed");
});

test("integration may publish a dirty worktree as a preview branch", async () => {
  const files = siteFiles();
  const root = await fixtureRoot(TAKOS_SITE_DEFINITION, files);
  const { runtime, fetched } = fakeRuntime({
    clean: false,
    deployStdout: [
      "✨ Deployment alias URL: https://integration.takos-landing.pages.dev",
      `✨ Deployment complete! Take a peek over at ${NEW_URL}`,
      "",
    ].join("\n"),
    served: {
      [`${NEW_URL}/`]: files["index.html"],
      [`${NEW_URL}/en/`]: files["en/index.html"],
      // A stale public alias must not matter: a preview never moves it.
      "https://takos.jp/": "<html>old production</html>\n",
    },
  });
  const { report, issued } = await runStaticSiteRecorded(
    parseStaticSiteArgs(
      "takos-site",
      ["--apply", "--environment", "integration", "--execute"],
      root,
    ),
    runtime,
  );
  expect(report.outcome).toBe("deployed");
  expect(report.branch).toBe("integration");
  const upload = issued.find(
    (request) => request.command === "wrangler" && request.args[1] === "deploy",
  );
  expect(upload?.args).toContain("--branch");
  expect(upload?.args[upload.args.indexOf("--branch") + 1]).toBe("integration");
  expect(upload?.args).toContain("--commit-dirty=true");
  // The public alias is never read for a preview: that would be someone
  // else's bytes.
  expect(fetched.every((url) => url.startsWith(NEW_URL))).toBe(true);
  expect((report.readback as { publicAliasChecked: boolean }).publicAliasChecked).toBe(
    false,
  );
});

test("an absent Pages project is a refusal, because this surface never creates one", async () => {
  const root = await fixtureRoot(TAKOS_DOCS_DEFINITION, docsFiles());
  const { runtime } = fakeRuntime({ deployments: null });
  await expect(
    runStaticSiteRecorded(
      parseStaticSiteArgs(
        "takos-docs",
        ["--apply", "--environment", "production", "--execute"],
        root,
      ),
      runtime,
    ),
  ).rejects.toMatchObject({
    exitCode: 2,
    message: expect.stringContaining("provisioning and DNS are a separate authority"),
  });
});

test("a failing scoped gate stops the deploy before the upload", async () => {
  const root = await fixtureRoot(TAKOS_DOCS_DEFINITION, docsFiles());
  const { runtime, fetched } = fakeRuntime({ gateExitCode: 1 });
  await expect(
    runStaticSiteRecorded(
      parseStaticSiteArgs(
        "takos-docs",
        ["--apply", "--environment", "production", "--execute"],
        root,
      ),
      runtime,
    ),
  ).rejects.toMatchObject({
    exitCode: 2,
    message: expect.stringContaining("bun run validate:current-docs"),
    detail: expect.stringContaining("gate said no"),
  });
  expect(fetched).toEqual([]);
});

test("credential material in the built bytes stops the deploy", async () => {
  const root = await fixtureRoot(TAKOS_DOCS_DEFINITION, {
    ...docsFiles(),
    "reference/env.html": "<pre>CLOUDFLARE_API_TOKEN: 8f3d9c2a1b</pre>\n",
  });
  const { runtime } = fakeRuntime();
  await expect(
    runStaticSiteRecorded(
      parseStaticSiteArgs(
        "takos-docs",
        ["--apply", "--environment", "production", "--execute"],
        root,
      ),
      runtime,
    ),
  ).rejects.toMatchObject({
    exitCode: 2,
    message: expect.stringContaining("contains credential material"),
  });
});

/* ------------------------------------------------------- publication path */

test("a production publication builds, uploads once, and reads its own bytes back", async () => {
  const files = docsFiles();
  const root = await fixtureRoot(TAKOS_DOCS_DEFINITION, null);
  const { runtime, fetched } = fakeRuntime({
    // The gate produces the bytes; discovery must happen after it.
    onGate: () => writeOutput(TAKOS_DOCS_DEFINITION, root, files),
    deployStdout: `✨ Deployment complete! Take a peek over at ${DOCS_URL}\n`,
    served: {
      [`${DOCS_URL}/`]: files["index.html"],
      "https://docs.takos.jp/": files["index.html"],
      "https://docs.takos.jp/deploy/": files["deploy/index.html"],
    },
  });
  const { report, issued } = await runStaticSiteRecorded(
    parseStaticSiteArgs(
      "takos-docs",
      ["--apply", "--environment", "production", "--execute"],
      root,
    ),
    runtime,
  );

  expect(report.outcome).toBe("deployed");
  expect(report.mutation).toBe("wrangler-pages-deploy");
  expect(report.deploymentUrl).toBe(DOCS_URL);
  expect(report.commit).toBe(HEAD);
  expect(report.previousDeployment).toMatchObject({ id: DEPLOYMENT });
  expect(report.rollback).toContain(
    `/pages/projects/takos-docs/deployments/${DEPLOYMENT}/rollback`,
  );

  // Exactly one upload, and it carries the commit it was built from.
  const uploads = issued.filter(
    (request) => request.command === "wrangler" && request.args[1] === "deploy",
  );
  expect(uploads).toHaveLength(1);
  expect(uploads[0].args).toContain("--commit-dirty=false");
  expect(uploads[0].args[uploads[0].args.indexOf("--commit-hash") + 1]).toBe(HEAD);

  // The gate ran before the upload, and the bytes it produced are the bytes
  // that were read back.
  const gateIndex = issued.findIndex((request) => request.command === "bun");
  expect(gateIndex).toBeGreaterThanOrEqual(0);
  expect(gateIndex).toBeLessThan(issued.indexOf(uploads[0]));
  expect(fetched).toEqual([
    `${DOCS_URL}/`,
    "https://docs.takos.jp/",
    "https://docs.takos.jp/deploy/",
  ]);
  expect(
    (report.output as { digests: Record<string, string> }).digests["deploy/index.html"],
  ).toBe(digest(files["deploy/index.html"]));
});

test("a stale docs page after publication is a post-condition failure, not a retry", async () => {
  const files = docsFiles();
  const root = await fixtureRoot(TAKOS_DOCS_DEFINITION, files);
  const { runtime } = fakeRuntime({
    deployStdout: `✨ Deployment complete! Take a peek over at ${DOCS_URL}\n`,
    served: {
      [`${DOCS_URL}/`]: files["index.html"],
      "https://docs.takos.jp/": files["index.html"],
      // The front page moved and the deploy page did not. Checking only `/`
      // would have called this a success.
      "https://docs.takos.jp/deploy/": docsFiles("previous")["deploy/index.html"],
    },
  });
  await expect(
    runStaticSiteRecorded(
      parseStaticSiteArgs(
        "takos-docs",
        ["--apply", "--environment", "production", "--execute"],
        root,
      ),
      runtime,
    ),
  ).rejects.toMatchObject({
    exitCode: 4,
    message: expect.stringContaining("https://docs.takos.jp/deploy/"),
  });
});

test("the readback follows the immutable deployment, not the branch alias", () => {
  // A branch publication prints both. The alias moves; the hash does not.
  expect(
    immutableDeploymentUrl(
      [
        "✨ Deployment alias URL: https://integration.takos-landing.pages.dev",
        `✨ Deployment complete! Take a peek over at ${NEW_URL}`,
      ].join("\n"),
      "takos-landing",
    ),
  ).toBe(NEW_URL);
  expect(immutableDeploymentUrl("nothing here", "takos-landing")).toBeNull();
  // No hash-shaped URL at all: take what wrangler gave rather than inventing one.
  expect(
    immutableDeploymentUrl(
      "https://integration.takos-landing.pages.dev",
      "takos-landing",
    ),
  ).toBe("https://integration.takos-landing.pages.dev");
});

test("an upload that prints no deployment URL is indeterminate, not a failure to publish", async () => {
  const root = await fixtureRoot(TAKOS_SITE_DEFINITION, siteFiles());
  const { runtime } = fakeRuntime({ deployStdout: "uploaded 3 files\n" });
  await expect(
    runStaticSiteRecorded(
      parseStaticSiteArgs(
        "takos-site",
        ["--apply", "--environment", "production", "--execute"],
        root,
      ),
      runtime,
    ),
  ).rejects.toMatchObject({
    exitCode: 3,
    message: expect.stringContaining("no immutable deployment URL"),
  });

  const failed = fakeRuntime({ deployExitCode: 1 });
  await expect(
    runStaticSiteRecorded(
      parseStaticSiteArgs(
        "takos-site",
        ["--apply", "--environment", "production", "--execute"],
        root,
      ),
      failed.runtime,
    ),
  ).rejects.toMatchObject({
    exitCode: 3,
    message: expect.stringContaining("may or may not have landed"),
  });
});

test("a first publication states that there is no revert point", async () => {
  const files = siteFiles();
  const root = await fixtureRoot(TAKOS_SITE_DEFINITION, files);
  const { runtime } = fakeRuntime({
    deployments: [],
    served: servedForSite(files),
  });
  const { report } = await runStaticSiteRecorded(
    parseStaticSiteArgs(
      "takos-site",
      ["--apply", "--environment", "production", "--execute"],
      root,
    ),
    runtime,
  );
  expect(report.previousDeployment).toBeNull();
  expect(report.rollback).toContain("no earlier production deployment exists");
  expect(report.outcome).toBe("deployed");
});
