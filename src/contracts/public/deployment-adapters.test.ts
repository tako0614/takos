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
    expect(hasResourceSurfaceToken(connection.name)).toBe(true);
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
    expect(hasResourceSurfaceToken(connection.name)).toBe(true);
  }

  const forbiddenTakosumiMutationPlumbing =
    /(?:takos-product-materializer|product:(?:activate|pre_destroy)|takosumi[_-](?:lifecycle|profile|descriptor)|TAKOSUMI_(?:LIFECYCLE|PROFILE|DESCRIPTOR)|(?:lifecycle|profile|descriptor)_(?:action|url|digest|sha256|path))/iu;
  expect(cloudflareHclWithoutComments).not.toMatch(
    forbiddenTakosumiMutationPlumbing,
  );
});

test("the Cloudflare adapter deploys Durable Object migrations before binding them", () => {
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

  expect(migrationVersion.body).toMatch(/\bmigrations\s*=/u);
  expect(migrationVersion.body).not.toContain(
    'type = "durable_object_namespace"',
  );
  expect(migrationVersion.body).not.toMatch(/\bcontainers\s*=/u);
  expect(migrationDeployment.body).toContain(
    "cloudflare_worker_version.durable_object_migrations.id",
  );
  expect(applicationVersion.body).not.toMatch(/\bmigrations\s*=/u);
  expect(applicationVersion.body).toContain(
    "cloudflare_workers_deployment.durable_object_migrations",
  );

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
