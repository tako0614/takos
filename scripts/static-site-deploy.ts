/**
 * The two Takos static publication surfaces: the takos.jp product site and the
 * docs.takos.jp documentation site.
 *
 * Both publish a folder of prerendered bytes to a Cloudflare Pages project.
 * Neither owns durable state, a server handler, a credential the target holds,
 * or an identity a consumer pins, so both stay in the policy's routine
 * `static` lane: integration and rehearsal may publish from a dirty worktree as
 * a Pages preview branch, production publishes from clean `main` or an exact
 * commit and moves the production alias.
 *
 * What this surface deliberately does not own:
 *
 *   - creating the Pages project, or attaching `takos.jp` / `docs.takos.jp` to
 *     it. That is initial provisioning and DNS, a separate authority in
 *     takos-control `engineering.policy.json` -> `deploy.separateAuthorities`.
 *   - the Takos Worker at app.takos.jp, which is `takos-cloudflare-production`.
 *
 * Obligations and triggers come from takos-control `engineering.policy.json`.
 * Nothing here authorizes a deploy: a green gate, a branch name, or a task
 * ledger entry does not.
 */

import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

const COMMIT = /^[0-9a-f]{40}$/u;
const MISSING_PROJECT =
  /project not found|8000007|could not find|does not exist|no such project|not_found/iu;

/**
 * Credential shapes that must never reach a public bucket. The site and the
 * docs are both built from repository sources that a person edits by hand, so
 * the cheap scan runs over the exact bytes being published rather than over the
 * sources they came from.
 */
const CREDENTIAL_SHAPES: readonly RegExp[] = [
  /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bsk_live_[0-9A-Za-z]{16,}/u,
  /\bgh[pousr]_[0-9A-Za-z]{30,}/u,
  /\bCLOUDFLARE_API_(?:TOKEN|KEY)\s*[=:]\s*\S/u,
];
const BINARY_FILE = /\.(?:png|jpe?g|webp|avif|gif|ico|woff2?|ttf|otf|eot|mp4|webm|pdf|zip|gz|br|wasm)$/u;
const CREDENTIAL_FILE = /(^|\/)\.env(\.|$)|\.pem$|\.p12$|\.pfx$|\.key$/u;

export type Environment = "integration" | "rehearsal" | "production";
export type Phase = "status" | "apply";

export type CommandRequest = Readonly<{
  command: string;
  args: readonly string[];
  cwd?: string;
}>;

export type CommandResult = Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

export type FetchOptions = Readonly<{ redirect: "follow" | "manual" }>;

export type SurfaceRuntime = Readonly<{
  run: (request: CommandRequest) => Promise<CommandResult>;
  fetch: (url: string, options: FetchOptions) => Promise<Response>;
  sleep: (milliseconds: number) => Promise<void>;
  /** Read only. The credential selects the account and is never recorded. */
  env: Readonly<Record<string, string | undefined>>;
}>;

/** One published path and the built file whose bytes it must serve. */
export type SmokeTarget = Readonly<{ path: string; file: string }>;

export type StaticSiteDefinition = Readonly<{
  surface: string;
  project: string;
  publicUrl: string;
  productionBranch: string;
  /** Repository-relative directory the build writes and the upload publishes. */
  outputDir: string;
  /** What to run when the output is missing or stale. */
  buildRemedy: string;
  /**
   * The scoped gate. Policy scopes validation to the artifact: a folder of
   * prerendered HTML is not gated on the Worker's whole test suite. The last
   * step is the build, so the bytes that are published are the bytes the gate
   * just produced.
   */
  gate: readonly CommandRequest[];
  /** `/` first; the deploy is not called good until each one serves its bytes. */
  smoke: readonly SmokeTarget[];
  /**
   * True when the built bytes name a Takos release tag a visitor is sent to.
   * takos.jp's install deep link and its self-host runbook both do, so this
   * surface must not publish a build whose ref does not exist on `origin`:
   * every Install click and every copied `git checkout` would fail.
   */
  publishesInstallRef?: boolean;
}>;

export const TAKOS_SITE_DEFINITION: StaticSiteDefinition = {
  surface: "takos-site",
  project: "takos-landing",
  publicUrl: "https://takos.jp",
  productionBranch: "main",
  outputDir: "website/.output/public",
  buildRemedy: "cd website && npm ci && npm run build",
  gate: [
    { command: "bun", args: ["run", "check:website-host"] },
    { command: "npm", args: ["run", "build"], cwd: "website" },
  ],
  smoke: [
    { path: "/", file: "index.html" },
    { path: "/en/", file: "en/index.html" },
  ],
  publishesInstallRef: true,
};

export const TAKOS_DOCS_DEFINITION: StaticSiteDefinition = {
  surface: "takos-docs",
  project: "takos-docs",
  publicUrl: "https://docs.takos.jp",
  productionBranch: "main",
  outputDir: "docs/.vitepress/dist",
  buildRemedy: "bun run docs:build",
  gate: [
    { command: "bun", args: ["run", "validate:current-docs"] },
    { command: "bun", args: ["run", "validate:api-docs"] },
    { command: "bun", args: ["run", "docs:build"] },
  ],
  smoke: [
    { path: "/", file: "index.html" },
    { path: "/deploy/", file: "deploy/index.html" },
  ],
};

export const TAKOS_SITE_SURFACE = {
  surface: "takos-site",
  target: "cloudflare-pages:takos-landing",
  covers: [
    "website/app.config.ts",
    "website/package.json",
    "scripts/static-site-deploy.ts",
    "scripts/check-website-host-drift.mjs",
  ],
  requiresScripts: ["deploy", "check:website-host"],
  requiresTools: ["bun", "git", "npm", "wrangler"],
  requiresEnv: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
  // Prerendered public bytes. No durable state, no server handler, no
  // target-held credential, and no version anyone pins.
  triggers: [],
  obligations: {
    provenance:
      "--apply --environment=production refuses a dirty worktree and requires clean main or an exact --commit equal to HEAD; integration and rehearsal publish as a Pages preview branch and may be dirty. The bytes are built here, from that worktree, by the scoped gate itself: `bun run check:website-host` guards the CTA and CSP tokens the landing page ships, then `npm run build` in website/ prerenders website/.output/public, so the published bytes are the bytes the gate just produced rather than a folder found lying on disk. The commit, the branch, the file count, and the SHA-256 of every smoked file are printed with the result, and the published tree is scanned for credential shapes before the upload. CLOUDFLARE_API_TOKEN, and CLOUDFLARE_ACCOUNT_ID when the token reaches more than one account, select the target and are read from the environment only; no credential is written, recorded, or echoed.",
    "post-conditions":
      "The upload is not called done until the exact built bytes are being served. The immutable https://<hash>.takos-landing.pages.dev deployment is fetched and must return the SHA-256 of the index.html just built; production additionally fetches https://takos.jp/ and https://takos.jp/en/ and requires each to return the digest of the file behind it, retrying with backoff for propagation only. A stale or missing page fails the deploy instead of reporting success. integration and rehearsal smoke the immutable preview URL only, because a preview never moves the public alias.",
    reversal:
      "The current production deployment id, its URL and its commit are read from `wrangler pages deployment list --project-name takos-landing --environment production --json` and printed before anything is uploaded. Restore it through Cloudflare's own Pages deployment history: the dashboard's Rollback to this deployment on that id, or POST /accounts/<account>/pages/projects/takos-landing/deployments/<id>/rollback. wrangler has no `pages rollback` subcommand, so the entrypoint prints the id and the exact restore target rather than pretending to own a command it does not have. On a first deployment there is no earlier id; that is stated in the output and the forward repair is to publish the previous commit's build.",
    "failure-handling":
      "Every phase is read-only until --execute is passed, and --status refuses to issue a mutating command at all. Failures carry wrangler's own stdout and stderr and name which side of the mutation they fell on: exit 2 means nothing was touched, exit 3 means the upload may have landed and the state is indeterminate, exit 4 means the bytes are published but a post-condition failed. There is no retry; exit 3 and exit 4 send the operator to --status for an authoritative readback first. A missing CLOUDFLARE_API_TOKEN, an absent Pages project, a missing build output, a credential shape in the published tree, a dirty production worktree, and a failing scoped gate are all refusals before the account is touched.",
    "no-overwrite":
      "Not owed and stated anyway: this surface mints no identity a consumer pins. A Pages deployment id is a routine deployment record, addressable but not resolved by anyone downstream, and no package, image, tag or release is published here. Re-publishing the same commit produces a new deployment id and overwrites nothing that another artifact resolves. The Pages project itself is never created, renamed, or attached to a domain by this surface; that is provisioning and DNS, a separate authority.",
  },
} as const;

export const TAKOS_DOCS_SURFACE = {
  surface: "takos-docs",
  target: "cloudflare-pages:takos-docs",
  covers: [
    "docs/.vitepress/config.ts",
    "scripts/static-site-deploy.ts",
    "scripts/validate-current-docs.ts",
    "scripts/validate-api-docs.ts",
  ],
  requiresScripts: ["deploy", "docs:build", "validate:current-docs", "validate:api-docs"],
  requiresTools: ["bun", "git", "wrangler"],
  requiresEnv: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
  // Prerendered public bytes, on their own origin. Same class as the site.
  triggers: [],
  obligations: {
    provenance:
      "--apply --environment=production refuses a dirty worktree and requires clean main or an exact --commit equal to HEAD; integration and rehearsal publish as a Pages preview branch and may be dirty. The bytes are built here, from that worktree, by the scoped gate itself: `bun run validate:current-docs` and `bun run validate:api-docs` guard the docs boundary and the API reference, then `bun run docs:build` renders docs/.vitepress/dist, so the published bytes are the bytes the gate just produced. Policy scopes validation to the artifact on purpose, so a documentation publication is not gated on the Worker's test suite. The commit, the branch, the file count, and the SHA-256 of every smoked file are printed with the result, and the published tree is scanned for credential shapes before the upload. CLOUDFLARE_API_TOKEN, and CLOUDFLARE_ACCOUNT_ID when the token reaches more than one account, select the target and are read from the environment only; no credential is written, recorded, or echoed.",
    "post-conditions":
      "The upload is not called done until the exact built bytes are being served. The immutable https://<hash>.takos-docs.pages.dev deployment is fetched and must return the SHA-256 of the index.html just built; production additionally fetches https://docs.takos.jp/ and the https://docs.takos.jp/deploy/ page and requires each to return the digest of the file behind it, retrying with backoff for propagation only. Reading a real docs page and not only the front door is the point: a VitePress build that renders a broken route still serves a fine index. integration and rehearsal smoke the immutable preview URL only, because a preview never moves the public alias.",
    reversal:
      "The current production deployment id, its URL and its commit are read from `wrangler pages deployment list --project-name takos-docs --environment production --json` and printed before anything is uploaded. Restore it through Cloudflare's own Pages deployment history: the dashboard's Rollback to this deployment on that id, or POST /accounts/<account>/pages/projects/takos-docs/deployments/<id>/rollback. wrangler has no `pages rollback` subcommand, so the entrypoint prints the id and the exact restore target rather than pretending to own a command it does not have. On a first deployment there is no earlier id; that is stated in the output and the forward repair is to publish the previous commit's build.",
    "failure-handling":
      "Every phase is read-only until --execute is passed, and --status refuses to issue a mutating command at all. Failures carry wrangler's own stdout and stderr and name which side of the mutation they fell on: exit 2 means nothing was touched, exit 3 means the upload may have landed and the state is indeterminate, exit 4 means the bytes are published but a post-condition failed. There is no retry; exit 3 and exit 4 send the operator to --status for an authoritative readback first. A missing CLOUDFLARE_API_TOKEN, an absent Pages project, a missing build output, a credential shape in the published tree, a dirty production worktree, and a failing scoped gate are all refusals before the account is touched.",
    "no-overwrite":
      "Not owed and stated anyway: this surface mints no identity a consumer pins. A Pages deployment id is a routine deployment record, addressable but not resolved by anyone downstream, and no package, image, tag or release is published here. Re-publishing the same commit produces a new deployment id and overwrites nothing that another artifact resolves. The Pages project itself is never created, renamed, or attached to a domain by this surface; that is provisioning and DNS, a separate authority.",
  },
} as const;

export const STATIC_SITE_DEFINITIONS: Readonly<
  Record<string, StaticSiteDefinition>
> = {
  [TAKOS_SITE_DEFINITION.surface]: TAKOS_SITE_DEFINITION,
  [TAKOS_DOCS_DEFINITION.surface]: TAKOS_DOCS_DEFINITION,
};

export const STATIC_SITE_USAGE = `Usage:
  bun run deploy -- takos-site --status --environment <integration|rehearsal|production>
  bun run deploy -- takos-site --apply  --environment <env> [--commit <sha>] [--execute]
  bun run deploy -- takos-docs --status --environment <integration|rehearsal|production>
  bun run deploy -- takos-docs --apply  --environment <env> [--commit <sha>] [--execute]

--status never issues a command that changes the Pages project. --apply builds
the site with its own scoped gate, prints the deployment it would replace, and
uploads only when --execute is passed. production requires clean main or an
exact --commit equal to HEAD; integration and rehearsal publish to a Pages
preview branch and leave the public alias alone. CLOUDFLARE_API_TOKEN selects
the account and is read from the environment only.`;

type FailureStage = "refused" | "indeterminate" | "post-conditions";

const EXIT_CODES: Readonly<Record<FailureStage, number>> = {
  refused: 2,
  indeterminate: 3,
  "post-conditions": 4,
};

export class StaticSiteDeployError extends Error {
  readonly stage: FailureStage;
  readonly exitCode: number;
  readonly detail: string | undefined;

  constructor(stage: FailureStage, message: string, detail?: string) {
    super(message);
    this.name = "StaticSiteDeployError";
    this.stage = stage;
    this.exitCode = EXIT_CODES[stage];
    this.detail = detail;
  }
}

function refuse(message: string, detail?: string): never {
  throw new StaticSiteDeployError("refused", message, detail);
}

export type StaticSiteOptions = Readonly<{
  definition: StaticSiteDefinition;
  phase: Phase;
  environment: Environment;
  commit?: string;
  execute: boolean;
  root: string;
}>;

const PHASES: Readonly<Record<string, Phase | undefined>> = {
  "--status": "status",
  "--apply": "apply",
};

const ENVIRONMENTS: readonly Environment[] = [
  "integration",
  "rehearsal",
  "production",
];

export function parseStaticSiteArgs(
  surface: string,
  args: readonly string[],
  root: string = process.cwd(),
): StaticSiteOptions {
  const definition = STATIC_SITE_DEFINITIONS[surface];
  if (!definition) {
    refuse(
      `unknown static site surface ${surface}; known: ${Object.keys(STATIC_SITE_DEFINITIONS).join(", ")}`,
    );
  }

  let phase: Phase | undefined;
  let environment: Environment | undefined;
  let commit: string | undefined;
  let execute = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const selected = PHASES[argument];
    if (selected) {
      if (phase) {
        refuse(`only one phase may be selected, got ${phase} and ${selected}`);
      }
      phase = selected;
      continue;
    }
    if (argument === "--execute") {
      execute = true;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      refuse(`${argument} requires a value`);
    }
    index += 1;
    switch (argument) {
      case "--environment": {
        if (!(ENVIRONMENTS as readonly string[]).includes(value)) {
          refuse(`--environment must be one of ${ENVIRONMENTS.join(", ")}`);
        }
        environment = value as Environment;
        break;
      }
      case "--commit":
        commit = value;
        break;
      default:
        refuse(`unknown argument ${argument}`);
    }
  }

  if (!phase) refuse("a phase is required");
  if (!environment) refuse("--environment is required");
  if (commit !== undefined && !COMMIT.test(commit)) {
    refuse("--commit must be a full 40-character commit id");
  }
  if (!isAbsolute(root)) refuse("the repository root must be an absolute path");

  return {
    definition,
    phase,
    environment,
    ...(commit === undefined ? {} : { commit }),
    execute,
    root,
  };
}

/**
 * Does this command change the Pages project?
 *
 * The classification is an allowlist, so an unrecognized command counts as a
 * mutation. Every command a phase issues passes through it, which is what makes
 * "--status never mutates" a property of the code rather than a claim in a
 * document.
 */
export function mutatesTarget(request: CommandRequest): boolean {
  const wrangler = wranglerSubcommand(request);
  if (wrangler) {
    const readOnly = [
      ["pages", "project", "list"],
      ["pages", "deployment", "list"],
      ["pages", "download", "config"],
    ];
    if (
      readOnly.some(
        (prefix) =>
          prefix[0] === wrangler[0] &&
          prefix[1] === wrangler[1] &&
          prefix[2] === wrangler[2],
      )
    ) {
      return false;
    }
    return true;
  }
  if (request.command === "git") {
    return !["rev-parse", "status", "log", "show", "ls-files", "ls-remote"]
      .includes(request.args[0] ?? "");
  }
  // Local-only work: the scoped gate builds this machine's worktree and never
  // reaches the account.
  if (request.command === "bun" && request.args[0] === "run") return false;
  if (request.command === "npm" && request.args[0] === "run") return false;
  return true;
}

function wranglerSubcommand(request: CommandRequest): readonly string[] | null {
  if (request.command === "wrangler") return request.args;
  if (request.command === "bunx" && request.args[0] === "wrangler") {
    return request.args.slice(1);
  }
  return null;
}

export const defaultStaticSiteRuntime: SurfaceRuntime = {
  async run(request) {
    const child = Bun.spawn([request.command, ...request.args], {
      ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { exitCode, stdout, stderr };
  },
  fetch: (url, options) =>
    fetch(url, {
      redirect: options.redirect,
      headers: { "cache-control": "no-cache" },
      signal: AbortSignal.timeout(120_000),
    }),
  sleep: (milliseconds) =>
    new Promise((wake) => setTimeout(wake, milliseconds)),
  env: process.env,
};

type Context = {
  readonly options: StaticSiteOptions;
  readonly runtime: SurfaceRuntime;
  readonly issued: CommandRequest[];
};

async function invoke(
  context: Context,
  request: CommandRequest,
): Promise<CommandResult> {
  if (mutatesTarget(request)) {
    if (context.options.phase === "status") {
      refuse(
        `--status refuses to run ${request.command} ${request.args.join(" ")}: it would mutate the target`,
      );
    }
    if (!context.options.execute) {
      refuse(
        `${request.command} ${request.args.join(" ")} mutates the target and --execute was not passed`,
      );
    }
  }
  context.issued.push(request);
  return await context.runtime.run(request);
}

function wrangler(args: readonly string[]): CommandRequest {
  return { command: "wrangler", args };
}

function digestOf(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseJson(raw: string, label: string): unknown {
  const object = raw.indexOf("{");
  const array = raw.indexOf("[");
  const from =
    object === -1 ? array : array === -1 ? object : Math.min(object, array);
  if (from === -1) refuse(`${label} printed no JSON`, raw.trim());
  try {
    return JSON.parse(raw.slice(from)) as unknown;
  } catch {
    return refuse(`${label} printed unparsable JSON`, raw.trim());
  }
}

/* ----------------------------------------------------------- build output */

export type BuildOutput = Readonly<{
  directory: string;
  files: readonly string[];
  digests: Readonly<Record<string, string>>;
  entryDigest: string;
}>;

async function walk(directory: string): Promise<readonly string[]> {
  const found: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(path)));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

/**
 * Find and characterize the bytes that would be published.
 *
 * The output directory is a build product, so it is discovered rather than
 * declared: the surface refuses when it is absent or when a page it promises to
 * smoke is not in it, and it names the command that produces it. A deploy that
 * uploads a directory it never looked inside cannot answer provenance.
 */
export async function discoverBuildOutput(
  definition: StaticSiteDefinition,
  root: string,
): Promise<BuildOutput> {
  const directory = resolve(root, definition.outputDir);
  let stats;
  try {
    stats = await stat(directory);
  } catch {
    return refuse(
      `${definition.outputDir} does not exist; the build did not produce it. Run \`${definition.buildRemedy}\`.`,
    );
  }
  if (!stats.isDirectory()) {
    refuse(`${definition.outputDir} is not a directory`);
  }

  const absolute = await walk(directory);
  if (absolute.length === 0) {
    refuse(
      `${definition.outputDir} is empty; the build produced nothing to publish. Run \`${definition.buildRemedy}\`.`,
    );
  }
  const files = absolute
    .map((path) => relative(directory, path).replaceAll("\\", "/"))
    .sort();

  const digests: Record<string, string> = {};
  for (const target of definition.smoke) {
    if (!files.includes(target.file)) {
      refuse(
        `${definition.outputDir}/${target.file} is missing, so ${target.path} cannot be proved after publication. Run \`${definition.buildRemedy}\`.`,
      );
    }
    digests[target.file] = digestOf(
      new Uint8Array(await readFile(join(directory, target.file))),
    );
  }

  return {
    directory,
    files,
    digests,
    entryDigest: digests[definition.smoke[0].file],
  };
}

/** Credential shapes in the exact bytes that would become public. */
export async function scanPublishedBytes(
  output: BuildOutput,
): Promise<readonly string[]> {
  const leaks: string[] = [];
  for (const name of output.files) {
    if (CREDENTIAL_FILE.test(name)) {
      leaks.push(`${name}: credential-shaped file`);
      continue;
    }
    if (BINARY_FILE.test(name)) continue;
    let source: string;
    try {
      source = await readFile(join(output.directory, name), "utf8");
    } catch {
      continue;
    }
    for (const shape of CREDENTIAL_SHAPES) {
      if (shape.test(source)) leaks.push(`${name}: matches ${shape}`);
    }
  }
  return leaks;
}

/* ------------------------------------------------------------------ reads */

export type PagesDeployment = Readonly<{
  id: string;
  url: string | null;
  commit: string | null;
  createdOn: string | null;
}>;

function readDeployment(row: unknown): PagesDeployment | null {
  if (typeof row !== "object" || row === null) return null;
  const record = row as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  if (!id) return null;
  const trigger =
    typeof record.deployment_trigger === "object" &&
    record.deployment_trigger !== null
      ? (record.deployment_trigger as Record<string, unknown>)
      : {};
  const metadata =
    typeof trigger.metadata === "object" && trigger.metadata !== null
      ? (trigger.metadata as Record<string, unknown>)
      : {};
  return {
    id,
    url: typeof record.url === "string" ? record.url : null,
    commit:
      typeof metadata.commit_hash === "string" ? metadata.commit_hash : null,
    createdOn:
      typeof record.created_on === "string" ? record.created_on : null,
  };
}

type ProjectState = Readonly<{
  present: boolean;
  production: PagesDeployment | null;
}>;

/**
 * The live production deployment, which is both the drift reference and the
 * revert point. An absent project is not an error here: --status reports it and
 * --apply refuses with the reason, because this surface never creates one.
 */
async function productionDeployment(context: Context): Promise<ProjectState> {
  const { definition } = context.options;
  const result = await invoke(
    context,
    wrangler([
      "pages",
      "deployment",
      "list",
      "--project-name",
      definition.project,
      "--environment",
      "production",
      "--json",
    ]),
  );
  const output = `${result.stdout}${result.stderr}`;
  if (result.exitCode !== 0) {
    if (MISSING_PROJECT.test(output)) return { present: false, production: null };
    refuse("wrangler pages deployment list failed", output.trim());
  }
  const parsed = parseJson(result.stdout, "wrangler pages deployment list");
  const rows = Array.isArray(parsed) ? parsed : [];
  for (const row of rows) {
    const deployment = readDeployment(row);
    if (deployment) return { present: true, production: deployment };
  }
  return { present: true, production: null };
}

export type Probe = Readonly<{
  url: string;
  status: number | null;
  digest: string | null;
  error?: string;
}>;

async function probe(context: Context, url: string): Promise<Probe> {
  try {
    const response = await context.runtime.fetch(url, { redirect: "follow" });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      url,
      status: response.status,
      digest: response.ok ? digestOf(bytes) : null,
    };
  } catch (error) {
    return {
      url,
      status: null,
      digest: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Fetch until the expected bytes appear. Pages propagation is eventual, so a
 * first mismatch is not yet a failure; a persistent one is, and it is reported
 * as a post-condition failure after publication rather than as a retry.
 */
async function waitForDigest(
  context: Context,
  url: string,
  expected: string,
  attempts: number,
): Promise<Probe> {
  let last: Probe = { url, status: null, digest: null, error: "not attempted" };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = await probe(context, url);
    if (last.digest === expected) return last;
    if (attempt < attempts) await context.runtime.sleep(3000 * attempt);
  }
  return last;
}

/* ----------------------------------------------------------------- source */

type SourceIdentity = Readonly<{
  commit: string;
  branch: string;
  subject: string;
  clean: boolean;
}>;

async function sourceIdentity(context: Context): Promise<SourceIdentity> {
  const read = async (args: readonly string[]) => {
    const result = await invoke(context, {
      command: "git",
      args: [...args],
      cwd: context.options.root,
    });
    if (result.exitCode !== 0) {
      refuse(`git ${args.join(" ")} failed`, result.stderr.trim());
    }
    return result.stdout.trim();
  };
  return {
    commit: await read(["rev-parse", "HEAD"]),
    branch: await read(["rev-parse", "--abbrev-ref", "HEAD"]),
    subject: await read(["log", "-1", "--format=%s"]),
    clean: (await read(["status", "--porcelain"])).length === 0,
  };
}

function branchFor(options: StaticSiteOptions): string {
  return options.environment === "production"
    ? options.definition.productionBranch
    : options.environment;
}

/* ---------------------------------------------------------- install ref */

/**
 * The Takos release tag the built site sends a visitor to.
 *
 * `website/src/lib/takos-release.generated.ts` is projected from the package
 * version, so the ref is never a hand-advanced literal. What the projection
 * cannot know is whether that tag has actually been published: a version bump
 * lands before its release, and publishing the site in between ships an
 * install deep link and a self-host runbook naming a ref that resolves
 * nowhere.
 */
async function installRef(context: Context): Promise<string> {
  const generated = await readFile(
    resolve(
      context.options.root,
      "website/src/lib/takos-release.generated.ts",
    ),
    "utf8",
  ).catch(() => null);
  const ref = generated?.match(
    /export const TAKOS_INSTALL_REF = "([^"]+)";/u,
  )?.[1];
  if (ref === undefined) {
    refuse(
      "website/src/lib/takos-release.generated.ts does not declare TAKOS_INSTALL_REF; run bun run generate:website-release-ref",
    );
  }
  return ref;
}

/** `null` when the tag resolves on origin, otherwise the reason it does not. */
async function unresolvedInstallRef(
  context: Context,
  ref: string,
): Promise<string | null> {
  const result = await invoke(context, {
    command: "git",
    args: ["ls-remote", "--tags", "origin", `refs/tags/${ref}`],
    cwd: context.options.root,
  });
  if (result.exitCode !== 0) {
    return `could not ask origin whether ${ref} exists: ${result.stderr.trim()}`;
  }
  if (result.stdout.trim() === "") {
    return `the install ref this build publishes (${ref}) does not exist on origin, so every Install click and the self-host runbook's \`git checkout ${ref}\` would fail. Publish the release first.`;
  }
  return null;
}

/* ----------------------------------------------------------------- phases */

async function statusPhase(context: Context): Promise<Record<string, unknown>> {
  const { definition, environment } = context.options;
  const source = await sourceIdentity(context);
  const project = await productionDeployment(context);

  let output: BuildOutput | null = null;
  let outputError: string | null = null;
  try {
    output = await discoverBuildOutput(definition, context.options.root);
  } catch (error) {
    outputError = error instanceof Error ? error.message : String(error);
  }

  const probes: Probe[] = [];
  for (const target of definition.smoke) {
    probes.push(await probe(context, `${definition.publicUrl}${target.path}`));
  }

  const drift: string[] = [];
  if (!project.present) {
    drift.push(
      `the Cloudflare Pages project ${definition.project} does not exist or the token cannot see it. This surface never creates a project: provisioning and DNS are a separate authority.`,
    );
  } else if (project.production === null) {
    drift.push(
      `${definition.project} has no production deployment yet, so there is no revert point for a first publication`,
    );
  } else if (
    project.production.commit !== null &&
    project.production.commit !== source.commit
  ) {
    drift.push(
      `production serves the build of ${project.production.commit}; HEAD is ${source.commit}`,
    );
  }
  if (outputError !== null) {
    drift.push(`no publishable build output: ${outputError}`);
  }
  if (definition.publishesInstallRef === true) {
    const unresolved = await unresolvedInstallRef(
      context,
      await installRef(context),
    );
    if (unresolved !== null) drift.push(unresolved);
  }
  for (const [index, target] of definition.smoke.entries()) {
    const seen = probes[index];
    if (seen.status !== 200) {
      drift.push(`${seen.url} answered ${seen.status ?? seen.error}`);
      continue;
    }
    const expected = output?.digests[target.file];
    if (expected !== undefined && seen.digest !== expected) {
      drift.push(
        `${seen.url} does not serve the locally built ${target.file}; rebuild and compare before publishing`,
      );
    }
  }

  return {
    kind: "takos.static-site-status@v1",
    surface: definition.surface,
    environment,
    project: definition.project,
    publicUrl: definition.publicUrl,
    branch: branchFor(context.options),
    source,
    projectPresent: project.present,
    productionDeployment: project.production,
    buildOutput:
      output === null
        ? { path: definition.outputDir, present: false, error: outputError }
        : {
            path: definition.outputDir,
            present: true,
            files: output.files.length,
            digests: output.digests,
          },
    smoke: probes,
    drift,
  };
}

async function runScopedGate(context: Context): Promise<readonly string[]> {
  const ran: string[] = [];
  for (const step of context.options.definition.gate) {
    const label = `${step.command} ${step.args.join(" ")}`;
    const result = await invoke(context, {
      command: step.command,
      args: step.args,
      cwd:
        step.cwd === undefined
          ? context.options.root
          : resolve(context.options.root, step.cwd),
    });
    if (result.exitCode !== 0) {
      refuse(
        `the scoped gate step \`${label}\` failed; nothing was uploaded`,
        `${result.stdout}${result.stderr}`.trim(),
      );
    }
    ran.push(label);
  }
  return ran;
}

async function applyPhase(context: Context): Promise<Record<string, unknown>> {
  const { options } = context;
  const { definition, environment } = options;
  const source = await sourceIdentity(context);

  if (environment === "production") {
    if (!source.clean) {
      refuse(
        "production publishes from one commit and the worktree is not clean; commit or stash first",
      );
    }
    if (source.branch !== "main" && options.commit !== source.commit) {
      refuse(
        `production requires clean main or an exact --commit equal to HEAD; HEAD is ${source.commit} on ${source.branch}`,
      );
    }
  }

  const project = await productionDeployment(context);
  if (!project.present) {
    refuse(
      `the Cloudflare Pages project ${definition.project} is not visible to this token. Create the project and attach ${definition.publicUrl} first: provisioning and DNS are a separate authority from this deploy.`,
    );
  }

  if (definition.publishesInstallRef === true) {
    const ref = await installRef(context);
    const unresolved = await unresolvedInstallRef(context, ref);
    if (unresolved !== null) refuse(unresolved);
  }

  const gate = await runScopedGate(context);
  const output = await discoverBuildOutput(definition, options.root);
  const leaks = await scanPublishedBytes(output);
  if (leaks.length > 0) {
    refuse(
      `the built ${definition.outputDir} contains credential material; nothing was uploaded`,
      leaks.join("\n"),
    );
  }

  const previous = project.production;
  const rollback =
    previous === null
      ? `no earlier production deployment exists for ${definition.project}; the forward repair is to publish the previous commit's build`
      : `restore Pages deployment ${previous.id} through Cloudflare's deployment history (dashboard rollback, or POST /accounts/<account>/pages/projects/${definition.project}/deployments/${previous.id}/rollback)`;

  const branch = branchFor(options);
  const plan = {
    kind: "takos.static-site-apply@v1",
    surface: definition.surface,
    environment,
    project: definition.project,
    publicUrl: definition.publicUrl,
    branch,
    commit: source.commit,
    sourceBranch: source.branch,
    clean: source.clean,
    gate,
    output: {
      path: definition.outputDir,
      files: output.files.length,
      digests: output.digests,
    },
    previousDeployment: previous,
    rollback,
  };

  if (!options.execute) {
    return { ...plan, outcome: "planned", mutation: "none" };
  }

  const upload = await invoke(
    context,
    wrangler([
      "pages",
      "deploy",
      output.directory,
      "--project-name",
      definition.project,
      "--branch",
      branch,
      "--commit-hash",
      source.commit,
      "--commit-message",
      source.subject,
      `--commit-dirty=${source.clean ? "false" : "true"}`,
    ]),
  );
  if (upload.exitCode !== 0) {
    throw new StaticSiteDeployError(
      "indeterminate",
      `wrangler pages deploy failed (exit ${upload.exitCode}); the upload may or may not have landed. Read --status before any retry. Reversal: ${rollback}`,
      `${upload.stdout}${upload.stderr}`.trim(),
    );
  }

  const deploymentUrl = immutableDeploymentUrl(
    `${upload.stdout}${upload.stderr}`,
    definition.project,
  );
  if (!deploymentUrl) {
    throw new StaticSiteDeployError(
      "indeterminate",
      `wrangler pages deploy printed no immutable deployment URL, so the result cannot be read back. Read --status before any retry. Reversal: ${rollback}`,
      `${upload.stdout}${upload.stderr}`.trim(),
    );
  }

  const readback = await verifyPostConditions(context, {
    deploymentUrl,
    output,
    rollback,
  });
  return {
    ...plan,
    outcome: "deployed",
    mutation: "wrangler-pages-deploy",
    deploymentUrl,
    readback,
  };
}

/**
 * The immutable deployment URL wrangler just minted.
 *
 * A branch publication prints two URLs that look alike: the per-deployment
 * `https://<8 hex>.<project>.pages.dev` and the moving branch alias
 * `https://<branch>.<project>.pages.dev`. Reading the alias back would prove
 * nothing about the bytes just uploaded, so the hash-shaped one wins whenever
 * it is present.
 */
export function immutableDeploymentUrl(
  output: string,
  project: string,
): string | null {
  const found = [
    ...output.matchAll(
      new RegExp(`https://([0-9a-z-]+)\\.${project}\\.pages\\.dev`, "gu"),
    ),
  ];
  const hashed = found.find((match) => /^[0-9a-f]{8}$/u.test(match[1]));
  return (hashed ?? found[0])?.[0] ?? null;
}

/**
 * The bytes are public now. Everything from here reports as a failure *after*
 * the target was touched, and names the deployment to compare against rather
 * than inviting a blind second upload.
 */
async function verifyPostConditions(
  context: Context,
  input: Readonly<{
    deploymentUrl: string;
    output: BuildOutput;
    rollback: string;
  }>,
): Promise<Record<string, unknown>> {
  const { definition, environment } = context.options;
  const entry = definition.smoke[0];
  const immutable = await waitForDigest(
    context,
    `${input.deploymentUrl}${entry.path}`,
    input.output.entryDigest,
    5,
  );
  const checked: Probe[] = [immutable];
  if (immutable.digest !== input.output.entryDigest) {
    throw new StaticSiteDeployError(
      "post-conditions",
      `the immutable deployment ${immutable.url} does not serve the bytes just built (${immutable.status ?? immutable.error}). The publication happened; compare it against ${input.rollback}`,
    );
  }

  // A preview deployment never moves the public alias, so smoking the public
  // origin there would be reading someone else's bytes.
  if (environment === "production") {
    for (const target of definition.smoke) {
      const expected = input.output.digests[target.file];
      const seen = await waitForDigest(
        context,
        `${definition.publicUrl}${target.path}`,
        expected,
        8,
      );
      checked.push(seen);
      if (seen.digest !== expected) {
        throw new StaticSiteDeployError(
          "post-conditions",
          `${seen.url} answered ${seen.status ?? seen.error} and does not serve the ${target.file} just published. The publication happened; compare it against ${input.rollback}`,
        );
      }
    }
  } else {
    for (const target of definition.smoke.slice(1)) {
      const seen = await waitForDigest(
        context,
        `${input.deploymentUrl}${target.path}`,
        input.output.digests[target.file],
        5,
      );
      checked.push(seen);
      if (seen.digest !== input.output.digests[target.file]) {
        throw new StaticSiteDeployError(
          "post-conditions",
          `${seen.url} answered ${seen.status ?? seen.error} and does not serve the ${target.file} just published. The publication happened; compare it against ${input.rollback}`,
        );
      }
    }
  }

  return {
    verified: checked.map((seen) => ({
      url: seen.url,
      status: seen.status,
      digest: seen.digest,
    })),
    publicAliasChecked: environment === "production",
  };
}

/**
 * The credential is what selects the account, so its absence is a refusal
 * before any command runs rather than a wrangler error halfway through a
 * publication. It is read, never written, echoed, or recorded.
 */
function requireCredential(context: Context): void {
  const token = context.runtime.env.CLOUDFLARE_API_TOKEN;
  if (typeof token !== "string" || token.trim().length === 0) {
    refuse(
      "CLOUDFLARE_API_TOKEN is not set. It selects the Cloudflare account and is read from the environment only; do not put it in the repository. Set CLOUDFLARE_ACCOUNT_ID too when the token reaches more than one account.",
    );
  }
}

async function executePhase(
  context: Context,
): Promise<Record<string, unknown>> {
  requireCredential(context);
  switch (context.options.phase) {
    case "status":
      return await statusPhase(context);
    case "apply":
      return await applyPhase(context);
  }
}

export async function runStaticSite(
  options: StaticSiteOptions,
  runtime: SurfaceRuntime = defaultStaticSiteRuntime,
): Promise<Record<string, unknown>> {
  return (await runStaticSiteRecorded(options, runtime)).report;
}

/** Exposed so tests can assert exactly what a phase issued against the target. */
export async function runStaticSiteRecorded(
  options: StaticSiteOptions,
  runtime: SurfaceRuntime = defaultStaticSiteRuntime,
): Promise<{
  report: Record<string, unknown>;
  issued: readonly CommandRequest[];
}> {
  const context: Context = { options, runtime, issued: [] };
  return { report: await executePhase(context), issued: context.issued };
}
