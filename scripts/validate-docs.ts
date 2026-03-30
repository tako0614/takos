import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

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
  "apps/workers.md": [/API 上の `\/api\/workers` は内部的に service を操作します。/],
  "platform/threads-and-runs.md": [/`retrieval_index`\s*\|\s*検索インデックス用テキスト/],
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

const CURRENT_CLI_TOP_LEVEL = ["login", "whoami", "logout", "deploy", "endpoint"];
const REQUIRED_ROOT_SCRIPTS = ["build:all", "test:all", "docs:dev", "dev:takos", "local:up", "local:smoke"];
const REQUIRED_CONTROL_SCRIPTS = [
  "dev:local:web",
  "dev:local:dispatch",
  "dev:local:worker",
  "dev:local:runtime-host",
  "dev:local:executor-host",
  "dev:local:browser-host",
  "dev:local:oci-orchestrator",
];
const REQUIRED_WRANGLER_CONFIGS = [
  "wrangler.toml",
  "wrangler.dispatch.toml",
  "wrangler.worker.toml",
  "wrangler.runtime-host.toml",
  "wrangler.executor.toml",
  "wrangler.browser-host.toml",
];

const API_ROUTE_IDENTIFIER_TO_FAMILY: Record<string, string> = {
  seedRepositories: "seed-repositories",
  explore: "explore",
  profilesApi: "profiles",
  publicShare: "public-share",
  mcpRoutes: "mcp",
  setup: "setup",
  me: "me",
  spacesBase: "spaces",
  spacesMembers: "spaces",
  spacesRepos: "spaces",
  spacesStorage: "spaces",
  spacesCommonEnv: "spaces",
  spacesStores: "spaces",
  spacesStoreRegistry: "spaces",
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
  appDeployments: "app-deployments",
  browserSessions: "browser-sessions",
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
  const configured = process.env.TAKOS_REPO_DIR;
  const candidates = [
    configured,
    path.resolve(process.cwd(), ".."),
    process.cwd(),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (
      isFile(path.join(candidate, "package.json")) &&
      isFile(path.join(candidate, "pnpm-workspace.yaml"))
    ) {
      return candidate;
    }
  }

  throw new Error("Takos repo root not found. Run from takos/ or set TAKOS_REPO_DIR.");
}

function resolveDocsDir(repoRoot: string): string {
  const docsDir = path.join(repoRoot, "apps", "docs-site", "docs");
  if (!isDirectory(docsDir)) {
    throw new Error("Takos docs site not found. Expected apps/docs-site/docs.");
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

function resolveDocsLinkPath(docsDir: string, file: string, linkPath: string): string | null {
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

function setDiff(expected: string[], actual: string[]): { missing: string[]; extra: string[] } {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  return {
    missing: expected.filter((entry) => !actualSet.has(entry)),
    extra: actual.filter((entry) => !expectedSet.has(entry)),
  };
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asRequiredString(value: unknown, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  return value.map((entry, index) => asRequiredString(entry, `${field}[${index}]`));
}

function validateCurrentManifestYaml(raw: string): void {
  const parsed = YAML.parse(raw);
  const record = asRecord(parsed, "manifest");
  if (asRequiredString(record.apiVersion, "apiVersion") !== "takos.dev/v1alpha1") {
    throw new Error("apiVersion must be takos.dev/v1alpha1");
  }
  if (asRequiredString(record.kind, "kind") !== "App") {
    throw new Error("kind must be App");
  }

  const metadata = asRecord(record.metadata, "metadata");
  asRequiredString(metadata.name, "metadata.name");

  const spec = asRecord(record.spec, "spec");
  asRequiredString(spec.version, "spec.version");

  const services = asRecord(spec.services, "spec.services");
  const serviceNames = Object.keys(services);
  if (serviceNames.length === 0) {
    throw new Error("spec.services must contain at least one service");
  }

  for (const [serviceName, serviceValue] of Object.entries(services)) {
    const service = asRecord(serviceValue, `spec.services.${serviceName}`);
    if (asRequiredString(service.type, `spec.services.${serviceName}.type`) !== "worker") {
      throw new Error(`spec.services.${serviceName}.type must be worker`);
    }

    const build = asRecord(service.build, `spec.services.${serviceName}.build`);
    const fromWorkflow = asRecord(
      build.fromWorkflow,
      `spec.services.${serviceName}.build.fromWorkflow`,
    );
    const workflowPath = asRequiredString(
      fromWorkflow.path,
      `spec.services.${serviceName}.build.fromWorkflow.path`,
    );
    if (!workflowPath.startsWith(".takos/workflows/")) {
      throw new Error(
        `spec.services.${serviceName}.build.fromWorkflow.path must be under .takos/workflows/`,
      );
    }
    asRequiredString(fromWorkflow.job, `spec.services.${serviceName}.build.fromWorkflow.job`);
    asRequiredString(fromWorkflow.artifact, `spec.services.${serviceName}.build.fromWorkflow.artifact`);
    asRequiredString(
      fromWorkflow.artifactPath,
      `spec.services.${serviceName}.build.fromWorkflow.artifactPath`,
    );
  }

  const resources = spec.resources ? asRecord(spec.resources, "spec.resources") : {};
  const resourceEntries = Object.entries(resources).map(([resourceName, resourceValue]) => [
    resourceName,
    asRecord(resourceValue, `spec.resources.${resourceName}`),
  ] as const);
  const resourceMap = new Map(resourceEntries);
  const allowedTypes = new Set([
    "d1",
    "r2",
    "kv",
    "secretRef",
    "vectorize",
    "queue",
    "analyticsEngine",
    "workflow",
    "durableObject",
  ]);

  for (const [resourceName, resource] of resourceEntries) {
    const type = asRequiredString(resource.type, `spec.resources.${resourceName}.type`);
    if (!allowedTypes.has(type)) {
      throw new Error(`unsupported resource type: ${type}`);
    }
    if (type === "queue") {
      const queue = resource.queue ? asRecord(resource.queue, `spec.resources.${resourceName}.queue`) : {};
      const deadLetterQueue = queue.deadLetterQueue == null
        ? ""
        : asRequiredString(queue.deadLetterQueue, `spec.resources.${resourceName}.queue.deadLetterQueue`);
      if (deadLetterQueue) {
        const target = resourceMap.get(deadLetterQueue);
        if (!target || target.type !== "queue") {
          throw new Error(
            `spec.resources.${resourceName}.queue.deadLetterQueue must reference a queue resource`,
          );
        }
      }
    }
    if (type === "workflow") {
      const workflow = asRecord(resource.workflow, `spec.resources.${resourceName}.workflow`);
      const workflowService = asRequiredString(
        workflow.service,
        `spec.resources.${resourceName}.workflow.service`,
      );
      if (!services[workflowService]) {
        throw new Error(
          `spec.resources.${resourceName}.workflow.service references unknown service: ${workflowService}`,
        );
      }
      asRequiredString(workflow.export, `spec.resources.${resourceName}.workflow.export`);
    }
  }

  const bindingTypeMap: Array<[keyof Record<string, unknown>, string]> = [
    ["d1", "d1"],
    ["r2", "r2"],
    ["kv", "kv"],
    ["vectorize", "vectorize"],
    ["queues", "queue"],
    ["analytics", "analyticsEngine"],
    ["workflows", "workflow"],
    ["durableObjects", "durableObject"],
  ];
  for (const [serviceName, serviceValue] of Object.entries(services)) {
    const service = asRecord(serviceValue, `spec.services.${serviceName}`);
    const bindings = service.bindings ? asRecord(service.bindings, `spec.services.${serviceName}.bindings`) : {};
    for (const [bindingKey, expectedType] of bindingTypeMap) {
      if (bindings[bindingKey] == null) continue;
      for (const resourceName of asStringArray(bindings[bindingKey], `spec.services.${serviceName}.bindings.${bindingKey}`)) {
        const target = resourceMap.get(resourceName);
        if (!target || target.type !== expectedType) {
          throw new Error(
            `spec.services.${serviceName}.bindings.${bindingKey} references unknown ${expectedType} resource: ${resourceName}`,
          );
        }
      }
    }

    const triggers = service.triggers ? asRecord(service.triggers, `spec.services.${serviceName}.triggers`) : {};
    if (triggers.queues != null) {
      for (const trigger of triggers.queues as unknown[]) {
        const triggerRecord = asRecord(trigger, `spec.services.${serviceName}.triggers.queues[]`);
        const queueName = asRequiredString(triggerRecord.queue, `spec.services.${serviceName}.triggers.queues[].queue`);
        const queueResource = resourceMap.get(queueName);
        if (!queueResource || queueResource.type !== "queue") {
          throw new Error(
            `spec.services.${serviceName}.triggers.queues references unknown queue resource: ${queueName}`,
          );
        }
        asRequiredString(triggerRecord.export, `spec.services.${serviceName}.triggers.queues[].export`);
      }
    }
  }

  if (spec.routes != null) {
    if (!Array.isArray(spec.routes)) {
      throw new Error("spec.routes must be an array");
    }
    for (const [index, routeEntry] of spec.routes.entries()) {
      const route = asRecord(routeEntry, `spec.routes[${index}]`);
      const routeService = asRequiredString(route.service, `spec.routes[${index}].service`);
      if (!services[routeService]) {
        throw new Error(`spec.routes[${index}].service references unknown service: ${routeService}`);
      }
      if (route.ingress != null) {
        const ingress = asRequiredString(route.ingress, `spec.routes[${index}].ingress`);
        if (!services[ingress]) {
          throw new Error(`spec.routes[${index}].ingress references unknown service: ${ingress}`);
        }
      }
    }
  }

  if (spec.mcpServers != null) {
    if (!Array.isArray(spec.mcpServers)) {
      throw new Error("spec.mcpServers must be an array");
    }
    for (const [index, serverEntry] of spec.mcpServers.entries()) {
      const server = asRecord(serverEntry, `spec.mcpServers[${index}]`);
      asRequiredString(server.name, `spec.mcpServers[${index}].name`);
      const endpoint = String(server.endpoint ?? "").trim();
      const route = String(server.route ?? "").trim();
      if (!endpoint && !route) {
        throw new Error(`spec.mcpServers[${index}].endpoint or route is required`);
      }
    }
  }

  if (spec.fileHandlers != null) {
    if (!Array.isArray(spec.fileHandlers)) {
      throw new Error("spec.fileHandlers must be an array");
    }
    for (const [index, handlerEntry] of spec.fileHandlers.entries()) {
      const handler = asRecord(handlerEntry, `spec.fileHandlers[${index}]`);
      asRequiredString(handler.name, `spec.fileHandlers[${index}].name`);
      asRequiredString(handler.openPath, `spec.fileHandlers[${index}].openPath`);
    }
  }
}

function extractCliDomains(repoRoot: string): string[] {
  const cliPath = path.join(repoRoot, "apps", "cli", "src", "commands", "api.ts");
  const source = readFileSync(cliPath, "utf8");
  const listStart = source.indexOf("const TASK_DOMAIN_DEFINITIONS");
  const listEnd = source.indexOf("const MERGED_DOMAIN_REDIRECTS");
  const domainBlock =
    listStart >= 0 && listEnd > listStart
      ? source.slice(listStart, listEnd)
      : source;
  const matches = domainBlock.matchAll(/\{\s*name:\s*'([^']+)'/g);
  return sortedUnique([...matches].map((match) => match[1] ?? ""));
}

function extractApiFamilies(repoRoot: string, result: ValidationResult): string[] {
  const apiPath = path.join(repoRoot, "packages", "control", "src", "server", "routes", "api.ts");
  const source = readFileSync(apiPath, "utf8");
  const routeMatches = source.matchAll(/apiRouter\.route\([^,]+,\s*([A-Za-z0-9_]+)(?:\(\))?\)/g);
  const families = new Set<string>();

  for (const match of routeMatches) {
    const identifier = match[1] ?? "";
    const family = API_ROUTE_IDENTIFIER_TO_FAMILY[identifier];
    if (!family) {
      result.warnings.push(`[docs] unmapped API route identifier in api.ts: ${identifier}`);
      continue;
    }
    families.add(family);
  }

  if (/registerAppApiRoutes\(apiRouter\)/.test(source)) {
    families.add("apps");
  }

  return sortedUnique(families);
}

function validateRequiredSiteFiles(docsDir: string, result: ValidationResult): void {
  for (const file of REQUIRED_SITE_FILES) {
    const full = path.join(docsDir, file);
    if (!existsSync(full)) {
      result.errors.push(`[docs] required file is missing: ${file}`);
    }
  }
}

function validateDocsInternalLinks(docsDir: string, result: ValidationResult): void {
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
          `[docs] broken link target in ${path.relative(docsDir, file)}: ${linkPath}`,
        );
      }
    }
  }
}

function validateDocsScriptRefs(repoRoot: string, docsDir: string, result: ValidationResult): void {
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
          `[docs] script or source reference not found: ${ref} (referenced by ${path.relative(docsDir, file)})`,
        );
      }
    }
  }
}

function validateSelfContainedDocs(docsDir: string, result: ValidationResult): void {
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

function validateRepoDocsPolicy(repoRoot: string, result: ValidationResult): void {
  const disallowed = path.join(repoRoot, "docs");
  if (isDirectory(disallowed)) {
    result.errors.push("[docs] repository-root docs/ is not allowed. Use apps/docs-site/docs.");
  }
}

function validateManifestDocs(repoRoot: string, docsDir: string, result: ValidationResult): void {
  const manifestDoc = path.join(docsDir, "apps", "manifest.md");
  if (!isFile(manifestDoc)) {
    result.errors.push("[docs] apps/manifest.md is missing");
    return;
  }

  const manifestContent = readFileSync(manifestDoc, "utf8");
  for (const requiredSnippet of ["kind: App", "build:", "fromWorkflow", "spec:"]) {
    if (!manifestContent.includes(requiredSnippet)) {
      result.errors.push(`[docs] apps/manifest.md must mention current contract snippet: ${requiredSnippet}`);
    }
  }

  const manifestSpecDoc = path.join(docsDir, "reference", "manifest-spec.md");
  if (isFile(manifestSpecDoc)) {
    const specContent = readFileSync(manifestSpecDoc, "utf8");
    for (const requiredSnippet of ["apiVersion", "kind", "metadata", "spec"]) {
      if (!specContent.includes(requiredSnippet)) {
        result.errors.push(`[docs] reference/manifest-spec.md must mention field: ${requiredSnippet}`);
      }
    }
  }
}

function validateCliDocs(repoRoot: string, docsDir: string, result: ValidationResult): void {
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
      result.errors.push(`[docs] CLI commands doc is missing current snippet: ${snippet}`);
    }
  }

  for (const legacyHeading of ["## build / publish / promote", "## mcp", "## personal-access-token"]) {
    if (content.includes(legacyHeading)) {
      result.errors.push(`[docs] stale CLI heading detected in CLI doc: ${legacyHeading}`);
    }
  }

  const cliAuthDoc = path.join(docsDir, "reference", "cli-auth.md");
  if (isFile(cliAuthDoc)) {
    const authContent = readFileSync(cliAuthDoc, "utf8");
    for (const snippet of ["takos login", "task-oriented"]) {
      if (!authContent.includes(snippet)) {
        result.errors.push(`[docs] CLI auth doc is missing current snippet: ${snippet}`);
      }
    }
  }
}

function validatePlatformMatrixDoc(docsDir: string, result: ValidationResult): void {
  const matrixDoc = path.join(docsDir, "platform", "compatibility.md");
  if (!isFile(matrixDoc)) {
    result.errors.push("[docs] platform/compatibility.md is missing");
    return;
  }
  const content = readFileSync(matrixDoc, "utf8");

  for (const snippet of [
    ".env.local.example",
    "apps/control/.env.example",
    "apps/control/.env.self-host.example",
    "apps/control/SECRETS.md",
    "apps/control/wrangler*.toml",
    "deploy/helm/takos/",
  ]) {
    if (!content.includes(snippet)) {
      result.errors.push(`[docs] platform matrix is missing tracked template snippet: ${snippet}`);
    }
  }

  const selfHostTemplateCount = (content.match(/apps\/control\/\.env\.self-host\.example/g) ?? []).length;
  if (selfHostTemplateCount !== 1) {
    result.errors.push(
      `[docs] platform matrix must mention apps/control/.env.self-host.example exactly once (found ${selfHostTemplateCount})`,
    );
  }

  if (content.includes("secret 管理コマンド")) {
    result.errors.push("[docs] platform matrix must reference a tracked file, not a vague secret command entry");
  }
}

function validateApiDocs(repoRoot: string, docsDir: string, result: ValidationResult): void {
  const apiDoc = path.join(docsDir, "reference", "api.md");
  const actualFamilies = extractApiFamilies(repoRoot, result);
  const markerFamilies = sortedUnique(parseMarkerList(readDocsMarker(apiDoc, "api-families")));
  const diff = setDiff(actualFamilies, markerFamilies);
  if (diff.missing.length > 0 || diff.extra.length > 0) {
    result.errors.push(
      `[docs] API family coverage mismatch. missing=${diff.missing.join("|") || "-"} extra=${diff.extra.join("|") || "-"}`,
    );
  }

  const content = readFileSync(apiDoc, "utf8");
  for (const snippet of [
    "/api/spaces/:spaceId/app-deployments",
    "/api/runs/:id/sse",
    "/api/notifications/sse",
    "/api/spaces/:spaceId/common-env",
    "/api/services/:id/custom-domains",
  ]) {
    if (!content.includes(snippet)) {
      result.errors.push(`[docs] API reference is missing current path snippet: ${snippet}`);
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
  "public-share.ts": "/public",
  "runs/sse.ts": "/runs",
  "notifications-sse.ts": "/notifications",
};

/** Directory-level mount prefix (first path component → prefix) */
const ENDPOINT_DIR_MOUNT: Record<string, string> = {
  workers: "/services",
  resources: "/resources",
  spaces: "/spaces",
  explore: "/explore",
  profiles: "/users",
  billing: "/billing",
};

const ENDPOINT_SKIP_DIRS = new Set(["activitypub-store", "auth", "oauth"]);

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
const DOC_ENDPOINT_RE = /^\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|\s*`(\/api\/[^`]+)`/gm;

/**
 * Paths starting with these prefixes are root-mounted and should not have an
 * additional mount prefix applied.  Narrowly scoped to avoid false negatives
 * in directories like explore/ where sub-paths legitimately start with /repos/.
 *
 * Current cases: shortcuts.ts exports both a /shortcuts-mounted router and
 * root-mounted shortcut-group routes whose paths start with /spaces/.
 */
const ABSOLUTE_PATH_SIGNALS = ["/spaces/", "/workspaces/"];

function resolveEndpointMount(relPath: string): string {
  const norm = relPath.replace(/\\/g, "/");
  if (ENDPOINT_FILE_MOUNT[norm] !== undefined) return ENDPOINT_FILE_MOUNT[norm];
  const topDir = norm.split("/")[0] ?? "";
  return ENDPOINT_DIR_MOUNT[topDir] ?? "";
}

function shouldSkipEndpointFile(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, "/");
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
      const full =
        mount && ABSOLUTE_PATH_SIGNALS.some((h) => routePath.startsWith(h))
          ? `/api${routePath}`
          : `/api${mount}${routePath}`;
      endpoints.add(`${method} ${full}`);

      // /workspaces/:id is an alias for /spaces/:id — add both
      if (full.includes("/workspaces/")) {
        endpoints.add(`${method} ${full.replace("/workspaces/", "/spaces/")}`);
      }
    }
  }

  return endpoints;
}

function extractDocApiEndpoints(docsDir: string): Set<string> {
  const content = readFileSync(path.join(docsDir, "reference", "api.md"), "utf8");
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
  // - /workspaces/ is a documented alias of /spaces/ (only /spaces/ in tables)
  // - Billing webhook handler is mounted separately from billing routes
  //   but lives in the same source file, so the scanner applies the wrong prefix
  const isKnownException = (e: string) =>
    e.includes("/workspaces/") || e === "POST /api/billing/";

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
      `[docs] ${undocumented.length} undocumented API endpoint(s):\n${undocumented.map((e) => `  + ${e}`).join("\n")}`,
    );
  }
  if (stale.length > 0) {
    result.warnings.push(
      `[docs] ${stale.length} possibly stale documented endpoint(s):\n${stale.map((e) => `  - ${e}`).join("\n")}`,
    );
  }
}

function validateSupplementalDocs(repoRoot: string, result: ValidationResult): void {
  const readmePath = path.join(repoRoot, "README.md");
  const controlDir = path.join(repoRoot, "apps", "control");
  const controlPackagePath = path.join(controlDir, "package.json");
  const envExamplePath = path.join(controlDir, ".env.example");
  const selfHostEnvPath = path.join(controlDir, ".env.self-host.example");
  const secretsPath = path.join(controlDir, "SECRETS.md");
  const rootPackage = readJsonFile<{ scripts?: Record<string, string> }>(path.join(repoRoot, "package.json"));
  const controlPackage = readJsonFile<{ scripts?: Record<string, string> }>(controlPackagePath);
  const readme = readFileSync(readmePath, "utf8");
  const selfHostContent = readFileSync(selfHostEnvPath, "utf8");
  const envExampleContent = readFileSync(envExamplePath, "utf8");
  const secretsContent = readFileSync(secretsPath, "utf8");

  for (const scriptName of REQUIRED_ROOT_SCRIPTS) {
    if (!rootPackage.scripts?.[scriptName]) {
      result.errors.push(`[docs] root package is missing required script referenced by docs: ${scriptName}`);
    }
    if (!readme.includes(scriptName)) {
      result.errors.push(`[docs] README.md must mention current root script: ${scriptName}`);
    }
  }

  for (const scriptName of REQUIRED_CONTROL_SCRIPTS) {
    if (!controlPackage.scripts?.[scriptName]) {
      result.errors.push(`[docs] apps/control package is missing required local-platform script: ${scriptName}`);
    }
    if (!selfHostContent.includes(scriptName)) {
      result.errors.push(`[docs] .env.self-host.example must mention current control script: ${scriptName}`);
    }
  }

  if (selfHostContent.includes("dev:self-host")) {
    result.errors.push("[docs] .env.self-host.example must not reference removed dev:self-host scripts");
  }
  if (/TAKOS_SELF_HOST_/.test(selfHostContent)) {
    result.errors.push("[docs] .env.self-host.example must use current TAKOS_LOCAL_* env contract");
  }

  for (const requiredSnippet of ["CONTROL_RPC_BASE_URL", "PROXY_BASE_URL", "WFP_DISPATCH_NAMESPACE"]) {
    if (!envExampleContent.includes(requiredSnippet)) {
      result.errors.push(`[docs] .env.example must mention current deploy variable: ${requiredSnippet}`);
    }
  }

  const wranglerRefs = new Set([
    ...(secretsContent.match(/wrangler(?:\.[a-z-]+)?\.toml/g) ?? []),
    ...(envExampleContent.match(/wrangler(?:\.[a-z-]+)?\.toml/g) ?? []),
  ]);
  for (const configName of REQUIRED_WRANGLER_CONFIGS) {
    if (!wranglerRefs.has(configName)) {
      result.errors.push(`[docs] supplemental docs must reference current wrangler template: ${configName}`);
    }
  }
  for (const configName of wranglerRefs) {
    if (!isFile(path.join(controlDir, configName))) {
      result.errors.push(`[docs] referenced wrangler config does not exist: apps/control/${configName}`);
    }
  }
}

function validateCurrentTruthFiles(repoRoot: string, docsDir: string, result: ValidationResult): void {
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
        result.errors.push(`[docs] stale contract pattern found in ${label}: ${pattern}`);
      }
    }
  }
}

function validatePrimaryDocsStructure(docsDir: string, result: ValidationResult): void {
  for (const [relativePath, snippets] of Object.entries(REQUIRED_PAGE_SNIPPETS)) {
    const targetPath = path.join(docsDir, relativePath);
    if (!isFile(targetPath)) continue;
    const content = readFileSync(targetPath, "utf8");

    for (const snippet of snippets) {
      if (!content.includes(snippet)) {
        result.errors.push(`[docs] ${relativePath} must include section/snippet: ${snippet}`);
      }
    }
  }

  for (const [relativePath, patterns] of Object.entries(FORBIDDEN_PAGE_SNIPPETS)) {
    const targetPath = path.join(docsDir, relativePath);
    if (!isFile(targetPath)) continue;
    const content = readFileSync(targetPath, "utf8");

    for (const pattern of patterns) {
      if (pattern.test(content)) {
        result.errors.push(`[docs] stale snippet found in ${relativePath}: ${pattern}`);
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
  validateSupplementalDocs(repoRoot, result);
  validateCurrentTruthFiles(repoRoot, docsDir, result);
  validatePrimaryDocsStructure(docsDir, result);

  for (const warning of result.warnings) {
    console.warn(warning);
  }

  if (result.errors.length > 0) {
    for (const error of result.errors) {
      console.error(error);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `[docs] ok: validated ${path.relative(repoRoot, docsDir)} (${result.warnings.length} warnings)`,
  );
}

main();
