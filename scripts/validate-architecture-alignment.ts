import * as runtime from "./runtime.ts";
import { validateTestInventory } from "./test-inventory.ts";

type CheckFailure = {
  path: string;
  message: string;
};

const TAKOS_BOUNDARY_PATH = "deploy/TAKOSUMI_DEPLOY.md";
const TEST_QUARANTINE_PATH = "quality/test-quarantine.json";
const TEST_ONLINE_PATH = "quality/test-online.json";
const ONLINE_TEST_PATH =
  "scripts/__tests__/takoserver-fetch-tracer.online.test.ts";

const REQUIRED_DOCS = [
  "README.md",
  "docs/contributing/current-state.md",
  TAKOS_BOUNDARY_PATH,
] as const;

const RETIRED_PATHS = [
  "scripts/build-release-manifest.ts",
  "scripts/release-gate.ts",
  "scripts/validate-featured-app-opentofu.ts",
  "src/worker/server/routes/__tests__/apps-source-proof.test.ts",
  "src/worker/runtime/queues/deploy-jobs.ts",
  "src/worker/runtime/queues/deployment-runner.ts",
  "src/worker/server/routes/custom-domains.ts",
  "src/worker/server/routes/groups.ts",
  "src/worker/server/routes/rpc-types.ts",
  "src/worker/application/services/platform/custom-domains.ts",
  "src/worker/application/services/platform/desired-state-types.ts",
  "src/worker/application/services/platform/env-state-resolution.ts",
  "src/worker/application/services/platform/resource-bindings.ts",
  "src/worker/application/services/platform/rollout-health.ts",
  "src/worker/application/services/platform/rollout.ts",
  "src/worker/application/services/platform/runtime-config.ts",
  "src/worker/application/services/platform/runtime-projection-exports.ts",
  "src/worker/application/services/platform/service-publications.ts",
  "src/worker/application/services/platform/worker-desired-state.ts",
  "src/worker/application/services/platform/workers.ts",
  "src/worker/application/services/source/app-interface-contract.ts",
  "src/worker/application/services/source/app-manifest.ts",
  "src/worker/shared/types/services-resources.ts",
  "web/src/hooks/useResourceBindings.ts",
  "web/src/hooks/useResourceConnectionInfo.ts",
  "web/src/hooks/useResourceExplorer.ts",
  "web/src/hooks/useSpaceResources.ts",
  "web/src/hooks/useSpaceWorkers.ts",
  "web/src/hooks/useWorkerSettings.ts",
  "web/src/i18n/en/deploy.ts",
  "web/src/i18n/ja/deploy.ts",
  "web/src/types/group.ts",
  "web/src/types/worker.ts",
  "web/src/views/app/space/DeployPanel.tsx",
  "web/src/hooks/useReposData.ts",
  "scripts/generate-takoform-schema-bundle.ts",
  "scripts/takoform-schema-bundle.test.ts",
] as const;

const RETIRED_DIRS = [
  "scripts/control",
  "src/worker/application/services/cloudflare",
  "src/worker/application/services/common-env",
  "src/worker/application/services/deployment",
  "src/worker/application/services/entities",
  "src/worker/application/services/resources",
  "src/worker/application/services/platform/custom-domains",
  "src/worker/application/services/source/app-manifest-parser",
  "src/worker/server/routes/custom-domains",
  "src/worker/server/routes/groups",
  "src/worker/server/routes/resources",
  "src/worker/server/routes/workers",
  "web/src/views/workers",
  "web/src/views/repos",
  "deploy/opentofu/takoform",
  "deploy/distribution-contract",
] as const;

const PACKAGE_FORBIDDEN_MARKERS = [
  '"docs:deploy"',
  '"release-gate"',
  '"release-manifest:check-clean"',
  '"release-manifest:check-artifacts"',
  '"install-config:generate"',
  '"deploy:service"',
  '"deploy:takosumi-release"',
  '"deploy:render-wrangler"',
  '"selfhost:bootstrap"',
  "scripts/control/",
] as const;

const CURRENT_SOURCE_RULES = [
  {
    path: "src/worker/application/services/maintenance/index.ts",
    forbidden: ["Cloudflare", "D1Backup", "runD1Backup"],
  },
  {
    path: "src/worker/server/routes/api.ts",
    forbidden: [
      'from "./workers/index.ts"',
      'from "./resources/index.ts"',
      'from "./custom-domains.ts"',
      'from "./groups.ts"',
      'apiRouter.route("/services"',
      'apiRouter.route("/resources"',
    ],
  },
  {
    path: "src/worker/server/routes/spaces/routes.ts",
    forbidden: ["/api/resources/", "resourceAccess", "resources,"],
  },
  {
    path: "src/worker/runtime/worker/runtime-factory.ts",
    forbidden: [
      "deployment_jobs",
      "deployment-runner.ts",
      "application/services/deployment/",
    ],
  },
  {
    path: "src/worker/runtime/queues/queue-names.ts",
    forbidden: ["deployment_jobs", "deployment-jobs"],
  },
  {
    path: "src/worker/node-platform/env-builder.ts",
    forbidden: ["DEPLOY_QUEUE", 'resolveQueue("DEPLOY"'],
  },
  {
    path: "src/worker/application/tools/mcp-tools.ts",
    forbidden: [
      "service-publications",
      'sourceType === "publication"',
      'sourceType: "publication"',
    ],
  },
  {
    path: "src/worker/server/routes/__tests__/apps-interface-launcher-proof.test.ts",
    forbidden: [
      "service_exports",
      "service_bindings",
      "runtime_projection",
      "publication_name",
      "app_deployments",
    ],
  },
  {
    path: "web/src/app-route-schema.ts",
    forbidden: [
      'componentKey: "deploy"',
      '"/deploy"',
      '"/resources"',
      '"/workers"',
      '"/deployments"',
      '"/services"',
    ],
  },
  {
    path: "web/src/components/layout/AuthenticatedLayout.tsx",
    forbidden: ['view: "deploy"', "onNavigateDeploy", "onNavigateSpaceDeploy"],
  },
] as const;

const DISTRIBUTION_FORBIDDEN_MARKERS = [
  "DEPLOY_QUEUE",
  "deployment-jobs",
  "ROLLOUT_HEALTH_KV",
  "rollout_health",
] as const;

async function pathExists(path: string): Promise<boolean> {
  try {
    await runtime.stat(path);
    return true;
  } catch (error) {
    if (error instanceof runtime.errors.NotFound) return false;
    throw error;
  }
}

async function readRequired(
  path: string,
  failures: CheckFailure[],
): Promise<string> {
  try {
    return await runtime.readTextFile(path);
  } catch (error) {
    failures.push({
      path,
      message: `Unable to read canonical file: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
    return "";
  }
}

function lineNumberAt(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function requireTerms(
  path: string,
  text: string,
  terms: readonly string[],
  failures: CheckFailure[],
): void {
  for (const term of terms) {
    if (text.includes(term)) continue;
    failures.push({
      path,
      message: `Expected current architecture contract to include "${term}".`,
    });
  }
}

function rejectMarkers(
  path: string,
  text: string,
  markers: readonly string[],
  failures: CheckFailure[],
): void {
  for (const marker of markers) {
    const index = text.indexOf(marker);
    if (index < 0) continue;
    failures.push({
      path: `${path}:${lineNumberAt(text, index)}`,
      message: `Retired Takos-local lifecycle marker remains: ${marker}`,
    });
  }
}

async function validateRetiredPaths(failures: CheckFailure[]): Promise<void> {
  for (const path of [...RETIRED_PATHS, ...RETIRED_DIRS]) {
    if (!(await pathExists(path))) continue;
    failures.push({
      path,
      message: "Retired Takos-local lifecycle path must remain absent.",
    });
  }
}

async function trackedTestFiles(failures: CheckFailure[]): Promise<string[]> {
  const listed = await runtime.runCommand("git", { args: ["ls-files", "-z"] });
  if (!listed.success) {
    failures.push({
      path: ".git",
      message: "Unable to list tracked files for test inventory validation.",
    });
    return [];
  }
  return new TextDecoder()
    .decode(listed.stdout)
    .split("\0")
    .filter((path) => /(?:\.test\.tsx?|_test\.ts)$/u.test(path))
    .sort();
}

function parseJson(
  path: string,
  text: string,
  failures: CheckFailure[],
): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    failures.push({
      path,
      message: `Unable to parse the test inventory: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
    return undefined;
  }
}

function packageScriptValue(
  packageText: string,
  name: string,
): unknown {
  try {
    const parsed = JSON.parse(packageText) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) return undefined;
    const scripts = (parsed as { readonly scripts?: unknown }).scripts;
    if (
      typeof scripts !== "object" ||
      scripts === null ||
      Array.isArray(scripts)
    ) return undefined;
    return (scripts as Record<string, unknown>)[name];
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const failures: CheckFailure[] = [];
  const docs = new Map<string, string>();
  for (const path of REQUIRED_DOCS) {
    docs.set(path, await readRequired(path, failures));
  }

  requireTerms(
    TAKOS_BOUNDARY_PATH,
    docs.get(TAKOS_BOUNDARY_PATH) ?? "",
    [
      "Takos does not own a deployment control plane",
      "Takosumi owns",
      "ProviderConnection",
      "CredentialRecipe",
      "ProviderBinding",
      "InterfaceBinding",
      "bun run check",
    ],
    failures,
  );

  await validateRetiredPaths(failures);

  const packageText = await readRequired("package.json", failures);
  rejectMarkers(
    "package.json",
    packageText,
    PACKAGE_FORBIDDEN_MARKERS,
    failures,
  );
  if (!/"check"\s*:\s*"[^"]*bun run validate:architecture/.test(packageText)) {
    failures.push({
      path: "package.json",
      message: "Portable check must include bun run validate:architecture.",
    });
  }
  if (!/"build"\s*:\s*"[^"]*bun run worker:build/.test(packageText)) {
    failures.push({
      path: "package.json",
      message:
        "Portable build must traverse the real Worker module graph through bun run worker:build.",
    });
  }
  const capsuleProductPath = "src/worker/server/routes/capsules_test.ts";
  const quarantineText = await readRequired(TEST_QUARANTINE_PATH, failures);
  const onlineText = await readRequired(TEST_ONLINE_PATH, failures);
  const quarantineValue = parseJson(
    TEST_QUARANTINE_PATH,
    quarantineText,
    failures,
  );
  const onlineValue = parseJson(
    TEST_ONLINE_PATH,
    onlineText,
    failures,
  );
  const inventoryValidation = validateTestInventory(
    await trackedTestFiles(failures),
    quarantineValue,
    onlineValue,
  );
  for (const issue of inventoryValidation.issues) failures.push(issue);
  const quarantinedFiles = new Set(
    inventoryValidation.inventory.quarantined,
  );
  const onlineFiles = new Set(inventoryValidation.inventory.online);
  for (const [path, files] of [
    [TEST_QUARANTINE_PATH, quarantinedFiles],
    [TEST_ONLINE_PATH, onlineFiles],
  ] as const) {
    for (const file of files) {
      if (await pathExists(file)) continue;
      failures.push({
        path,
        message: `${file} names a test path that does not exist.`,
      });
    }
  }
  if (!onlineFiles.has(ONLINE_TEST_PATH)) {
    failures.push({
      path: TEST_ONLINE_PATH,
      message: `${ONLINE_TEST_PATH} must be listed as online evidence.`,
    });
  }
  if (quarantinedFiles.has(capsuleProductPath)) {
    failures.push({
      path: TEST_QUARANTINE_PATH,
      message:
        "Portable tests must exercise the canonical Capsule and Interface product path; " +
        `${capsuleProductPath} is quarantined.`,
    });
  }
  if (!/"test"\s*:\s*"bun scripts\/run-portable-tests\.ts/.test(packageText)) {
    failures.push({
      path: "package.json",
      message:
        "Portable tests must run through scripts/run-portable-tests.ts so every tracked test file is either run or quarantined with a reason.",
    });
  }
  if (!/"test:online"\s*:\s*"bun scripts\/run-portable-tests\.ts --online"/.test(packageText)) {
    failures.push({
      path: "package.json",
      message:
        "Online evidence must run through scripts/run-portable-tests.ts --online.",
    });
  }
  const onlineTracerCommand =
    "bun test scripts/__tests__/takoserver-fetch-tracer.online.test.ts";
  for (const script of [
    "takoserver:fetch-tracer:online-evidence",
    "test:takoserver-fetch-tracer:online",
  ] as const) {
    if (packageScriptValue(packageText, script) === onlineTracerCommand) {
      continue;
    }
    failures.push({
      path: "package.json",
      message:
        `${script} must run only ${onlineTracerCommand}.`,
    });
  }

  for (const rule of CURRENT_SOURCE_RULES) {
    const text = await readRequired(rule.path, failures);
    rejectMarkers(rule.path, text, rule.forbidden, failures);
  }

  for (const path of [
    "deploy/cloudflare/wrangler.toml",
    "deploy/opentofu/cloudflare/modules/platform/main.tf",
    "src/worker/shared/types/env.ts",
  ]) {
    const text = await readRequired(path, failures);
    rejectMarkers(path, text, DISTRIBUTION_FORBIDDEN_MARKERS, failures);
  }

  if (failures.length > 0) {
    console.error("Architecture alignment validation failed:");
    for (const failure of failures) {
      console.error(`- ${failure.path}: ${failure.message}`);
    }
    runtime.exit(1);
  }

  console.log("Architecture alignment validation passed.");
  console.log(`Checked ${REQUIRED_DOCS.length} canonical documents.`);
  console.log(
    `Verified ${RETIRED_PATHS.length + RETIRED_DIRS.length} retired paths remain absent.`,
  );
}

await main();
