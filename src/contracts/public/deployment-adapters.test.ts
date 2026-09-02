import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../../../", import.meta.url);
const contract = JSON.parse(
  await readFile(new URL("deploy/product-resources.json", root), "utf8"),
) as {
  apiVersion: string;
  product: string;
  resources: Array<{ name: string; shape: string }>;
  runtimeConnections: Array<{ name: string; resource: string }>;
};
const agentDockerfile = await readFile(
  new URL("containers/agent/Dockerfile", root),
  "utf8",
);
const bridgeHelper = await readFile(
  new URL("scripts/takos-cloudflare-opentofu-bridge.ts", root),
  "utf8",
);
const legacyProviderGapStateInput = JSON.parse(
  await readFile(
    new URL(
      "deploy/opentofu/cloudflare/fixtures/provider-gap-legacy-state-input.json",
      root,
    ),
    "utf8",
  ),
) as Record<string, string>;

const cloudflareHclPaths: string[] = [];
for await (
  const path of new Bun.Glob("deploy/opentofu/cloudflare/**/*.tf").scan({
    cwd: fileURLToPath(root),
    onlyFiles: true,
  })
) {
  if (path.includes("/.terraform/")) continue;
  cloudflareHclPaths.push(path);
}
cloudflareHclPaths.sort();

const cloudflareHcl = (
  await Promise.all(
    cloudflareHclPaths.map((path) =>
      readFile(new URL(path, root), "utf8"),
    ),
  )
).join("\n");

/** Remove comments before checking that a token is part of the adapter. */
const cloudflareHclWithoutComments = cloudflareHcl
  .replace(/^\s*#.*$/gm, "")
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/^\s*\/\*[\s\S]*?\*\/\s*$/gm, "");

type ResourceBlock = { type: string; name: string; body: string };

function resourceBlocks(source: string): ResourceBlock[] {
  const blocks: ResourceBlock[] = [];
  const header = /resource\s+"([^"]+)"\s+"([^"]+)"\s*\{/gu;

  for (const match of source.matchAll(header)) {
    const type = match[1];
    const name = match[2];
    const start = match.index;
    if (type === undefined || name === undefined || start === undefined) {
      continue;
    }
    const openingBrace = start + match[0].lastIndexOf("{");
    let depth = 0;
    let inString = false;
    let escaped = false;
    let closingBrace = -1;

    for (let index = openingBrace; index < source.length; index += 1) {
      const character = source[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
        continue;
      }
      if (character === '"') {
        inString = true;
      } else if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          closingBrace = index;
          break;
        }
      }
    }

    if (closingBrace === -1) continue;
    blocks.push({
      type,
      name,
      body: source.slice(openingBrace + 1, closingBrace),
    });
  }

  return blocks;
}

const cloudflareResourceBlocks = resourceBlocks(cloudflareHclWithoutComments);
const cloudflareResourceSurface = cloudflareResourceBlocks
  .map(({ type, name, body }) => `${type} ${name}\n${body}`)
  .join("\n");

function hasResourceType(type: string): boolean {
  return cloudflareResourceBlocks.some((resource) => resource.type === type);
}

function hasResourceSurfaceToken(token: string): boolean {
  return new RegExp(`\\b${token}\\b`, "u").test(cloudflareResourceSurface);
}

function hasContainerLifecycleSurfaceToken(token: string): boolean {
  return (
    new RegExp(`\\b${token}\\b`, "u").test(cloudflareHclWithoutComments) &&
    cloudflareResourceSurface.includes(
      "local.durable_object_lifecycle.container_bindings",
    )
  );
}

function hasLogicalResourceToken(name: string): boolean {
  return [name, name.replaceAll("-", "_")].some((token) => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(
      `(?:["'\\s=])${escaped}(?=["'\\s,}\\n])`,
      "u",
    ).test(cloudflareHclWithoutComments);
  });
}

test("Takos owns one provider-neutral resource contract", () => {
  expect(contract.apiVersion).toBe("takos.jp/product-resources/v1");
  expect(contract.product).toBe("takos");
  expect(
    new Set(contract.resources.map((resource) => resource.name)).size,
  ).toBe(contract.resources.length);
  const resources = new Set(
    contract.resources.map((resource) => resource.name),
  );
  for (const connection of contract.runtimeConnections) {
    expect(resources.has(connection.resource)).toBe(true);
  }
  expect(JSON.stringify(contract)).not.toMatch(
    /cloudflare|takoform|account_id|api_token/i,
  );
});

test("the current Cloudflare adapter declares the complete product graph", () => {
  for (const resource of contract.resources) {
    expect(hasLogicalResourceToken(resource.name)).toBe(true);
  }

  for (const connection of contract.runtimeConnections) {
    expect(cloudflareHclWithoutComments).toContain(connection.name);
    expect(
      hasResourceSurfaceToken(connection.name) ||
        hasContainerLifecycleSurfaceToken(connection.name),
    ).toBe(true);
  }

  for (const [label, type] of [
    ["Worker identity", "cloudflare_worker"],
    ["Worker artifact version", "cloudflare_worker_version"],
    ["Worker deployment", "cloudflare_workers_deployment"],
    ["D1 database", "cloudflare_d1_database"],
    ["KV namespace", "cloudflare_workers_kv_namespace"],
    ["R2 bucket", "cloudflare_r2_bucket"],
    ["Queue", "cloudflare_queue"],
    ["Queue consumer", "cloudflare_queue_consumer"],
    ["Schedule", "cloudflare_workers_cron_trigger"],
  ] as const) {
    expect(hasResourceType(type), `${label} resource is missing`).toBe(true);
  }

  expect(
    /(?:vectorize|embeddings)/iu.test(cloudflareResourceSurface),
    "Vectorize mapping is missing",
  ).toBe(true);
  expect(
    /(?:durable[_-]?object|SESSION_DO|RUN_NOTIFIER|NOTIFICATION_NOTIFIER|RATE_LIMITER_DO|ROUTING_DO)/iu.test(
      cloudflareResourceSurface,
    ),
    "Durable-object mapping is missing",
  ).toBe(true);
  expect(
    /(?:container|EXECUTOR_CONTAINER|ExecutorContainerTier)/iu.test(
      cloudflareResourceSurface,
    ),
    "Container-service mapping is missing",
  ).toBe(true);

  const scheduleResources = contract.resources.filter(
    (resource) => resource.shape === "Schedule",
  );
  expect(scheduleResources).toHaveLength(2);
  for (const schedule of scheduleResources) {
    expect(hasResourceSurfaceToken(schedule.name)).toBe(true);
  }

  const containerConnections = contract.runtimeConnections.filter(
    (connection) =>
      connection.name === "EXECUTOR_CONTAINER" ||
      connection.name === "EXECUTOR_CONTAINER_TIER2" ||
      connection.name === "EXECUTOR_CONTAINER_TIER3",
  );
  expect(containerConnections).toHaveLength(3);
  for (const connection of containerConnections) {
    expect(hasContainerLifecycleSurfaceToken(connection.name)).toBe(true);
  }

  const forbiddenTakosumiMutationPlumbing =
    /(?:takos-product-materializer|product:(?:activate|pre_destroy)|takosumi[_-](?:lifecycle|profile|descriptor)|TAKOSUMI_(?:LIFECYCLE|PROFILE|DESCRIPTOR)|(?:lifecycle|profile|descriptor)_(?:action|url|digest|sha256|path))/iu;
  expect(cloudflareHclWithoutComments).not.toMatch(
    forbiddenTakosumiMutationPlumbing,
  );
});

test("the Cloudflare adapter establishes Durable Object migrations before binding them", () => {
  const resource = (type: string, name: string): ResourceBlock => {
    const match = cloudflareResourceBlocks.find(
      (candidate) => candidate.type === type && candidate.name === name,
    );
    expect(match, `resource ${type}.${name} is missing`).toBeDefined();
    return match!;
  };

  const migrationVersion = resource(
    "cloudflare_worker_version",
    "durable_object_migrations",
  );
  const migrationDeployment = resource(
    "cloudflare_workers_deployment",
    "durable_object_migrations",
  );
  const applicationVersion = resource("cloudflare_worker_version", "app");
  const providerGapPre = resource("terraform_data", "provider_gap_pre");
  const providerGapCleanup = resource("terraform_data", "provider_gap_cleanup");
  const providerGapPost = resource("terraform_data", "provider_gap_post");

  expect(migrationVersion.body).toMatch(/\bmigrations\s*=/u);
  expect(migrationVersion.body).toContain(
    'count = local.provider_gap_bridge_enabled ? 0 : 1',
  );
  expect(migrationVersion.body).not.toContain(
    'type = "durable_object_namespace"',
  );
  expect(migrationVersion.body).toMatch(/\bcontainers\s*=/u);
  expect(migrationVersion.body).toContain(
    "local.durable_object_lifecycle.container_bindings",
  );
  expect(applicationVersion.body).toContain(
    "local.durable_object_lifecycle.container_bindings",
  );
  for (const className of [
    "ExecutorContainerTier1",
    "ExecutorContainerTier2",
    "ExecutorContainerTier3",
  ]) {
    expect(cloudflareHclWithoutComments).toContain(className);
  }
  expect(migrationDeployment.body).toContain(
    'count = local.provider_gap_bridge_enabled ? 0 : 1',
  );
  expect(migrationDeployment.body).toContain(
    "cloudflare_worker_version.durable_object_migrations[0].id",
  );
  expect(applicationVersion.body).not.toMatch(/\bmigrations\s*=/u);
  expect(applicationVersion.body).toContain(
    "cloudflare_workers_deployment.durable_object_migrations",
  );
  expect(applicationVersion.body).toContain("terraform_data.provider_gap_pre");
  expect(providerGapPre.body).toContain("cloudflare_worker.app");
  expect(providerGapPre.body).toContain("terraform_data.provider_gap_cleanup");
  expect(cloudflareHclWithoutComments).toContain(
    "container_rendered_input_digest",
  );
  expect(cloudflareHclWithoutComments).toContain(
    "container_rendered_input = local.container_rendered_input_digest",
  );
  expect(cloudflareHclWithoutComments).toContain(
    "account_id               = var.account_id",
  );
  // The Worker migrates its own schema at runtime, so no bridge phase may
  // carry a D1 database identity or a migration set into an Apply-time step.
  expect(cloudflareHclWithoutComments).not.toContain(
    "TAKOS_CLOUDFLARE_D1_DATABASE_ID",
  );
  expect(cloudflareHclWithoutComments).not.toContain(
    "TAKOS_CLOUDFLARE_MIGRATION_SET_PATH",
  );
  expect(cloudflareHclWithoutComments).not.toContain("migration_set_digest");
  for (const resourceBody of [
    providerGapPre.body,
    providerGapCleanup.body,
    providerGapPost.body,
  ]) {
    expect(resourceBody).toContain("triggers_replace = local.bridge_triggers");
  }
  expect(cloudflareHclWithoutComments).toContain(
    "TAKOS_CLOUDFLARE_WORKER_ASSETS_PATH",
  );
  expect(cloudflareHclWithoutComments).toContain(
    'fileset(local.worker_assets_directory_path, "**")',
  );
  expect(providerGapCleanup.body).toContain("when        = destroy");
  expect(providerGapCleanup.body).toContain("cloudflare_worker.app");
  expect(providerGapCleanup.body).not.toContain("post-worker");
  expect(providerGapCleanup.body).toContain("environment = merge(self.input");
  expect(providerGapCleanup.body).not.toContain(
    "environment = local.bridge_environment",
  );
  expect(providerGapCleanup.body).toContain(
    'lookup(self.input, "TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_MODE", "staging")',
  );
  expect(providerGapCleanup.body).toContain(
    'lookup(self.input, "TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_ACKNOWLEDGEMENT", "")',
  );
  expect(cloudflareHclWithoutComments).toContain(
    "TAKOS_CLOUDFLARE_CONTAINER_DESIRED_CONFIG_CONTENT",
  );
  expect(providerGapPost.body).toContain("terraform_data.provider_gap_cleanup");
  expect(providerGapPost.body).toContain("recovery-cleanup");
  expect(providerGapPost.body).toContain("environment = merge(self.input");
  expect(providerGapPost.body).toContain(
    'lookup(self.input, "TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_MODE", "staging")',
  );
  expect(Object.hasOwn(legacyProviderGapStateInput, "TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_MODE")).toBe(false);
  expect(Object.hasOwn(legacyProviderGapStateInput, "TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_ACKNOWLEDGEMENT")).toBe(false);
  expect(Object.hasOwn(legacyProviderGapStateInput, "TAKOS_CLOUDFLARE_ENVIRONMENT")).toBe(false);
  expect(providerGapPost.body).toContain(
    'lookup(self.input, "TAKOS_CLOUDFLARE_ENVIRONMENT", "staging")',
  );
  expect(cloudflareHclWithoutComments).toContain(
    "TAKOS_CLOUDFLARE_DURABLE_OBJECT_LIFECYCLE",
  );
  expect(bridgeHelper).toContain("establishVectorOwnershipProof");
  expect(bridgeHelper).toContain("worker_vector_binding_readback_missing");

  for (const [type, name] of [
    ["cloudflare_queue_consumer", "this"],
    ["cloudflare_workers_cron_trigger", "this"],
    ["cloudflare_workers_route", "public"],
  ] as const) {
    expect(resource(type, name).body).toContain(
      "cloudflare_workers_deployment.app",
    );
  }
});

test("Cloudflare provider-gap phases bind account and content identity into replacement triggers", () => {
  const triggerStart = cloudflareHclWithoutComments.indexOf("bridge_triggers = {");
  expect(triggerStart).toBeGreaterThanOrEqual(0);
  const triggerEnd = cloudflareHclWithoutComments.indexOf("\n  }", triggerStart);
  expect(triggerEnd).toBeGreaterThan(triggerStart);
  const triggerBody = cloudflareHclWithoutComments.slice(triggerStart, triggerEnd);
  expect(triggerBody).toContain("account_id               = var.account_id");
  expect(triggerBody).not.toContain("d1_database_id");
  expect(triggerBody).not.toContain("migration_set");
  expect(triggerBody).toContain(
    "vector_desired_config    = local.vector_desired_config_digest",
  );
  for (const name of ["provider_gap_pre", "provider_gap_cleanup", "provider_gap_post"]) {
    const resource = cloudflareResourceBlocks.find(
      (candidate) => candidate.type === "terraform_data" && candidate.name === name,
    );
    expect(resource, `${name} bridge phase is missing`).toBeDefined();
    expect(resource!.body).toContain("triggers_replace = local.bridge_triggers");
  }
});

test("the portable agent service declares its HTTP port", () => {
  expect(agentDockerfile).toContain("ENV PORT=8080");
  expect(agentDockerfile).toContain("EXPOSE 8080");
});

test("Takos source has no sibling or private Takosumi imports", async () => {
  const sourcePatterns = [
    "src/**/*.{ts,tsx,js,mjs,cjs}",
    "web/src/**/*.{ts,tsx,js,mjs,cjs}",
    "scripts/**/*.{ts,tsx,js,mjs,cjs}",
    "website/src/**/*.{ts,tsx,js,mjs,cjs}",
  ] as const;
  const importSpecifier =
    /(?:\bfrom\s+|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["']([^"']+)["']/gu;
  const forbidden: string[] = [];
  const forbiddenSpecifier = [
    /(?:^|\/)takosumi\//u,
    /^takosumi-contract(?:$|\/)/u,
    /^@takosjp\/takosumi-contract$/u,
    /^@takosjp\/takosumi-accounts(?:-|$)/u,
    /^@takosumi\/internal(?:$|\/)/u,
    /^takosumi-(?:rootgen|graph|policy)(?:$|\/)/u,
  ];

  for (const pattern of sourcePatterns) {
    for await (
      const path of new Bun.Glob(pattern).scan({
        cwd: fileURLToPath(root),
        onlyFiles: true,
      })
    ) {
      const source = await readFile(new URL(path, root), "utf8");
      for (const match of source.matchAll(importSpecifier)) {
        const specifier = match[1] ?? "";
        if (!forbiddenSpecifier.some((pattern) => pattern.test(specifier))) {
          continue;
        }
        const line = source.slice(0, match.index).split("\n").length;
        forbidden.push(`${path}:${line}:${specifier}`);
      }
    }
  }

  expect(forbidden.sort()).toEqual([]);
});

test("Takos TypeScript and Vite configs have no sibling Takosumi aliases", async () => {
  const configPaths = ["tsconfig.json", "web/tsconfig.json", "web/vite.config.ts"];
  const forbidden: string[] = [];
  const forbiddenAlias = /(?:\.\.?\/.*takosumi|@takosjp\/takosumi-accounts|takosumi-contract\/(?:internal|reference)|takosumi-(?:rootgen|graph|policy))/u;
  for (const path of configPaths) {
    const source = await readFile(new URL(path, root), "utf8");
    if (forbiddenAlias.test(source)) forbidden.push(path);
  }
  expect(forbidden).toEqual([]);
});
