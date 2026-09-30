import {
  cp,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { REQUIRED_RUNTIME_SECRET_NAMES as RUNTIME_SECRET_BINDING_NAMES } from "../src/worker/shared/config/runtime-secrets.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const moduleRoot = join(root, "deploy", "opentofu", "cloudflare");
const fixtureRoot = join(moduleRoot, "fixtures", "generated-root");


await runTofu(
  ["init", "-backend=false", "-input=false", "-lockfile=readonly", "-no-color"],
  moduleRoot,
);
await runTofu(["test", "-no-color"], moduleRoot);
await assertWorkerDestroyDependencyGraph();
await assertRuntimeSecretBindings();
const enabledProviderGapPlan = await assertProviderGapCapabilityPlans();
await assertProviderGapCapabilityDependencyGraph(enabledProviderGapPlan);

const generatedRoot = await mkdtemp(join(moduleRoot, ".generated-root-test-"));
try {
  await writeFile(
    join(generatedRoot, "main.tf"),
    await readFile(join(fixtureRoot, "main.tf.tmpl"), "utf8"),
  );
  await cp(
    join(fixtureRoot, "paths.tftest.hcl"),
    join(generatedRoot, "paths.tftest.hcl"),
  );
  await runTofu(
    ["init", "-backend=false", "-input=false", "-no-color"],
    generatedRoot,
  );
  await runTofu(["test", "-no-color"], generatedRoot);
} finally {
  await rm(generatedRoot, { recursive: true, force: true });
}

async function runTofu(args: readonly string[], cwd: string): Promise<void> {
  const process = Bun.spawn(["tofu", ...args], {
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(`tofu ${args[0] ?? "command"} failed with exit ${exitCode}`);
  }
}

async function assertWorkerDestroyDependencyGraph(): Promise<void> {
  // `tofu graph -type=plan` emits create-time dependency arrows. OpenTofu
  // reverses those arrows during destroy, so the Worker identity must depend
  // directly on every resource whose binding can keep it undeletable.
  const graph = await runTofuCapture(
    [
      "graph",
      "-type=plan",
      "-draw-cycles",
      "-var=project_name=takos-destroy-order-graph",
      "-var=public_url=https://takos-destroy-order-graph.example.com",
      "-var=opentofu_plan_mode=true",
      '-var=cloudflare={account_id="00000000000000000000000000000000"}',
    ],
    moduleRoot,
  );
  const edges = new Set(
    [...graph.matchAll(/"([^"]+)"\s+->\s+"([^"]+)"/g)].map(
      ([, from, to]) => `${from} -> ${to}`,
    ),
  );
  const worker = '[root] module.platform.cloudflare_worker.app (expand)';
  const backingResources = [
    '[root] module.platform.cloudflare_d1_database.this (expand)',
    '[root] module.platform.cloudflare_workers_kv_namespace.this (expand)',
    '[root] module.platform.cloudflare_r2_bucket.this (expand)',
    '[root] module.platform.cloudflare_queue.this (expand)',
  ];
  const missing = backingResources.filter(
    (resource) => !edges.has(`${worker} -> ${resource}`),
  );
  if (missing.length > 0) {
    throw new Error(
      `Worker destroy dependency graph is missing direct edges:\n${missing
        .map((resource) => `  ${worker} -> ${resource}`)
        .join("\n")}`,
    );
  }
}

type GraphNode = { readonly key: string; readonly label: string };
type ConfigurationResource = {
  readonly address: string;
  readonly type: string;
  readonly provisioners?: readonly unknown[];
};

async function assertProviderGapCapabilityDependencyGraph(
  enabledPlan: unknown,
): Promise<void> {
  // Graph edges point from a resource to its create-time dependencies. Every
  // Cloudflare resource and bridge local-exec anchor must reach the read-only
  // capability probe before it can run. The lists come from graph/config JSON,
  // so adding a resource or anchor cannot silently bypass this assertion.
  const graph = await runTofuCapture(
    [
      "graph",
      "-type=plan",
      "-draw-cycles",
      "-var=project_name=takos-capability-order-graph",
      "-var=public_url=https://takos-capability-order-graph.example.com",
      "-var=environment=staging",
      "-var=opentofu_plan_mode=true",
      "-var=cloudflare_provider_gap_bridge_mode=staging",
      "-var=container_image=docker.io/library/alpine@sha256:0000000000000000000000000000000000000000000000000000000000000000",
      '-var=cloudflare={account_id="00000000000000000000000000000000"}',
    ],
    moduleRoot,
  );
  const edges = new Map<string, string[]>();
  for (const [, from, to] of graph.matchAll(/"([^\"]+)"\s+->\s+"([^\"]+)"/g)) {
    edges.set(from, [...(edges.get(from) ?? []), to]);
  }
  const graphNodes = parseGraphNodes(graph);
  const capability = graphNodes.find(({ label }) =>
    label.endsWith(".terraform_data.provider_gap_capability"),
  )?.key;
  if (!capability) throw new Error("Provider-gap capability is missing from graph");

  const configurationResources = collectConfigurationResources(enabledPlan);
  if (configurationResources.length === 0) {
    throw new Error("Enabled provider-gap plan has no configuration resources");
  }
  const cloudflareResources = graphNodes
    .filter(({ label }) => cloudflareResourceLabel(label))
    .map(({ key }) => key);
  if (cloudflareResources.length === 0) {
    throw new Error("OpenTofu graph contains no cloudflare_* resources");
  }
  assertConfigurationCloudflareResourcesReachGraph(configurationResources, graphNodes);

  const imperativeAnchors = configurationResources.filter(
    isImperativeTerraformDataAnchor,
  );
  if (imperativeAnchors.length === 0) {
    throw new Error("No imperative Cloudflare terraform_data anchor in configuration");
  }
  const imperativeGraphNodes = imperativeAnchors.flatMap(({ address }) => {
    const matches = graphNodes.filter(({ label }) => label === address);
    if (matches.length !== 1) {
      throw new Error(`Imperative terraform_data anchor ${address} missing from graph`);
    }
    return matches;
  });

  const reachesCapability = (start: string): boolean => {
    const pending = [start];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (current === capability) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      pending.push(...(edges.get(current) ?? []));
    }
    return false;
  };
  const guardedNodes = new Set([
    ...cloudflareResources,
    ...imperativeGraphNodes.map(({ key }) => key),
  ]);
  const missing = [...guardedNodes].filter((resource) => !reachesCapability(resource));
  if (missing.length > 0) {
    throw new Error(
      `Resources or imperative anchors can run before capability preflight:\n${missing
        .map((resource) => `  ${resource}`)
        .join("\n")}`,
    );
  }
  if ((edges.get(capability) ?? []).some((dependency) => dependency.includes("cloudflare_"))) {
    throw new Error("Capability preflight unexpectedly depends on a Cloudflare resource");
  }
}

/**
 * The module names the Takos runtime secrets and never holds their values.
 *
 * Two saved plans prove it at the level a reviewer cares about: the planned
 * Worker Version bindings and the planned resource set. A value-bearing
 * `secret_text` binding, or any generator resource, would land plaintext in the
 * OpenTofu state a Takosumi Run keeps as a StateVersion.
 */
async function assertRuntimeSecretBindings(): Promise<void> {
  const planRoot = await mkdtemp(join(moduleRoot, ".runtime-secret-plan-test-"));
  try {
    const absent = await createRuntimeSecretPlan(planRoot, "absent", false);
    const inherited = await createRuntimeSecretPlan(planRoot, "inherited", true);
    for (const [name, plan] of [
      ["absent", absent],
      ["inherited", inherited],
    ] as const) {
      assertNoSecretMaterialInPlan(name, plan);
    }

    const absentNames = bindingNames(workerVersionBindings(absent));
    if (absentNames.length !== 0) {
      throw new Error(
        `runtime_secrets_provisioned = false must bind no runtime secret name; found ${absentNames.join(", ")}`,
      );
    }

    await assertUnacknowledgedRuntimeSecretDropRefused(planRoot);

    const inheritedBindings = workerVersionBindings(inherited).filter(
      (binding) =>
        typeof binding.name === "string" &&
        (RUNTIME_SECRET_BINDING_NAMES as readonly string[]).includes(
          binding.name,
        ),
    );
    const inheritedNames = bindingNames(inheritedBindings).sort();
    const expectedNames = [...RUNTIME_SECRET_BINDING_NAMES].sort();
    if (
      inheritedNames.length !== expectedNames.length ||
      inheritedNames.some((name, index) => name !== expectedNames[index])
    ) {
      throw new Error(
        `runtime_secrets_provisioned = true must bind exactly ${expectedNames.join(", ")}; found ${inheritedNames.join(", ")}`,
      );
    }
    const wrongType = inheritedBindings.filter((binding) => binding.type !== "inherit");
    if (wrongType.length > 0) {
      throw new Error(
        `runtime secret bindings must use the value-free inherit type; found ${wrongType
          .map((binding) => `${binding.name}=${String(binding.type)}`)
          .join(", ")}`,
      );
    }
  } finally {
    await rm(planRoot, { recursive: true, force: true });
  }
}

/**
 * The one apply that may publish a Worker Version without the runtime secret
 * bindings is the first, before any value exists. Prove the module refuses the
 * same shape without the acknowledgement, so a routine apply cannot reach it.
 */
async function assertUnacknowledgedRuntimeSecretDropRefused(
  planRoot: string,
): Promise<void> {
  const planPath = join(planRoot, "unacknowledged.plan");
  const attempt = Bun.spawn([
    "tofu",
    "plan",
    "-refresh=false",
    "-input=false",
    "-lock=false",
    "-no-color",
    `-out=${planPath}`,
    "-var=project_name=takos-runtime-secret-unacknowledged",
    "-var=public_url=https://takos-runtime-secret-unacknowledged.example.com",
    "-var=environment=staging",
    "-var=opentofu_plan_mode=true",
    "-var=runtime_secrets_provisioned=false",
    '-var=cloudflare={account_id="00000000000000000000000000000000"}',
  ], { cwd: moduleRoot, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(attempt.stdout).text(),
    new Response(attempt.stderr).text(),
    attempt.exited,
  ]);
  if (exitCode === 0) {
    throw new Error(
      "runtime_secrets_provisioned = false must be refused without first_install_acknowledgement",
    );
  }
  if (!`${stdout}${stderr}`.includes("first_install_acknowledgement")) {
    throw new Error(
      "the refusal must name first_install_acknowledgement so an operator knows the only way through",
    );
  }
}

async function createRuntimeSecretPlan(
  planRoot: string,
  name: string,
  provisioned: boolean,
): Promise<unknown> {
  const planPath = join(planRoot, `${name}.plan`);
  await runTofuCapture(
    [
      "plan",
      "-refresh=false",
      "-input=false",
      "-lock=false",
      "-no-color",
      `-out=${planPath}`,
      `-var=project_name=takos-runtime-secret-${name}`,
      `-var=public_url=https://takos-runtime-secret-${name}.example.com`,
      "-var=environment=staging",
      "-var=opentofu_plan_mode=true",
      `-var=runtime_secrets_provisioned=${provisioned ? "true" : "false"}`,
      // Dropping the bindings is a first-install-only act, so the plan that
      // proves the absent shape has to carry the same acknowledgement an
      // operator would type.
      ...(provisioned
        ? []
        : [
          "-var=first_install_acknowledgement=FIRST_INSTALL_WITHOUT_RUNTIME_SECRETS",
        ]),
      '-var=cloudflare={account_id="00000000000000000000000000000000"}',
    ],
    moduleRoot,
  );
  const json = await runTofuCapture(["show", "-json", planPath], moduleRoot);
  try {
    return JSON.parse(json) as unknown;
  } catch (error) {
    throw new Error(
      `OpenTofu ${name} runtime-secret plan is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function assertNoSecretMaterialInPlan(name: string, plan: unknown): void {
  const generators = [...collectPlanResourceAddresses(plan)].filter((address) =>
    /\.(random_password|random_string|random_bytes|tls_private_key|tls_self_signed_cert)\./.test(
      address,
    ),
  );
  if (generators.length > 0) {
    throw new Error(
      `the ${name} plan must mint no secret material in OpenTofu; found ${generators.join(", ")}`,
    );
  }
  const valueBearing = workerVersionBindings(plan).filter(isValueBearingSecretBinding);
  if (valueBearing.length > 0) {
    throw new Error(
      `the ${name} plan must carry no secret-valued Worker binding; found ${valueBearing
        .map((binding) => String(binding.name))
        .join(", ")}`,
    );
  }
}

function isValueBearingSecretBinding(binding: Record<string, unknown>): boolean {
  if (binding.type === "secret_text" || binding.type === "secret_key") return true;
  const isRuntimeSecretName =
    typeof binding.name === "string" &&
    (RUNTIME_SECRET_BINDING_NAMES as readonly string[]).includes(binding.name);
  if (!isRuntimeSecretName) return false;
  return ["text", "key_base64", "key_jwk"].some(
    (field) => binding[field] !== undefined && binding[field] !== null,
  );
}

/** The runtime-secret binding names present in a plan's Worker version. */
function bindingNames(
  bindings: readonly Record<string, unknown>[],
): string[] {
  return bindings
    .map((binding) => binding.name)
    .filter((name): name is string => typeof name === "string")
    .filter((name) =>
      (RUNTIME_SECRET_BINDING_NAMES as readonly string[]).includes(name),
    );
}

function workerVersionBindings(plan: unknown): Record<string, unknown>[] {
  const bindings: Record<string, unknown>[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!recordValue(value)) return;
    if (
      value.type === "cloudflare_worker_version" &&
      recordValue(value.values) &&
      Array.isArray(value.values.bindings)
    ) {
      for (const binding of value.values.bindings) {
        if (recordValue(binding)) bindings.push(binding);
      }
    }
    for (const entry of Object.values(value)) visit(entry);
  };
  visit(plan);
  return bindings;
}

async function assertProviderGapCapabilityPlans(): Promise<unknown> {
  // Graph output keeps count=0 nodes, so inspect saved plan JSON as well.
  const planRoot = await mkdtemp(join(moduleRoot, ".provider-gap-plan-test-"));
  try {
    const enabledPlan = await createProviderGapPlan(planRoot, "enabled", "staging");
    const disabledPlan = await createProviderGapPlan(planRoot, "disabled", "off");
    const expected = "module.platform.terraform_data.provider_gap_capability[0]";
    const enabled = [...collectPlanResourceAddresses(enabledPlan)].filter((address) =>
      address.startsWith("module.platform.terraform_data.provider_gap_capability"),
    );
    if (enabled.length === 0) {
      throw new Error("Enabled provider-gap plan has zero capability instances");
    }
    if (enabled.length !== 1 || enabled[0] !== expected) {
      throw new Error(`Enabled plan must contain exactly ${expected}; found ${enabled.join(", ")}`);
    }
    const disabled = [...collectPlanResourceAddresses(disabledPlan)].filter((address) =>
      address.startsWith("module.platform.terraform_data.provider_gap_capability"),
    );
    if (disabled.length !== 0) {
      throw new Error(`Disabled plan must contain no capability instance; found ${disabled.join(", ")}`);
    }
    return enabledPlan;
  } finally {
    await rm(planRoot, { recursive: true, force: true });
  }
}

async function createProviderGapPlan(
  planRoot: string,
  name: "enabled" | "disabled",
  bridgeMode: "staging" | "off",
): Promise<unknown> {
  const planPath = join(planRoot, `${name}.plan`);
  await runTofuCapture(
    [
      "plan",
      "-refresh=false",
      "-input=false",
      "-lock=false",
      "-no-color",
      `-out=${planPath}`,
      `-var=project_name=takos-capability-plan-${name}`,
      `-var=public_url=https://takos-capability-plan-${name}.example.com`,
      "-var=environment=staging",
      "-var=opentofu_plan_mode=true",
      `-var=cloudflare_provider_gap_bridge_mode=${bridgeMode}`,
      ...(bridgeMode === "staging"
        ? [
            "-var=container_image=docker.io/library/alpine@sha256:0000000000000000000000000000000000000000000000000000000000000000",
          ]
        : []),
      '-var=cloudflare={account_id="00000000000000000000000000000000"}',
    ],
    moduleRoot,
  );
  const json = await runTofuCapture(["show", "-json", planPath], moduleRoot);
  try {
    return JSON.parse(json) as unknown;
  } catch (error) {
    throw new Error(
      `OpenTofu ${name} saved plan is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function collectPlanResourceAddresses(plan: unknown): Set<string> {
  const addresses = new Set<string>();
  const visit = (value: unknown, collectionKey = ""): void => {
    if (Array.isArray(value)) return value.forEach((entry) => visit(entry, collectionKey));
    if (!recordValue(value)) return;
    if ((collectionKey === "resource_changes" || collectionKey === "resources") && typeof value.address === "string") {
      addresses.add(value.address);
    }
    for (const key of [
      "resource_changes",
      "planned_values",
      "root_module",
      "resources",
      "child_modules",
    ]) {
      visit(value[key], key);
    }
  };
  visit(plan);
  return addresses;
}

function collectConfigurationResources(plan: unknown): ConfigurationResource[] {
  if (!recordValue(plan) || !recordValue(plan.configuration)) return [];
  const resources: ConfigurationResource[] = [];
  const visit = (module: unknown, prefix: string): void => {
    if (!recordValue(module)) return;
    if (Array.isArray(module.resources)) {
      for (const resource of module.resources) {
        if (!recordValue(resource) || typeof resource.address !== "string" || typeof resource.type !== "string") continue;
        resources.push({
          address: `${prefix}${resource.address}`,
          type: resource.type,
          provisioners: Array.isArray(resource.provisioners) ? resource.provisioners : undefined,
        });
      }
    }
    if (!recordValue(module.module_calls)) return;
    for (const [name, call] of Object.entries(module.module_calls)) {
      if (recordValue(call) && recordValue(call.module)) visit(call.module, `${prefix}module.${name}.`);
    }
  };
  visit(plan.configuration.root_module, "");
  return resources;
}

function recordValue(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseGraphNodes(graph: string): GraphNode[] {
  return [...graph.matchAll(/^\s*"([^"]+)"\s+\[label = "([^"]+)", shape = "box"\]\s*$/gm)].map(
    ([, key, label]) => ({ key, label }),
  );
}

function cloudflareResourceLabel(label: string): boolean {
  return /^module\..+\.cloudflare_[^.]+\.[^.]+$/.test(label);
}

function assertConfigurationCloudflareResourcesReachGraph(
  configurationResources: readonly ConfigurationResource[],
  graphNodes: readonly GraphNode[],
): void {
  const graphResources = graphNodes.filter(({ label }) => cloudflareResourceLabel(label));
  const graphLabels = new Set(graphResources.map(({ label }) => label));
  const configurationResourcesByType = configurationResources.filter(({ type }) => type.startsWith("cloudflare_"));
  for (const resource of configurationResourcesByType) {
    if (!graphLabels.has(resource.address)) {
      throw new Error(`Cloudflare resource ${resource.address} is missing from the OpenTofu graph`);
    }
  }
  const sourceLabels = new Set(configurationResourcesByType.map(({ address }) => address));
  const graphOnly = graphResources.filter(({ label }) => !sourceLabels.has(label));
  if (graphOnly.length > 0) {
    throw new Error(
      `OpenTofu graph has cloudflare_* resources missing from configuration source:\n${graphOnly
        .map(({ label }) => `  ${label}`)
        .join("\n")}`,
    );
  }
}

function isImperativeTerraformDataAnchor(
  resource: ConfigurationResource,
): boolean {
  if (
    resource.type !== "terraform_data" ||
    resource.address ===
      "module.platform.terraform_data.provider_gap_capability" ||
    !resource.provisioners
  ) {
    return false;
  }
  return resource.provisioners.some(
    (provisioner) =>
      recordValue(provisioner) && provisioner.type === "local-exec",
  );
}

async function runTofuCapture(
  args: readonly string[],
  cwd: string,
): Promise<string> {
  const process = Bun.spawn(["tofu", ...args], {
    cwd,
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `tofu ${args[0] ?? "command"} failed with exit ${exitCode}: ${stderr.trim()}`,
    );
  }
  return stdout;
}
