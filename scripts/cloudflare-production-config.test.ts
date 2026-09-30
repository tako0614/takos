import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  PRODUCT_VECTOR_INDEX,
  RUNTIME_SECRET_BINDING_NAMES,
  WRANGLER_TEMPLATE_PATH,
  assertPinnedContainerImage,
  parseModuleOutputs,
  renderWranglerConfig,
} from "./cloudflare-production-config.ts";

const repositoryRoot = resolve(import.meta.dir, "..");
const ACCOUNT = "00000000000000000000000000000001";
const OTHER_ACCOUNT = "0000000000000000000000000000000f";
const IMAGE = `registry.cloudflare.com/${ACCOUNT}/takos-agent@sha256:${"a".repeat(64)}`;

async function template(): Promise<string> {
  return await readFile(resolve(repositoryRoot, WRANGLER_TEMPLATE_PATH), "utf8");
}

/** `tofu output -json` shape, with the module's own output names. */
function outputsFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const wrap = (value: unknown) => ({ sensitive: false, type: "string", value });
  return {
    cloudflare_account_id: wrap(ACCOUNT),
    service_runtime_name: wrap("takos-live"),
    public_url: wrap("https://app.example.test"),
    launch_url: wrap("https://app.example.test"),
    worker_env: wrap({
      ADMIN_DOMAIN: "app.example.test",
      TENANT_BASE_DOMAIN: "app.example.test",
      AUTH_PUBLIC_BASE_URL: "https://app.example.test",
      PROXY_BASE_URL: "https://app.example.test",
      TAKOS_AGENT_CONTROL_RPC_BASE_URL: "https://app.example.test",
      CF_ACCOUNT_ID: ACCOUNT,
      CF_ZONE_ID: "zone-1234",
      TAKOSUMI_ACCOUNTS_URL: "https://accounts.example.test",
      OIDC_ISSUER_URL: "https://accounts.example.test",
      OIDC_CLIENT_ID: "takos-live-client",
      OIDC_REDIRECT_URI: "https://app.example.test/auth/oidc/callback",
      EXECUTOR_TIER1_WARM_POOL_SIZE: "1",
      EXECUTOR_TIER1_MAX_CONCURRENT_RUNS: "4",
      EXECUTOR_TIER3_POOL_SIZE: "1",
      EXECUTOR_TIER3_MAX_CONCURRENT_RUNS: "1",
    }),
    cloudflare_d1_database_id: wrap("d1-0000"),
    cloudflare_d1_database_name: wrap("takos-live-db"),
    cloudflare_kv_namespace_ids: wrap({ hostname_routing: "kv-0000" }),
    object_buckets: wrap({
      worker_bundles: "takos-live-worker-bundles",
      tenant_builds: "takos-live-tenant-builds",
      tenant_source: "takos-live-tenant-source",
      git_objects: "takos-live-git-objects",
      offload: "takos-live-offload",
    }),
    queues: wrap({
      runs: "takos-live-runs",
      runs_dlq: "takos-live-runs-dlq",
      index_jobs: "takos-live-index-jobs",
      index_jobs_dlq: "takos-live-index-jobs-dlq",
      notification_push: "takos-live-notification-push",
      notification_push_dlq: "takos-live-notification-push-dlq",
    }),
    cloudflare_vectorize_index_name: wrap("takos-live-embeddings"),
    cloudflare_vectorize_index_dimensions: wrap(768),
    cloudflare_vectorize_index_metric: wrap("cosine"),
    runtime_secret_binding_names: wrap([...RUNTIME_SECRET_BINDING_NAMES]),
    runtime_secrets_provisioned: wrap(true),
    deployment_environment: wrap("staging"),
    cloudflare_worker_version_id: wrap("11111111-2222-3333-4444-555555555555"),
    ...overrides,
  };
}

test("renders every placeholder in the checked-in Wrangler template", async () => {
  const projection = renderWranglerConfig({
    template: await template(),
    outputs: parseModuleOutputs(outputsFixture()),
    containerImage: IMAGE,
  });

  const settings = projection.text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  for (const residue of [
    "replace-with-",
    "your-domain.example",
    "takosumi.example",
    "Dockerfile",
    "image_build_context",
    "[env.staging]",
  ]) {
    expect(settings).not.toContain(residue);
  }

  expect(projection.text).toContain('name = "takos-live"');
  expect(projection.text).toContain('service = "takos-live"');
  expect(projection.text).toContain('database_id = "d1-0000"');
  expect(projection.text).toContain('database_name = "takos-live-db"');
  expect(projection.text).toContain('id = "kv-0000"');
  expect(projection.text).toContain('bucket_name = "takos-live-git-objects"');
  expect(projection.text).toContain('index_name = "takos-live-embeddings"');
  expect(projection.text).toContain(`image = "${IMAGE}"`);
});

test("a queue name that prefixes another does not overwrite it", async () => {
  const projection = renderWranglerConfig({
    template: await template(),
    outputs: parseModuleOutputs(outputsFixture()),
    containerImage: IMAGE,
  });

  // `takos-runs` is a prefix of `takos-runs-dlq`; a naive sequential replace
  // renames the dead-letter queue to `<runs>-dlq` and the Worker then retries
  // into a queue nothing consumes.
  expect(projection.text).toContain('dead_letter_queue = "takos-live-runs-dlq"');
  expect(projection.text).toContain('queue = "takos-live-runs"');
  expect(projection.text).not.toContain("takos-live-runs-dlq-dlq");
  expect(projection.text).toContain(
    'dead_letter_queue = "takos-live-index-jobs-dlq"',
  );
  expect(projection.text).toContain(
    'dead_letter_queue = "takos-live-notification-push-dlq"',
  );
});

test("a custom hostname becomes a custom-domain route and turns workers.dev off", async () => {
  const projection = renderWranglerConfig({
    template: await template(),
    outputs: parseModuleOutputs(outputsFixture()),
    containerImage: IMAGE,
  });

  expect(projection.routes).toEqual(["app.example.test"]);
  expect(projection.workersDev).toBe(false);
  expect(projection.text).toContain("workers_dev = false");
  expect(projection.text).toContain('pattern = "app.example.test"');
  expect(projection.text).toContain("custom_domain = true");
});

test("a workers.dev URL keeps workers_dev and declares no route", async () => {
  const wrap = (value: unknown) => ({ sensitive: false, type: "string", value });
  const projection = renderWranglerConfig({
    template: await template(),
    outputs: parseModuleOutputs(
      outputsFixture({
        public_url: wrap("https://takos-live.example-account.workers.dev"),
        launch_url: wrap("https://takos-live.example-account.workers.dev"),
      }),
    ),
    containerImage: IMAGE,
  });

  expect(projection.routes).toEqual([]);
  expect(projection.workersDev).toBe(true);
  expect(projection.text).toContain("workers_dev = true");
  expect(projection.text).not.toContain("[[routes]]");
  expect(projection.text).not.toContain("custom_domain = true");
});

test("a published release bundle replaces the entry module and the asset directory", async () => {
  const projection = renderWranglerConfig({
    template: await template(),
    outputs: parseModuleOutputs(outputsFixture()),
    containerImage: IMAGE,
    workerBundle: {
      entrypoint: "/tmp/release/worker/index.js",
      assetsDirectory: "/tmp/release/assets",
    },
  });

  expect(projection.text).toContain('main = "/tmp/release/worker/index.js"');
  expect(projection.text).toContain("no_bundle = true");
  expect(projection.text).toContain('directory = "/tmp/release/assets"');
  expect(projection.text).not.toContain("cloudflare-entrypoint.ts");
});

test("no secret value is consumed and no secret binding is assigned", async () => {
  const projection = renderWranglerConfig({
    template: await template(),
    outputs: parseModuleOutputs(outputsFixture()),
    containerImage: IMAGE,
  });

  for (const name of RUNTIME_SECRET_BINDING_NAMES) {
    expect(projection.text).not.toMatch(new RegExp(`^\\s*${name}\\s*=`, "mu"));
    expect(projection.vars[name]).toBeUndefined();
  }
  expect(projection.text).not.toContain("BEGIN PRIVATE KEY");
});

test("a sensitive module output is refused rather than rendered", () => {
  expect(() =>
    parseModuleOutputs(
      outputsFixture({
        cloudflare_d1_database_id: {
          sensitive: true,
          type: "string",
          value: "d1-0000",
        },
      }),
    ),
  ).toThrow(/marked sensitive/u);
});

test("a module output that carries a runtime secret is refused", () => {
  const wrap = (value: unknown) => ({ sensitive: false, type: "string", value });
  expect(() =>
    parseModuleOutputs(
      outputsFixture({
        worker_env: wrap({
          ADMIN_DOMAIN: "app.example.test",
          ENCRYPTION_KEY: "f".repeat(64),
        }),
      }),
    ),
  ).toThrow(/ENCRYPTION_KEY/u);
});

test("a plain name -> value outputs file is accepted too", () => {
  const enveloped = outputsFixture();
  const plain: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(enveloped)) {
    plain[name] = (entry as { value: unknown }).value;
  }
  expect(parseModuleOutputs(plain).serviceRuntimeName).toBe("takos-live");
});

test("the retained outputs preserve the OpenTofu product environment", () => {
  expect(parseModuleOutputs(outputsFixture()).deploymentEnvironment).toBe(
    "staging",
  );
});

test("an unpinned or foreign-account container image is refused", () => {
  expect(() =>
    assertPinnedContainerImage(
      `registry.cloudflare.com/${ACCOUNT}/takos-agent:v0.12.7`,
      ACCOUNT,
    ),
  ).toThrow(/digest-pinned/u);
  expect(() => assertPinnedContainerImage(IMAGE, OTHER_ACCOUNT)).toThrow(
    /not the target account/u,
  );
  expect(() =>
    assertPinnedContainerImage("../../containers/agent/Dockerfile", ACCOUNT),
  ).toThrow(/digest-pinned/u);
  expect(() => assertPinnedContainerImage(IMAGE, ACCOUNT)).not.toThrow();
});

test("a vector index the module reshaped is refused", async () => {
  const wrap = (value: unknown) => ({ sensitive: false, type: "string", value });
  await expect(
    (async () =>
      renderWranglerConfig({
        template: await template(),
        outputs: parseModuleOutputs(
          outputsFixture({ cloudflare_vectorize_index_dimensions: wrap(1536) }),
        ),
        containerImage: IMAGE,
      }))(),
  ).rejects.toThrow(
    new RegExp(`${PRODUCT_VECTOR_INDEX.dimensions}/${PRODUCT_VECTOR_INDEX.metric}`, "u"),
  );
});

test("the product resource contract still declares the vector index this shape belongs to", async () => {
  const contract = JSON.parse(
    await readFile(
      resolve(repositoryRoot, "deploy/product-resources.json"),
      "utf8",
    ),
  ) as { resources: { name: string; shape: string }[] };
  expect(contract.resources).toContainEqual({
    name: PRODUCT_VECTOR_INDEX.resource,
    shape: "VectorIndex",
  });
});
