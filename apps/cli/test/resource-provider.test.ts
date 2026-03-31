import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  ResourceProvider,
} from "../src/lib/group-deploy/resource-provider.ts";
import { CloudflareProvider } from "../src/lib/group-deploy/providers/cloudflare.ts";
import { AWSProvider } from "../src/lib/group-deploy/providers/aws.ts";
import { GCPProvider } from "../src/lib/group-deploy/providers/gcp.ts";
import { K8sProvider } from "../src/lib/group-deploy/providers/kubernetes.ts";
import { DockerProvider } from "../src/lib/group-deploy/providers/docker.ts";
import {
  provisionResources,
  resolveProvider,
} from "../src/lib/group-deploy/provisioner.ts";

type EnvMap = Record<string, string | undefined>;

const PATH_SEPARATOR = Deno.build.os === "windows" ? ";" : ":";

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "takos-cli-resource-provider-"));
}

function removeTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function writeExecutable(dir: string, name: string, content: string): string {
  const filePath = join(dir, name);
  writeFileSync(filePath, content, { mode: 0o755 });
  chmodSync(filePath, 0o755);
  return filePath;
}

async function withEnv<T>(vars: EnvMap, fn: () => Promise<T> | T): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, Deno.env.get(key));
    if (value === undefined) {
      Deno.env.delete(key);
    } else {
      Deno.env.set(key, value);
    }
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
  }
}

async function withTempPath<T>(
  scripts: Record<string, string>,
  fn: () => Promise<T> | T,
): Promise<T> {
  const dir = createTempDir();
  try {
    for (const [name, content] of Object.entries(scripts)) {
      writeExecutable(dir, name, content);
    }

    const currentPath = Deno.env.get("PATH");
    const nextPath = currentPath
      ? `${dir}${PATH_SEPARATOR}${currentPath}`
      : dir;
    return await withEnv({ PATH: nextPath }, fn);
  } finally {
    removeTempDir(dir);
  }
}

function installFetchMock(
  handler: (request: Request) => Promise<Response> | Response,
): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    return await handler(request);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function jsonResponse(result: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify({ success: true, result }), {
    status: init?.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

const providerFactories: Array<
  { name: string; create: () => ResourceProvider }
> = [
  {
    name: "CloudflareProvider",
    create: () =>
      new CloudflareProvider({
        accountId: "test-acct",
        apiToken: "test-token",
        groupName: "app",
        env: "staging",
      }),
  },
  {
    name: "AWSProvider",
    create: () => new AWSProvider({ region: "us-east-1" }),
  },
  {
    name: "GCPProvider",
    create: () =>
      new GCPProvider({ project: "test-project", region: "us-central1" }),
  },
  {
    name: "K8sProvider",
    create: () => new K8sProvider({ namespace: "test-ns" }),
  },
  {
    name: "DockerProvider",
    create: () => new DockerProvider({ composeProject: "test" }),
  },
];

for (const { name, create } of providerFactories) {
  Deno.test(`${name} - has a name property`, () => {
    const provider = create();
    assertEquals(typeof provider.name, "string");
    assert(provider.name.length > 0);
  });

  Deno.test(`${name} - implements all required methods`, () => {
    const provider = create();
    assertEquals(typeof provider.createDatabase, "function");
    assertEquals(typeof provider.createObjectStorage, "function");
    assertEquals(typeof provider.createKeyValueStore, "function");
    assertEquals(typeof provider.createQueue, "function");
    assertEquals(typeof provider.createVectorIndex, "function");
    assertEquals(typeof provider.createSecret, "function");
    assertEquals(typeof provider.skipAutoConfigured, "function");
  });

  Deno.test(`${name} - skipAutoConfigured returns a skipped result synchronously`, () => {
    const provider = create();
    const result = provider.skipAutoConfigured(
      "test-resource",
      "durableObject",
    );
    assertEquals(result.status, "skipped");
    assertEquals(result.name, "test-resource");
    assertEquals(result.type, "durableObject");
  });
}

Deno.test("CloudflareProvider - creates a D1 database via CF API", async () => {
  const provider = new CloudflareProvider({
    accountId: "acct-123",
    apiToken: "tok-abc",
    groupName: "myapp",
    env: "staging",
  });

  const restoreFetch = installFetchMock(async (request) => {
    assertStringIncludes(request.url, "/accounts/acct-123/d1/database");
    assertEquals(await request.json(), { name: "myapp-staging-main-db" });
    return jsonResponse({ uuid: "d1-uuid-001" });
  });

  try {
    const result = await provider.createDatabase("main-db");
    assertEquals(result, {
      name: "myapp-staging-main-db",
      type: "d1",
      status: "provisioned",
      id: "d1-uuid-001",
    });
  } finally {
    restoreFetch();
  }
});

Deno.test("CloudflareProvider - creates an R2 bucket via CF API", async () => {
  const provider = new CloudflareProvider({
    accountId: "acct-123",
    apiToken: "tok-abc",
    groupName: "myapp",
    env: "staging",
  });

  const restoreFetch = installFetchMock(async (request) => {
    assertStringIncludes(request.url, "/accounts/acct-123/r2/buckets");
    assertEquals(await request.json(), { name: "myapp-staging-assets" });
    return jsonResponse({});
  });

  try {
    const result = await provider.createObjectStorage("assets");
    assertEquals(result.status, "provisioned");
    assertEquals(result.type, "r2");
    assertEquals(result.id, "myapp-staging-assets");
  } finally {
    restoreFetch();
  }
});

Deno.test("CloudflareProvider - creates a KV namespace via CF API", async () => {
  const provider = new CloudflareProvider({
    accountId: "acct-123",
    apiToken: "tok-abc",
    groupName: "myapp",
    env: "staging",
  });

  const restoreFetch = installFetchMock(async (request) => {
    assertStringIncludes(
      request.url,
      "/accounts/acct-123/storage/kv/namespaces",
    );
    assertEquals(await request.json(), { title: "myapp-staging-cache" });
    return jsonResponse({ id: "kv-id-001" });
  });

  try {
    const result = await provider.createKeyValueStore("cache");
    assertEquals(result, {
      name: "myapp-staging-cache",
      type: "kv",
      status: "provisioned",
      id: "kv-id-001",
    });
  } finally {
    restoreFetch();
  }
});

Deno.test("CloudflareProvider - creates a queue via wrangler CLI", async () => {
  const provider = new CloudflareProvider({
    accountId: "acct-123",
    apiToken: "tok-abc",
    groupName: "myapp",
    env: "staging",
  });

  await withTempPath({
    npx: `#!/usr/bin/env sh
exit 0
`,
  }, async () => {
    const result = await provider.createQueue("task-queue");
    assertEquals(result.status, "provisioned");
    assertEquals(result.id, "myapp-staging-task-queue");
  });
});

Deno.test("CloudflareProvider - reports queue as exists when wrangler exits non-zero", async () => {
  const provider = new CloudflareProvider({
    accountId: "acct-123",
    apiToken: "tok-abc",
    groupName: "myapp",
    env: "staging",
  });

  await withTempPath({
    npx: `#!/usr/bin/env sh
printf '%s' 'already exists' >&2
exit 1
`,
  }, async () => {
    const result = await provider.createQueue("task-queue");
    assertEquals(result.status, "exists");
    assertEquals(result.id, "myapp-staging-task-queue");
  });
});

Deno.test("CloudflareProvider - creates a vectorize index via wrangler CLI", async () => {
  const provider = new CloudflareProvider({
    accountId: "acct-123",
    apiToken: "tok-abc",
    groupName: "myapp",
    env: "staging",
  });

  await withTempPath({
    npx: `#!/usr/bin/env sh
exit 0
`,
  }, async () => {
    const result = await provider.createVectorIndex("embeddings", {
      dimensions: 768,
      metric: "euclidean",
    });

    assertEquals(result.status, "provisioned");
    assertEquals(result.id, "myapp-staging-embeddings");
  });
});

Deno.test("CloudflareProvider - creates a secret with a random hex value", () => {
  const provider = new CloudflareProvider({
    accountId: "acct-123",
    apiToken: "tok-abc",
    groupName: "myapp",
    env: "staging",
  });

  const result = provider.createSecret("api-key", "API_KEY");

  return result.then((secret) => {
    assertEquals(secret.status, "provisioned");
    assertEquals(secret.type, "secretRef");
    assert(/^([0-9a-f]{64})$/.test(secret.id ?? ""));
  });
});

Deno.test("CloudflareProvider - skipAutoConfigured returns skipped with message", () => {
  const provider = new CloudflareProvider({
    accountId: "acct-123",
    apiToken: "tok-abc",
    groupName: "myapp",
    env: "staging",
  });

  const result = provider.skipAutoConfigured("my-do", "durableObject");
  assertEquals(result.status, "skipped");
  assertStringIncludes(result.error ?? "", "wrangler deploy");
});

Deno.test("resolveProvider - returns CloudflareProvider when accountId and apiToken are provided", async () => {
  await withEnv(
    {
      AWS_ACCESS_KEY_ID: undefined,
      GOOGLE_APPLICATION_CREDENTIALS: undefined,
      KUBECONFIG: undefined,
    },
    () => {
      const provider = resolveProvider({
        groupName: "app",
        env: "staging",
        accountId: "acct",
        apiToken: "tok",
      });
      assertEquals(provider.name, "cloudflare");
      assert(provider instanceof CloudflareProvider);
    },
  );
});

Deno.test("resolveProvider - returns AWSProvider when AWS_ACCESS_KEY_ID is set", async () => {
  await withEnv(
    {
      AWS_ACCESS_KEY_ID: "AKID123",
      GOOGLE_APPLICATION_CREDENTIALS: undefined,
      KUBECONFIG: undefined,
    },
    () => {
      const provider = resolveProvider({ groupName: "app", env: "staging" });
      assertEquals(provider.name, "aws");
      assert(provider instanceof AWSProvider);
    },
  );
});

Deno.test("resolveProvider - returns GCPProvider when GOOGLE_APPLICATION_CREDENTIALS is set", async () => {
  await withEnv(
    {
      AWS_ACCESS_KEY_ID: undefined,
      GOOGLE_APPLICATION_CREDENTIALS: "/path/to/creds.json",
      KUBECONFIG: undefined,
    },
    () => {
      const provider = resolveProvider({ groupName: "app", env: "staging" });
      assertEquals(provider.name, "gcp");
      assert(provider instanceof GCPProvider);
    },
  );
});

Deno.test("resolveProvider - returns K8sProvider when KUBECONFIG is set", async () => {
  await withEnv(
    {
      AWS_ACCESS_KEY_ID: undefined,
      GOOGLE_APPLICATION_CREDENTIALS: undefined,
      KUBECONFIG: "/path/to/kubeconfig",
    },
    () => {
      const provider = resolveProvider({ groupName: "app", env: "staging" });
      assertEquals(provider.name, "k8s");
      assert(provider instanceof K8sProvider);
    },
  );
});

Deno.test("resolveProvider - falls back to DockerProvider when no cloud env is detected", async () => {
  await withEnv(
    {
      AWS_ACCESS_KEY_ID: undefined,
      GOOGLE_APPLICATION_CREDENTIALS: undefined,
      KUBECONFIG: undefined,
    },
    () => {
      const provider = resolveProvider({ groupName: "app", env: "staging" });
      assertEquals(provider.name, "docker");
      assert(provider instanceof DockerProvider);
    },
  );
});

Deno.test("resolveProvider - prefers Cloudflare over AWS when both are available", async () => {
  await withEnv(
    {
      AWS_ACCESS_KEY_ID: "AKID123",
      GOOGLE_APPLICATION_CREDENTIALS: undefined,
      KUBECONFIG: undefined,
    },
    () => {
      const provider = resolveProvider({
        groupName: "app",
        env: "staging",
        accountId: "acct",
        apiToken: "tok",
      });
      assertEquals(provider.name, "cloudflare");
    },
  );
});

Deno.test("resolveProvider - prefers AWS over GCP when both env vars are set", async () => {
  await withEnv(
    {
      AWS_ACCESS_KEY_ID: "AKID123",
      GOOGLE_APPLICATION_CREDENTIALS: "/path/to/creds.json",
      KUBECONFIG: undefined,
    },
    () => {
      const provider = resolveProvider({ groupName: "app", env: "staging" });
      assertEquals(provider.name, "aws");
    },
  );
});

Deno.test("provisionResources (with CloudflareProvider) - provisions mixed resource types through the provider", async () => {
  await withTempPath({
    npx: `#!/usr/bin/env sh
exit 0
`,
  }, async () => {
    const restoreFetch = installFetchMock(async (request) => {
      const path = new URL(request.url).pathname;
      if (path.endsWith("/d1/database")) {
        return jsonResponse({ uuid: "d1-id" });
      }
      if (path.endsWith("/r2/buckets")) {
        return jsonResponse({});
      }
      if (path.endsWith("/storage/kv/namespaces")) {
        return jsonResponse({ id: "kv-id" });
      }
      throw new Error(`Unexpected fetch path: ${path}`);
    });

    try {
      const resources = {
        "main-db": { type: "d1", binding: "DB" },
        assets: { type: "r2" },
        cache: { type: "kv" },
        "my-do": { type: "durableObject" },
      };

      const { provisioned, results } = await provisionResources(resources, {
        accountId: "acct",
        apiToken: "tok",
        groupName: "app",
        env: "staging",
      });

      assertEquals(provisioned.size, 4);
      assertEquals(results.length, 4);

      const d1Result = results.find((r) => r.name === "main-db");
      assertEquals(d1Result?.status, "provisioned");
      assertEquals(d1Result?.id, "d1-id");

      const r2Result = results.find((r) => r.name === "assets");
      assertEquals(r2Result?.status, "provisioned");

      const kvResult = results.find((r) => r.name === "cache");
      assertEquals(kvResult?.status, "provisioned");
      assertEquals(kvResult?.id, "kv-id");

      const doResult = results.find((r) => r.name === "my-do");
      assertEquals(doResult?.status, "skipped");
    } finally {
      restoreFetch();
    }
  });
});

Deno.test("provisionResources (with CloudflareProvider) - canonicalizes portable-style resource aliases before provisioning", async () => {
  await withTempPath({
    npx: `#!/usr/bin/env sh
exit 0
`,
  }, async () => {
    const restoreFetch = installFetchMock(async (request) => {
      const path = new URL(request.url).pathname;
      if (path.endsWith("/d1/database")) {
        return jsonResponse({ uuid: "sql-id" });
      }
      if (path.endsWith("/r2/buckets")) {
        return jsonResponse({});
      }
      if (path.endsWith("/storage/kv/namespaces")) {
        return jsonResponse({ id: "kv-id" });
      }
      return jsonResponse({});
    });

    try {
      const resources = {
        "main-db": { type: "sql", binding: "DB" },
        assets: { type: "object_store" },
        cache: { type: "kv" },
        embeddings: {
          type: "vector_index",
          vectorize: { dimensions: 1536, metric: "cosine" },
        },
        "api-secret": { type: "secret" },
      };

      const { provisioned, results } = await provisionResources(resources, {
        accountId: "acct",
        apiToken: "tok",
        groupName: "app",
        env: "staging",
      });

      assertEquals(provisioned.size, 5);
      assertEquals(results.length, 5);

      assertEquals(provisioned.get("main-db")?.type, "d1");
      assertEquals(provisioned.get("assets")?.type, "r2");
      assertEquals(provisioned.get("embeddings")?.type, "vectorize");
      assertEquals(
        results.find((result) => result.name === "api-secret")?.type,
        "secretRef",
      );
    } finally {
      restoreFetch();
    }
  });
});

Deno.test("provisionResources (with CloudflareProvider) - dry-run mode skips actual provisioning", async () => {
  const resources = {
    "main-db": { type: "d1" },
    assets: { type: "r2" },
  };

  const { provisioned, results } = await provisionResources(resources, {
    accountId: "acct",
    apiToken: "tok",
    groupName: "app",
    env: "staging",
    dryRun: true,
  });

  assertEquals(provisioned.size, 2);
  assertEquals(results.length, 2);
  assertEquals(results.every((r) => r.status === "provisioned"), true);
  assertEquals(results.every((r) => r.id?.startsWith("(dry-run)")), true);
});

Deno.test("provisionResources (with CloudflareProvider) - handles provider errors gracefully", async () => {
  const restoreFetch = installFetchMock(async () => {
    throw new Error("CF API 503");
  });

  try {
    const resources = {
      "main-db": { type: "d1" },
    };

    const { results } = await provisionResources(resources, {
      accountId: "acct",
      apiToken: "tok",
      groupName: "app",
      env: "staging",
    });

    assertEquals(results.length, 1);
    assertEquals(results[0].status, "failed");
    assertStringIncludes(results[0].error ?? "", "CF API 503");
  } finally {
    restoreFetch();
  }
});

Deno.test("provisionResources (with CloudflareProvider) - reports unsupported resource type as failed", async () => {
  const resources = {
    mystery: { type: "unknown-thing" },
  };

  const { results } = await provisionResources(resources, {
    accountId: "acct",
    apiToken: "tok",
    groupName: "app",
    env: "staging",
  });

  assertEquals(results.length, 1);
  assertEquals(results[0].status, "failed");
  assertStringIncludes(results[0].error ?? "", "Unsupported resource type");
});

Deno.test("Non-Cloudflare providers graceful failure - AWSProvider handles missing aws CLI", async () => {
  await withTempPath({}, async () => {
    const provider = new AWSProvider();
    const result = await provider.createDatabase("test-db");
    assertEquals(result.status, "failed");
    assertStringIncludes(result.error ?? "", "not available");
  });
});

Deno.test("Non-Cloudflare providers graceful failure - GCPProvider handles missing gcloud CLI", async () => {
  await withTempPath({}, async () => {
    const provider = new GCPProvider({ project: "test" });
    const result = await provider.createDatabase("test-db");
    assertEquals(result.status, "failed");
    assertStringIncludes(result.error ?? "", "not available");
  });
});

Deno.test("Non-Cloudflare providers graceful failure - K8sProvider handles missing kubectl CLI", async () => {
  await withTempPath({}, async () => {
    const provider = new K8sProvider();
    const result = await provider.createDatabase("test-db");
    assertEquals(result.status, "failed");
    assertStringIncludes(result.error ?? "", "not available");
  });
});

Deno.test("Non-Cloudflare providers graceful failure - DockerProvider handles missing docker CLI", async () => {
  await withTempPath({}, async () => {
    const provider = new DockerProvider();
    const result = await provider.createDatabase("test-db");
    assertEquals(result.status, "failed");
    assertStringIncludes(result.error ?? "", "not available");
  });
});
