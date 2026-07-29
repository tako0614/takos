import * as runtime from "./runtime.ts";

type CheckFailure = {
  path: string;
  message: string;
};

const CONTROL_ARCHITECTURE_PATH = "../takos-control/ARCHITECTURE.md";
const TAKOS_BOUNDARY_PATH = "deploy/TAKOSUMI_DEPLOY.md";

const REQUIRED_DOCS = [
  "README.md",
  "docs/contributing/current-state.md",
  TAKOS_BOUNDARY_PATH,
  CONTROL_ARCHITECTURE_PATH,
  "../takosumi/docs/internal/core-spec.md",
  "../takosumi/docs/reference/takoform-host.md",
  "../takosumi/docs/concepts/credentials.md",
  "../takosumi/docs/concepts/interfaces.md",
  "../takosumi/docs/concepts/run-model.md",
  "../takosumi/docs/concepts/sources.md",
] as const;

const REQUIRED_TAKOSUMI_DOMAINS = [
  "workspaces",
  "projects",
  "sources",
  "connections",
  "capsules",
  "deploy-control",
  "audit",
  "interfaces",
  "service-forms",
] as const;

const RETIRED_PATHS = [
  "scripts/build-release-manifest.ts",
  "scripts/release-gate.ts",
  "scripts/validate-featured-app-opentofu.ts",
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
] as const;

const RETIRED_DIRS = [
  "scripts/control",
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
      message:
        `Unable to read canonical file: ${
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

async function validateRetiredPaths(
  failures: CheckFailure[],
): Promise<void> {
  for (const path of [...RETIRED_PATHS, ...RETIRED_DIRS]) {
    if (!(await pathExists(path))) continue;
    failures.push({
      path,
      message: "Retired Takos-local lifecycle path must remain absent.",
    });
  }
}

async function main(): Promise<void> {
  const failures: CheckFailure[] = [];
  const docs = new Map<string, string>();
  for (const path of REQUIRED_DOCS) {
    docs.set(path, await readRequired(path, failures));
  }

  requireTerms(
    CONTROL_ARCHITECTURE_PATH,
    docs.get(CONTROL_ARCHITECTURE_PATH) ?? "",
    [
      "One lifecycle authority",
      "Takosumi OSS",
      "Takos product",
      "Takoform",
      "InterfaceBinding",
      "Takosumi Cloud",
    ],
    failures,
  );
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

  const takosumiContract = [
    "../takosumi/docs/internal/core-spec.md",
    "../takosumi/docs/reference/takoform-host.md",
    "../takosumi/docs/concepts/credentials.md",
    "../takosumi/docs/concepts/interfaces.md",
    "../takosumi/docs/concepts/run-model.md",
    "../takosumi/docs/concepts/sources.md",
  ].map((path) => docs.get(path) ?? "").join("\n");
  requireTerms(
    "Takosumi canonical docs",
    takosumiContract,
    [
      "Workspace",
      "Project",
      "Capsule",
      "Source",
      "ProviderConnection",
      "CredentialRecipe",
      "ProviderBinding",
      "Run",
      "StateVersion",
      "Output",
      "AuditEvent",
      "Interface",
      "InterfaceBinding",
      "Service Form",
    ],
    failures,
  );

  for (const domain of REQUIRED_TAKOSUMI_DOMAINS) {
    const path = `../takosumi/core/domains/${domain}`;
    if (await pathExists(path)) continue;
    failures.push({
      path,
      message: "Required Takosumi-owned domain directory is missing.",
    });
  }

  await validateRetiredPaths(failures);

  const packageText = await readRequired("package.json", failures);
  rejectMarkers(
    "package.json",
    packageText,
    PACKAGE_FORBIDDEN_MARKERS,
    failures,
  );
  if (
    !/"check"\s*:\s*"[^"]*bun run validate:architecture/.test(packageText)
  ) {
    failures.push({
      path: "package.json",
      message: "Portable check must include bun run validate:architecture.",
    });
  }

  for (const rule of CURRENT_SOURCE_RULES) {
    const text = await readRequired(rule.path, failures);
    rejectMarkers(rule.path, text, rule.forbidden, failures);
  }

  for (
    const path of [
      "deploy/cloudflare/wrangler.toml",
      "deploy/opentofu/modules/cloudflare/main.tf",
      "src/worker/shared/types/env.ts",
    ]
  ) {
    const text = await readRequired(path, failures);
    rejectMarkers(
      path,
      text,
      DISTRIBUTION_FORBIDDEN_MARKERS,
      failures,
    );
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
  console.log(
    `Verified ${REQUIRED_TAKOSUMI_DOMAINS.length} Takosumi-owned domain directories.`,
  );
}

await main();
