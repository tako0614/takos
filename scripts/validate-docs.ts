import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseAppManifestYaml } from "../packages/control/src/application/services/source/app-manifest.ts";

type ValidationResult = {
  errors: string[];
  warnings: string[];
};

const REQUIRED_SITE_FILES = [
  "index.md",
  "overview/index.md",
  "get-started/index.md",
  "get-started/your-first-app.md",
  "get-started/project-structure.md",
  "get-started/local-development.md",
  "apps/index.md",
  "apps/manifest.md",
  "apps/workers.md",
  "apps/containers.md",
  "apps/routes.md",
  "apps/environment.md",
  "apps/mcp.md",
  "apps/file-handlers.md",
  "apps/oauth.md",
  "architecture/index.md",
  "architecture/control-plane.md",
  "architecture/tenant-runtime.md",
  "architecture/compatibility.md",
  "platform/index.md",
  "platform/store.md",
  "platform/threads-and-runs.md",
  "platform/spaces.md",
  "platform/billing.md",
  "platform/activitypub.md",
  "platform/resource-governance.md",
  "platform/compatibility.md",
  "deploy/index.md",
  "deploy/store-deploy.md",
  "deploy/namespaces.md",
  "deploy/rollback.md",
  "deploy/troubleshooting.md",
  "hosting/self-hosted.md",
  "hosting/local.md",
  "hosting/cloudflare.md",
  "hosting/aws.md",
  "hosting/gcp.md",
  "hosting/kubernetes.md",
  "hosting/differences.md",
  "examples/index.md",
  "examples/simple-worker.md",
  "examples/worker-with-db.md",
  "examples/worker-with-container.md",
  "examples/mcp-server.md",
  "examples/multi-service.md",
  "reference/index.md",
  "reference/api.md",
  "reference/cli.md",
  "reference/cli-auth.md",
  "reference/manifest-spec.md",
  "reference/glossary.md",
  ".vitepress/config.ts",
  ".vitepress/theme/index.ts",
  ".vitepress/theme/custom.css",
];

const REQUIRED_PAGE_SNIPPETS: Record<string, string[]> = {
  "overview/index.md": [
    "## このページで依存してよい範囲",
    "## このページで依存してはいけない範囲",
  ],
  "reference/api.md": [
    "## 認証",
    "## Route families",
    "## implementation note",
    "## 次に読むページ",
  ],
  "reference/cli-auth.md": [
    "## このページで依存してよい範囲",
    "## このページで依存してはいけない範囲",
    "## implementation note",
    "## 次に読むページ",
  ],
  "reference/cli.md": [
    "## 次に読むページ",
  ],
  "platform/compatibility.md": [
    "## Support matrix",
    "## Tracked templates",
    "## Runtime topology by surface",
  ],
};

const FORBIDDEN_PAGE_SNIPPETS: Record<string, RegExp[]> = {
  "reference/cli-auth.md": [/credentials\.json/],
  "deploy/index.md": [/\/api\/workers\/:id\/deployments/],
  "apps/workers.md": [
    /API 上の `\/api\/workers` は内部的に service を操作します。/,
  ],
  "platform/threads-and-runs.md": [
    /`retrieval_index`\s*\|\s*検索インデックス用テキスト/,
  ],
};

const SKIP_SCAN_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".cache",
  ".wrangler",
  ".tmp",
  "tmp",
  "target",
  "artifacts",
]);

const REQUIRED_ROOT_SCRIPTS = [
  "build:all",
  "test:all",
  "docs:dev",
  "dev:takos",
  "local:up",
  "local:smoke",
];
const REQUIRED_CONTROL_SCRIPTS = [
  "dev:local:web",
  "dev:local:dispatch",
  "dev:local:worker",
  "dev:local:runtime-host",
  "dev:local:executor-host",
  "dev:local:oci-orchestrator",
];
const REQUIRED_WRANGLER_CONFIGS = [
  "wrangler.toml",
  "wrangler.dispatch.toml",
  "wrangler.worker.toml",
  "wrangler.runtime-host.toml",
  "wrangler.executor.toml",
];

const API_ROUTE_IDENTIFIER_TO_FAMILY: Record<string, string> = {
  seedRepositories: "seed-repositories",
  explore: "explore",
  profilesApi: "profiles",
  publicShare: "public-share",
  mcpRoutes: "mcp",
  createEventsRouter: "events",
  setup: "setup",
  me: "me",
  spacesBase: "spaces",
  spacesMembers: "spaces",
  spacesRepos: "spaces",
  spacesStorage: "spaces",
  spacesCommonEnv: "spaces",
  spacesStores: "spaces",
  spacesStoreRegistry: "spaces",
  spacesTools: "spaces",
  shortcuts: "shortcuts",
  shortcutGroupRoutes: "shortcuts",
  services: "services",
  customDomains: "custom-domains",
  resources: "resources",
  threads: "threads",
  runs: "runs",
  createRunSseRouter: "runs",
  search: "search",
  indexRoutes: "index",
  memories: "memories",
  skills: "skills",
  sessions: "sessions",
  git: "git",
  repos: "repos",
  agentTasks: "agent-tasks",
  notifications: "notifications",
  createNotificationSseRouter: "notifications",
  pullRequests: "pull-requests",
  groupDeploymentSnapshots: "group-deployment-snapshots",
  publications: "publications",
  workersSpaceRoutes: "services",
  billingWebhookHandler: "billing",
  billingRoutes: "billing",
  authApi: "auth",
  oauthConsentApi: "oauth",
  groupsRouter: "groups",
};

function isFile(targetPath: string): boolean {
  return existsSync(targetPath) && statSync(targetPath).isFile();
}

function isDirectory(targetPath: string): boolean {
  return existsSync(targetPath) && statSync(targetPath).isDirectory();
}

function resolveTakosRepoRoot(): string {
  const configured = Deno.env.get("TAKOS_REPO_DIR");
  const candidates = [
    configured,
    path.resolve(process.cwd(), ".."),
    process.cwd(),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (
      (
        isFile(path.join(candidate, "package.json")) &&
        isFile(path.join(candidate, "pnpm-workspace.yaml"))
      ) ||
      (
        isFile(path.join(candidate, "deno.json")) &&
        isDirectory(path.join(candidate, "docs")) &&
        isDirectory(path.join(candidate, "apps"))
      )
    ) {
      return candidate;
    }
  }

  throw new Error(
    "Takos repo root not found. Run from takos/ or set TAKOS_REPO_DIR.",
  );
}

function resolveDocsDir(repoRoot: string): string {
  const docsDir = path.join(repoRoot, "docs");
  if (!isDirectory(docsDir)) {
    throw new Error("Takos docs site not found. Expected docs/.");
  }
  return docsDir;
}

function walkFiles(dir: string): string[] {
  if (!isDirectory(dir)) return [];

  const out: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_SCAN_DIRS.has(entry.name)) continue;
      out.push(...walkFiles(full));
      continue;
    }
    if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function stripFencedCodeBlocks(content: string): string {
  return content.replace(/```[\s\S]*?```/g, "");
}

type MarkdownCodeBlock = {
  language: string;
  content: string;
};

function extractMarkdownCodeBlocks(content: string): MarkdownCodeBlock[] {
  return Array.from(content.matchAll(/```([^\n`]*)\n([\s\S]*?)```/g))
    .map((match) => ({
      language: (match[1] ?? "").trim().toLowerCase(),
      content: (match[2] ?? "").trim(),
    }))
    .filter((block) => block.content.length > 0);
}

function resolveDocsLinkPath(
  docsDir: string,
  file: string,
  linkPath: string,
): string | null {
  const base = linkPath.startsWith("/")
    ? path.join(docsDir, linkPath.slice(1))
    : path.resolve(path.dirname(file), linkPath);

  const candidates = [base, `${base}.md`, path.join(base, "index.md")];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function readJsonFile<T>(targetPath: string): T {
  return JSON.parse(readFileSync(targetPath, "utf8")) as T;
}

function readDocsMarker(file: string, marker: string): string | null {
  const content = readFileSync(file, "utf8");
  const regex = new RegExp(`<!--\\s*docs:${marker}\\s+([^>]+?)\\s*-->`);
  const match = content.match(regex);
  return match?.[1]?.trim() ?? null;
}

function parseMarkerList(markerValue: string | null): string[] {
  if (!markerValue) return [];
  return markerValue
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function setDiff(
  expected: string[],
  actual: string[],
): { missing: string[]; extra: string[] } {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  return {
    missing: expected.filter((entry) => !actualSet.has(entry)),
    extra: actual.filter((entry) => !expectedSet.has(entry)),
  };
}

function extractFullManifestCodeBlocks(content: string): string[] {
  const blocks = Array.from(content.matchAll(/```(?:ya?ml)\n([\s\S]*?)```/g))
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean);
  return blocks.filter((block) =>
    /^name:\s/m.test(block) &&
    /^compute:\s/m.test(block) &&
    !block.includes("apiVersion:") &&
    !block.includes("kind:") &&
    !block.includes("metadata:") &&
    !block.includes("spec:")
  );
}

function validateManifestExamples(
  docsDir: string,
  result: ValidationResult,
): void {
  for (const file of walkFiles(docsDir)) {
    if (!file.endsWith(".md")) continue;
    const relativePath = path.relative(docsDir, file);
    const content = readFileSync(file, "utf8");
    const manifests = extractFullManifestCodeBlocks(content);
    for (const [index, manifest] of manifests.entries()) {
      try {
        parseAppManifestYaml(manifest);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push(
          `[docs] invalid manifest example in ${relativePath}#${
            index + 1
          }: ${message}`,
        );
      }
    }
  }
}

function validatePublicContractExamples(
  docsDir: string,
  result: ValidationResult,
): void {
  const publicDocPrefixes = [
    "apps/",
    "deploy/",
    "examples/",
    "get-started/",
    "reference/manifest-spec.md",
  ];

  for (const file of walkFiles(docsDir)) {
    if (!file.endsWith(".md")) continue;
    const relativePath = path.relative(docsDir, file).replace(/\\/g, "/");
    if (
      !publicDocPrefixes.some((prefix) => relativePath.startsWith(prefix))
    ) {
      continue;
    }

    const content = readFileSync(file, "utf8");
    const blocks = extractMarkdownCodeBlocks(content);
    for (const [index, block] of blocks.entries()) {
      const location = `${relativePath}#${index + 1}`;
      if (/@sha256:(?![a-f0-9]{64}\b)/i.test(block.content)) {
        result.errors.push(
          `[docs] short digest example in ${location}: use a full 64-hex @sha256 digest`,
        );
      }
      if (/^(?:apiVersion|kind|metadata|spec):/m.test(block.content)) {
        result.errors.push(
          `[docs] retired envelope fields are not allowed in public contract examples: ${location}`,
        );
      }
      if (/^(?:storage|bindings|common-env):/m.test(block.content)) {
        result.errors.push(
          `[docs] retired manifest fields are not allowed in public contract examples: ${location}`,
        );
      }
      if (/^\s*provider\s*:/m.test(block.content)) {
        result.errors.push(
          `[docs] backend selection fields are not allowed in public manifest examples: ${location}`,
        );
      }
      if (/triggers:\s*[\s\S]*?queues:/m.test(block.content)) {
        result.errors.push(
          `[docs] retired queue triggers are not allowed in public contract examples: ${location}`,
        );
      }
      if (/^\s*capabilities:\s*$/m.test(block.content)) {
        result.errors.push(
          `[docs] retired compute capabilities are not allowed in public contract examples: ${location}`,
        );
      }
    }
  }
}

function validateTerminologyBoundary(
  docsDir: string,
  result: ValidationResult,
): void {
  const publicDocPrefixes = [
    "apps/",
    "deploy/",
    "examples/",
    "get-started/",
    "reference/glossary.md",
    "reference/manifest-spec.md",
  ];
  const retiredTermPatterns = [
    /\bstorage\.[A-Za-z0-9_-]+/,
    /\bstorage:/,
    /\bbindings\b/,
    /\bcommon-env\b/,
    /\bbind:/,
  ];
  const framedLegacyTerms =
    /(legacy|retired|internal|deprecated|current contract|public contract|public manifest contract|current public manifest contract|旧|廃止)/;

  for (const file of walkFiles(docsDir)) {
    if (!file.endsWith(".md")) continue;
    const relativePath = path.relative(docsDir, file).replace(/\\/g, "/");
    if (
      !publicDocPrefixes.some((prefix) => relativePath.startsWith(prefix))
    ) {
      continue;
    }

    const content = stripFencedCodeBlocks(readFileSync(file, "utf8"));
    const lines = content.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (!retiredTermPatterns.some((pattern) => pattern.test(line))) continue;
      const context = [
        lines[index - 1] ?? "",
        line,
        lines[index + 1] ?? "",
      ].join("\n");
      if (framedLegacyTerms.test(context)) continue;
      result.errors.push(
        `[docs] retired terminology must be framed as legacy/internal in public docs: ${relativePath}:${
          index + 1
        }`,
      );
    }
  }
}

function validateDeployRuntimeContractDocs(
  docsDir: string,
  result: ValidationResult,
): void {
  const contractDriftChecks: Array<{
    pattern: RegExp;
    message: string;
    allowContext?: RegExp;
  }> = [
    {
      pattern: /全 group の publish を解決し env に\s*inject/,
      message:
        "publication env injection must be described as explicit consume, not all-group fanout",
    },
    {
      pattern:
        /space 内のすべての publication を解決し、すべての group\s*の env に inject/,
      message:
        "space-wide publication fanout is retired; docs must say explicit consume only",
    },
    {
      pattern: /publication の必須 field は `type` と `path`/,
      message:
        "type/path are required only for route publications; Takos capability grants use publisher/type/spec",
      allowContext: /route publication/,
    },
    {
      pattern: /すべての publication (?:は|が).*URL/,
      message:
        "Takos capability grants do not have route URLs; only route publications expose URL output",
      allowContext: /route publication/,
    },
    {
      pattern: /200\/2xx\/3xx|2xx\/3xx/,
      message:
        "worker readiness docs must use the current 200-only readiness rule",
    },
    {
      pattern: /個別 worker の rollback は deployment history/,
      message:
        "group rollback is group-snapshot only; individual Worker/Container rollback is not current surface",
    },
    {
      pattern:
        /manifest で宣言される publication \/ binding\s*\(`queue`,\s*`analytics-engine`,\s*`workflow`\)/,
      message:
        "queue/analytics/workflow are resource API/runtime binding concerns, not manifest publication/binding fields",
    },
    {
      pattern: /`queue`\s*\(publication \/ binding\)/,
      message:
        "queue must be described as resource API/runtime binding, not publication/binding manifest support",
    },
    {
      pattern: /`workflow`[^\n]*binding 可/,
      message:
        "workflow must be described as resource API/runtime binding, not manifest publication/binding support",
    },
  ];

  for (const file of walkFiles(docsDir)) {
    if (!file.endsWith(".md")) continue;
    const relativePath = path.relative(docsDir, file).replace(/\\/g, "/");
    const content = stripFencedCodeBlocks(readFileSync(file, "utf8"));
    const lines = content.split(/\r?\n/);

    for (const [index, line] of lines.entries()) {
      const context = [
        lines[index - 1] ?? "",
        line,
        lines[index + 1] ?? "",
      ].join("\n");
      for (const check of contractDriftChecks) {
        if (!check.pattern.test(context)) continue;
        if (check.allowContext?.test(context)) continue;
        result.errors.push(
          `[docs] deploy/runtime contract drift in ${relativePath}:${
            index + 1
          }: ${check.message}`,
        );
      }
    }
  }
}

function extractApiFamilies(
  repoRoot: string,
  result: ValidationResult,
): string[] {
  const apiPath = path.join(
    repoRoot,
    "packages",
    "control",
    "src",
    "server",
    "routes",
    "api.ts",
  );
  const source = readFileSync(apiPath, "utf8");
  const routeMatches = source.matchAll(
    /apiRouter\.route\([^,]+,\s*([A-Za-z0-9_]+)(?:\(\))?\)/g,
  );
  const families = new Set<string>();

  for (const match of routeMatches) {
    const identifier = match[1] ?? "";
    const family = API_ROUTE_IDENTIFIER_TO_FAMILY[identifier];
    if (!family) {
      result.warnings.push(
        `[docs] unmapped API route identifier in api.ts: ${identifier}`,
      );
      continue;
    }
    families.add(family);
  }

  if (/registerAppApiRoutes\(apiRouter\)/.test(source)) {
    families.add("apps");
  }

  return sortedUnique(families);
}

function validateRequiredSiteFiles(
  docsDir: string,
  result: ValidationResult,
): void {
  for (const file of REQUIRED_SITE_FILES) {
    const full = path.join(docsDir, file);
    if (!existsSync(full)) {
      result.errors.push(`[docs] required file is missing: ${file}`);
    }
  }
}

function validateDocsInternalLinks(
  docsDir: string,
  result: ValidationResult,
): void {
  const files = walkFiles(docsDir).filter((file) => file.endsWith(".md"));

  for (const file of files) {
    const raw = readFileSync(file, "utf8");
    const content = stripFencedCodeBlocks(raw);
    const targets: string[] = [];

    for (const match of content.matchAll(/\[[^\]]*?\]\(([^)]+)\)/g)) {
      const target = match[1];
      if (target) targets.push(target);
    }

    for (const match of content.matchAll(/^\[[^\]]+\]:\s*(\S+)/gm)) {
      const target = match[1];
      if (target) targets.push(target);
    }

    for (const rawTarget of targets) {
      let target = rawTarget.trim();
      if (target.startsWith("<") && target.endsWith(">")) {
        target = target.slice(1, -1).trim();
      }
      if (/\s/.test(target)) {
        target = target.split(/\s+/)[0] ?? target;
      }
      if (
        target === "" ||
        target === "#" ||
        target.startsWith("#") ||
        target.startsWith("//") ||
        /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)
      ) {
        continue;
      }

      const noQuery = target.split("?")[0] ?? target;
      const linkPath = (noQuery.split("#")[0] ?? noQuery).trim();
      if (linkPath === "") continue;

      const resolved = resolveDocsLinkPath(docsDir, file, linkPath);
      if (!resolved) {
        result.warnings.push(
          `[docs] broken link target in ${
            path.relative(docsDir, file)
          }: ${linkPath}`,
        );
      }
    }
  }
}

function validateDocsScriptRefs(
  repoRoot: string,
  docsDir: string,
  result: ValidationResult,
): void {
  const files = walkFiles(docsDir).filter((file) => file.endsWith(".md"));
  const refPattern =
    /\b(?:apps|packages|scripts)\/[A-Za-z0-9_./-]+\.(?:ts|tsx|js|mjs|cjs|sh|bash|py|sql)\b/g;

  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const refs = new Set(content.match(refPattern) ?? []);
    for (const ref of refs) {
      const full = path.resolve(repoRoot, ref);
      if (!existsSync(full)) {
        result.warnings.push(
          `[docs] script or source reference not found: ${ref} (referenced by ${
            path.relative(docsDir, file)
          })`,
        );
      }
    }
  }
}

function validateSelfContainedDocs(
  docsDir: string,
  result: ValidationResult,
): void {
  const files = walkFiles(docsDir).filter((file) => file.endsWith(".md"));
  const forbiddenLinkPattern =
    /\[[^\]]*?\]\((?:\/)?(?:README\.md|CONTRIBUTING\.md|AGENTS\.md|CLAUDE\.md)(?:#[^)]+)?\)/g;
  const forbiddenRepoPathPattern =
    /\b(?:apps|packages|scripts)\/[A-Za-z0-9_./-]+\.(?:ts|tsx|js|mjs|cjs|md|json|sql|yml|yaml)\b/g;
  const allowlistedRepoPathRefs = new Map<string, Set<string>>([
    ["platform/compatibility.md", new Set(["apps/control/SECRETS.md"])],
  ]);

  for (const file of files) {
    const content = stripFencedCodeBlocks(readFileSync(file, "utf8"));
    const rel = path.relative(docsDir, file);

    if (forbiddenLinkPattern.test(content)) {
      result.errors.push(
        `[docs] primary docs must not depend on README/CONTRIBUTING/AGENTS links: ${rel}`,
      );
    }

    const repoPathMatches = content.match(forbiddenRepoPathPattern) ?? [];
    const allowlist = allowlistedRepoPathRefs.get(rel) ?? new Set<string>();
    for (const match of new Set(repoPathMatches)) {
      if (allowlist.has(match)) continue;
      result.warnings.push(
        `[docs] avoid implementation path reference in primary docs: ${match} (in ${rel})`,
      );
    }
  }
}

function validateRepoDocsPolicy(
  _repoRoot: string,
  _result: ValidationResult,
): void {
  // docs/ now lives at the repository root — no policy violation to check.
}

function validateManifestDocs(
  _repoRoot: string,
  docsDir: string,
  result: ValidationResult,
): void {
  const manifestDoc = path.join(docsDir, "apps", "manifest.md");
  if (!isFile(manifestDoc)) {
    result.errors.push("[docs] apps/manifest.md is missing");
    return;
  }

  const manifestContent = readFileSync(manifestDoc, "utf8");
  const currentManifestExample = [
    "name: sample-app",
    "compute:",
    "  web:",
    "    build:",
    "      fromWorkflow:",
    "        path: .takos/workflows/deploy.yml",
    "        job: bundle",
    "        artifact: web",
    "        artifactPath: dist/worker",
    "routes:",
    "  - target: web",
    "    path: /",
    "publish: []",
    "env: {}",
  ].join("\n");
  try {
    parseAppManifestYaml(currentManifestExample);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(
      `[docs] current flat manifest sample no longer parses: ${message}`,
    );
  }

  for (
    const requiredSnippet of [
      "compute:",
      "publish:",
      "consume:",
      "env:",
      "routes:",
      "build:",
      "fromWorkflow:",
    ]
  ) {
    if (!manifestContent.includes(requiredSnippet)) {
      result.errors.push(
        `[docs] apps/manifest.md must mention current flat contract snippet: ${requiredSnippet}`,
      );
    }
  }

  const manifestSpecDoc = path.join(docsDir, "reference", "manifest-spec.md");
  if (isFile(manifestSpecDoc)) {
    const specContent = readFileSync(manifestSpecDoc, "utf8");
    for (
      const requiredSnippet of [
        "top-level fields",
        "compute",
        "consume",
        "routes",
        "publish",
        "env",
        "build.fromWorkflow.path",
        "readiness",
        "healthCheck",
        "overrides",
      ]
    ) {
      if (!specContent.includes(requiredSnippet)) {
        result.errors.push(
          `[docs] reference/manifest-spec.md must mention current flat contract field: ${requiredSnippet}`,
        );
      }
    }
  }
}

function validateCliDocs(
  _repoRoot: string,
  docsDir: string,
  result: ValidationResult,
): void {
  const cliDoc = path.join(docsDir, "reference", "cli.md");
  if (!isFile(cliDoc)) {
    result.errors.push("[docs] reference/cli.md is missing");
    return;
  }

  const content = readFileSync(cliDoc, "utf8");
  const requiredSnippets = [
    "takos login",
    "takos whoami",
    "takos logout",
    "takos deploy",
    "takos endpoint",
    "/api/services",
  ];
  for (const snippet of requiredSnippets) {
    if (!content.includes(snippet)) {
      result.errors.push(
        `[docs] CLI commands doc is missing current snippet: ${snippet}`,
      );
    }
  }

  for (
    const legacyHeading of [
      "## build / publish / promote",
      "## mcp",
      "## personal-access-token",
    ]
  ) {
    if (content.includes(legacyHeading)) {
      result.errors.push(
        `[docs] stale CLI heading detected in CLI doc: ${legacyHeading}`,
      );
    }
  }

  const cliAuthDoc = path.join(docsDir, "reference", "cli-auth.md");
  if (isFile(cliAuthDoc)) {
    const authContent = readFileSync(cliAuthDoc, "utf8");
    for (const snippet of ["takos login", "task-oriented"]) {
      if (!authContent.includes(snippet)) {
        result.errors.push(
          `[docs] CLI auth doc is missing current snippet: ${snippet}`,
        );
      }
    }
  }
}

function validatePlatformMatrixDoc(
  docsDir: string,
  result: ValidationResult,
): void {
  const matrixDoc = path.join(docsDir, "platform", "compatibility.md");
  if (!isFile(matrixDoc)) {
    result.errors.push("[docs] platform/compatibility.md is missing");
    return;
  }
  const content = readFileSync(matrixDoc, "utf8");

  for (
    const snippet of [
      ".env.local.example",
      "apps/control/.env.example",
      "takos-private/.env.server.example",
      "takos-private/compose.server.yml",
      "takos-private/apps/executor",
      "apps/control/SECRETS.md",
      "apps/control/wrangler*.toml",
      "apps/control/.secrets/<env>",
      "deploy/helm/takos/",
    ]
  ) {
    if (!content.includes(snippet)) {
      result.errors.push(
        `[docs] platform matrix is missing tracked template snippet: ${snippet}`,
      );
    }
  }
}

function validateCompatibilityDocs(
  docsDir: string,
  result: ValidationResult,
): void {
  const compatibilityDoc = path.join(
    docsDir,
    "architecture",
    "compatibility.md",
  );
  if (!isFile(compatibilityDoc)) {
    result.errors.push("[docs] architecture/compatibility.md is missing");
    return;
  }

  const content = readFileSync(compatibilityDoc, "utf8");
  for (
    const snippet of [
      "resource API / runtime binding",
      "route publication",
      "Takos capability grant",
      "backend requirement",
    ]
  ) {
    if (!content.includes(snippet)) {
      result.errors.push(
        `[docs] compatibility doc is missing current resource/runtime wording: ${snippet}`,
      );
    }
  }
}

function validateApiDocs(
  repoRoot: string,
  docsDir: string,
  result: ValidationResult,
): void {
  const apiDoc = path.join(docsDir, "reference", "api.md");
  const actualFamilies = extractApiFamilies(repoRoot, result);
  const markerFamilies = sortedUnique(
    parseMarkerList(readDocsMarker(apiDoc, "api-families")),
  );
  const diff = setDiff(actualFamilies, markerFamilies);
  if (diff.missing.length > 0 || diff.extra.length > 0) {
    result.errors.push(
      `[docs] API family coverage mismatch. missing=${
        diff.missing.join("|") || "-"
      } extra=${diff.extra.join("|") || "-"}`,
    );
  }

  const content = readFileSync(apiDoc, "utf8");
  for (
    const snippet of [
      "/api/spaces/:spaceId/group-deployment-snapshots",
      "/api/runs/:id/sse",
      "/api/notifications/sse",
      "/api/services/:id/custom-domains",
    ]
  ) {
    if (!content.includes(snippet)) {
      result.errors.push(
        `[docs] API reference is missing current path snippet: ${snippet}`,
      );
    }
  }
}

// ── API endpoint drift detection ──────────────────────────────────────────

const ROUTES_REL = "packages/control/src/server/routes";

/** Per-file mount prefix (relative to routes/).  Takes priority over dir-level. */
const ENDPOINT_FILE_MOUNT: Record<string, string> = {
  "me.ts": "/me",
  "setup.ts": "/setup",
  "shortcuts.ts": "/shortcuts",
  "auth-api.ts": "/auth",
  "oauth-consent-api.ts": "/oauth",
  "mcp.ts": "/mcp",
  "events/routes.ts": "/events",
  "publications/routes.ts": "/publications",
  "public-share.ts": "/public",
  "billing/webhook.ts": "/billing/webhook",
  "runs/sse.ts": "/runs",
  "notifications-sse.ts": "/notifications",
};

/** Directory-level mount prefix (first path component → prefix) */
const ENDPOINT_DIR_MOUNT: Record<string, string> = {
  workers: "/services",
  resources: "/resources",
  publications: "/publications",
  spaces: "/spaces",
  explore: "/explore",
  profiles: "/users",
  billing: "/billing",
};

const ENDPOINT_SKIP_DIRS = new Set([
  "activitypub-store",
  "auth",
  "oauth",
]);

const ENDPOINT_SKIP_FILES = new Set([
  "api.ts",
  "route-auth.ts",
  "response-utils.ts",
  "validation-utils.ts",
  "zod-validator.ts",
  "rpc-types.ts",
  "smart-http.ts",
  "well-known.ts",
]);

const ENDPOINT_DUPLICATE_ROUTE_FILES = new Set([
  "agent-tasks/routes.ts",
  "apps/routes.ts",
  "custom-domains/routes.ts",
  "git/routes.ts",
  "mcp/routes.ts",
  "me/routes.ts",
  "memories/routes.ts",
  "notifications/routes.ts",
  "notifications/sse.ts",
  "public-share/routes.ts",
  "search/routes.ts",
  "shortcuts/routes.ts",
  "skills/routes.ts",
  "threads/routes.ts",
]);

const ENDPOINT_SKIP_SUFFIXES = [
  "-queries.ts",
  "-utils.ts",
  "-shared.ts",
  "-mappers.ts",
  "-context.ts",
  "-filters.ts",
];

/** Matches Hono-style endpoint registrations: .get('/path', ...) or .get('/', ...) */
const ENDPOINT_RE = /\.(get|post|put|patch|delete)\s*\(\s*['"](\/[^'"]*)['"]/gi;

/** Matches documented endpoints in markdown table rows */
const DOC_ENDPOINT_RE =
  /^\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|\s*`(\/api\/[^`]+)`/gm;

/**
 * Paths starting with these prefixes are root-mounted and should not have an
 * additional mount prefix applied.  Narrowly scoped to avoid false negatives
 * in directories like explore/ where sub-paths legitimately start with /repos/.
 *
 * Current cases: shortcuts.ts exports both a /shortcuts-mounted router and
 * root-mounted shortcut-group routes whose paths start with /spaces/.
 */
const ABSOLUTE_PATH_SIGNALS = ["/spaces/"];

function resolveEndpointMount(relPath: string): string {
  const norm = relPath.replace(/\\/g, "/");
  if (ENDPOINT_FILE_MOUNT[norm] !== undefined) return ENDPOINT_FILE_MOUNT[norm];
  const topDir = norm.split("/")[0] ?? "";
  return ENDPOINT_DIR_MOUNT[topDir] ?? "";
}

function shouldSkipEndpointFile(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, "/");
  if (ENDPOINT_DUPLICATE_ROUTE_FILES.has(norm)) return true;
  const parts = norm.split("/");
  const fileName = parts[parts.length - 1] ?? "";
  if (ENDPOINT_SKIP_DIRS.has(parts[0] ?? "")) return true;
  if (fileName === "dto.ts") return true;
  if (ENDPOINT_SKIP_FILES.has(fileName)) return true;
  if (ENDPOINT_SKIP_SUFFIXES.some((s) => fileName.endsWith(s))) return true;
  return false;
}

function extractSourceApiEndpoints(repoRoot: string): Set<string> {
  const routesDir = path.join(repoRoot, ROUTES_REL);
  const files = walkFiles(routesDir).filter((f) => f.endsWith(".ts"));
  const endpoints = new Set<string>();

  for (const file of files) {
    const rel = path.relative(routesDir, file).replace(/\\/g, "/");
    if (shouldSkipEndpointFile(rel)) continue;

    const content = readFileSync(file, "utf8");
    const mount = resolveEndpointMount(rel);

    ENDPOINT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ENDPOINT_RE.exec(content)) !== null) {
      const method = (m[1] ?? "").toUpperCase();
      const routePath = m[2] ?? "";

      // If the path looks like a root-scoped route (e.g. shortcut group
      // routes in shortcuts.ts that start with /spaces/), skip the mount prefix.
      const full = rel === "workers/routes.ts" &&
          routePath === "/:spaceId/services"
        ? `/api/spaces${routePath}`
        : mount && ABSOLUTE_PATH_SIGNALS.some((h) => routePath.startsWith(h))
        ? `/api${routePath}`
        : `/api${mount}${routePath}`;
      endpoints.add(`${method} ${full}`);
    }
  }

  return endpoints;
}

function extractDocApiEndpoints(docsDir: string): Set<string> {
  const content = readFileSync(
    path.join(docsDir, "reference", "api.md"),
    "utf8",
  );
  const endpoints = new Set<string>();
  DOC_ENDPOINT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DOC_ENDPOINT_RE.exec(content)) !== null) {
    endpoints.add(`${(m[1] ?? "").toUpperCase()} ${m[2] ?? ""}`);
  }
  return endpoints;
}

/**
 * Normalize an endpoint string for comparison:
 * - Strip trailing slashes
 * - Replace :paramName{regex} and :paramName with :_ for param-agnostic matching
 */
function normalizeEndpointForComparison(endpoint: string): string {
  const idx = endpoint.indexOf(" ");
  const method = endpoint.slice(0, idx);
  let ep = endpoint.slice(idx + 1);
  // Strip trailing slash (keep root path unchanged)
  if (ep.length > 1 && ep.endsWith("/")) ep = ep.slice(0, -1);
  // Normalize param names: :foo{.+} → :_, :foo → :_
  ep = ep.replace(/:[a-zA-Z_][a-zA-Z0-9_]*(?:\{[^}]+\})?/g, ":_");
  return `${method} ${ep}`;
}

function validateApiEndpointCoverage(
  repoRoot: string,
  docsDir: string,
  result: ValidationResult,
): void {
  const source = extractSourceApiEndpoints(repoRoot);
  const docs = extractDocApiEndpoints(docsDir);

  // Build normalized → original maps
  const sourceNorm = new Map<string, string>();
  for (const e of source) {
    const n = normalizeEndpointForComparison(e);
    if (!sourceNorm.has(n)) sourceNorm.set(n, e);
  }

  const docNorm = new Map<string, string>();
  for (const e of docs) {
    const n = normalizeEndpointForComparison(e);
    if (!docNorm.has(n)) docNorm.set(n, e);
  }

  // Known exceptions that the static scanner cannot resolve:
  // - Billing webhook handler is mounted separately from billing routes
  //   but lives in the same source file, so the scanner applies the wrong prefix
  const isKnownException = (e: string) =>
    e === "POST /api/billing/";

  const undocumented = [...sourceNorm.entries()]
    .filter(([n]) => !docNorm.has(n))
    .map(([, original]) => original)
    .filter((e) => !isKnownException(e))
    .sort();
  const stale = [...docNorm.entries()]
    .filter(([n]) => !sourceNorm.has(n))
    .map(([, original]) => original)
    .sort();

  if (undocumented.length > 0) {
    result.errors.push(
      `[docs] ${undocumented.length} undocumented API endpoint(s):\n${
        undocumented.map((e) => `  + ${e}`).join("\n")
      }`,
    );
  }
  if (stale.length > 0) {
    result.warnings.push(
      `[docs] ${stale.length} possibly stale documented endpoint(s):\n${
        stale.map((e) => `  - ${e}`).join("\n")
      }`,
    );
  }
}

function validateSupplementalDocs(
  repoRoot: string,
  result: ValidationResult,
): void {
  const readmePath = path.join(repoRoot, "README.md");
  const controlDir = path.join(repoRoot, "apps", "control");
  const rootConfigPath = isFile(path.join(repoRoot, "deno.json"))
    ? path.join(repoRoot, "deno.json")
    : path.join(repoRoot, "package.json");
  const controlConfigPath = isFile(path.join(controlDir, "deno.json"))
    ? path.join(controlDir, "deno.json")
    : path.join(controlDir, "package.json");
  const envExamplePath = path.join(controlDir, ".env.example");
  const selfHostEnvPath = path.join(controlDir, ".env.self-host.example");
  const secretsPath = path.join(controlDir, "SECRETS.md");
  const rootPackage = readJsonFile<{
    scripts?: Record<string, string>;
    tasks?: Record<string, string>;
  }>(
    rootConfigPath,
  );
  const controlPackage = readJsonFile<{
    scripts?: Record<string, string>;
    tasks?: Record<string, string>;
  }>(
    controlConfigPath,
  );
  const rootCommands = rootPackage.tasks ?? rootPackage.scripts ?? {};
  const controlCommands = controlPackage.tasks ?? controlPackage.scripts ?? {};
  const readme = readFileSync(readmePath, "utf8");
  const selfHostContent = isFile(selfHostEnvPath)
    ? readFileSync(selfHostEnvPath, "utf8")
    : "";
  const envExampleContent = isFile(envExamplePath)
    ? readFileSync(envExamplePath, "utf8")
    : "";
  const secretsContent = readFileSync(secretsPath, "utf8");

  for (const scriptName of REQUIRED_ROOT_SCRIPTS) {
    if (!rootCommands[scriptName]) {
      result.errors.push(
        `[docs] root package is missing required script referenced by docs: ${scriptName}`,
      );
    }
    if (!readme.includes(scriptName)) {
      result.errors.push(
        `[docs] README.md must mention current root script: ${scriptName}`,
      );
    }
  }

  for (const scriptName of REQUIRED_CONTROL_SCRIPTS) {
    if (!controlCommands[scriptName]) {
      result.errors.push(
        `[docs] apps/control package is missing required local-platform script: ${scriptName}`,
      );
    }
    if (selfHostContent && !selfHostContent.includes(scriptName)) {
      result.errors.push(
        `[docs] .env.self-host.example must mention current control script: ${scriptName}`,
      );
    }
  }

  if (selfHostContent.includes("dev:self-host")) {
    result.errors.push(
      "[docs] .env.self-host.example must not reference removed dev:self-host scripts",
    );
  }
  if (/TAKOS_SELF_HOST_/.test(selfHostContent)) {
    result.errors.push(
      "[docs] .env.self-host.example must use current TAKOS_LOCAL_* env contract",
    );
  }

  for (
    const requiredSnippet of [
      "CONTROL_RPC_BASE_URL",
      "PROXY_BASE_URL",
      "WFP_DISPATCH_NAMESPACE",
    ]
  ) {
    if (envExampleContent && !envExampleContent.includes(requiredSnippet)) {
      result.errors.push(
        `[docs] .env.example must mention current deploy variable: ${requiredSnippet}`,
      );
    }
  }

  const wranglerRefs = new Set([
    ...(secretsContent.match(/wrangler(?:\.[a-z-]+)?\.toml/g) ?? []),
    ...(envExampleContent.match(/wrangler(?:\.[a-z-]+)?\.toml/g) ?? []),
  ]);
  for (const configName of REQUIRED_WRANGLER_CONFIGS) {
    if (!wranglerRefs.has(configName)) {
      result.errors.push(
        `[docs] supplemental docs must reference current wrangler template: ${configName}`,
      );
    }
  }
  for (const configName of wranglerRefs) {
    if (!isFile(path.join(controlDir, configName))) {
      result.errors.push(
        `[docs] referenced wrangler config does not exist: apps/control/${configName}`,
      );
    }
  }
}

function validateCurrentTruthFiles(
  _repoRoot: string,
  docsDir: string,
  result: ValidationResult,
): void {
  const manifestPath = path.join(docsDir, "apps", "manifest.md");
  const storePath = path.join(docsDir, "platform", "store.md");
  const oauthPath = path.join(docsDir, "apps", "oauth.md");

  const filesToCheck: Array<[string, string, RegExp[]]> = [];

  if (isFile(manifestPath)) {
    filesToCheck.push([
      "apps/manifest.md",
      readFileSync(manifestPath, "utf8"),
      [/kind:\s+Package/, /kind:\s+Workload/],
    ]);
  }
  if (isFile(storePath)) {
    filesToCheck.push([
      "platform/store.md",
      readFileSync(storePath, "utf8"),
      [/kind:\s+Package/, /kind:\s+Workload/],
    ]);
  }
  if (isFile(oauthPath)) {
    filesToCheck.push([
      "apps/oauth.md",
      readFileSync(oauthPath, "utf8"),
      [/kind:\s+Package/, /client_name:/, /redirect_uris:/],
    ]);
  }

  for (const [label, content, forbiddenPatterns] of filesToCheck) {
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(content)) {
        result.errors.push(
          `[docs] stale contract pattern found in ${label}: ${pattern}`,
        );
      }
    }
  }
}

function validatePrimaryDocsStructure(
  docsDir: string,
  result: ValidationResult,
): void {
  for (
    const [relativePath, snippets] of Object.entries(REQUIRED_PAGE_SNIPPETS)
  ) {
    const targetPath = path.join(docsDir, relativePath);
    if (!isFile(targetPath)) continue;
    const content = readFileSync(targetPath, "utf8");

    for (const snippet of snippets) {
      if (!content.includes(snippet)) {
        result.errors.push(
          `[docs] ${relativePath} must include section/snippet: ${snippet}`,
        );
      }
    }
  }

  for (
    const [relativePath, patterns] of Object.entries(FORBIDDEN_PAGE_SNIPPETS)
  ) {
    const targetPath = path.join(docsDir, relativePath);
    if (!isFile(targetPath)) continue;
    const content = readFileSync(targetPath, "utf8");

    for (const pattern of patterns) {
      if (pattern.test(content)) {
        result.errors.push(
          `[docs] stale snippet found in ${relativePath}: ${pattern}`,
        );
      }
    }
  }
}

function main(): void {
  const repoRoot = resolveTakosRepoRoot();
  const docsDir = resolveDocsDir(repoRoot);
  const result: ValidationResult = { errors: [], warnings: [] };

  validateRequiredSiteFiles(docsDir, result);
  validateDocsInternalLinks(docsDir, result);
  validateDocsScriptRefs(repoRoot, docsDir, result);
  validateSelfContainedDocs(docsDir, result);
  validateRepoDocsPolicy(repoRoot, result);
  validateManifestDocs(repoRoot, docsDir, result);
  validateCliDocs(repoRoot, docsDir, result);
  validateApiDocs(repoRoot, docsDir, result);
  validateApiEndpointCoverage(repoRoot, docsDir, result);
  validatePlatformMatrixDoc(docsDir, result);
  validateCompatibilityDocs(docsDir, result);
  validateSupplementalDocs(repoRoot, result);
  validateCurrentTruthFiles(repoRoot, docsDir, result);
  validatePrimaryDocsStructure(docsDir, result);
  validateManifestExamples(docsDir, result);
  validatePublicContractExamples(docsDir, result);
  validateTerminologyBoundary(docsDir, result);
  validateDeployRuntimeContractDocs(docsDir, result);

  for (const warning of result.warnings) {
    console.warn(warning);
  }

  if (result.errors.length > 0) {
    for (const error of result.errors) {
      console.error(error);
    }
    Deno.exitCode = 1;
    return;
  }

  console.log(
    `[docs] ok: validated ${
      path.relative(repoRoot, docsDir)
    } (${result.warnings.length} warnings)`,
  );
}

main();
