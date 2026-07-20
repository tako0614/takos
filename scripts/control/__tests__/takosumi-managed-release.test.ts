import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  managedReleaseSettings,
  readManagedReleaseConfig,
  readManagedReleaseSecrets,
  releaseTakosumiManagedEdgeWorker,
} from "../takosumi-managed-release.mjs";

const WORKSPACE = "workspace_1";
const RESOURCE = "takos";
const ARCHIVE_REF = "cloud-edge-worker-artifact:v3:archive";
const MANIFEST_REF = "cloud-edge-worker-artifact:v3:manifest";
const VERSION_DIGEST = `sha256:${"c".repeat(64)}`;
const DEPLOYMENT_DIGEST = `sha256:${"d".repeat(64)}`;
const VERSION_ID = `ewv_${"c".repeat(64)}`;
const DEPLOYMENT_ID = `ewd_${"d".repeat(64)}`;

test("managed Takos release stages exact bytes and confirms only canonical Ready", async () => {
  const fixture = makeFixture({ secretNames: ["SESSION_SECRET"] });
  try {
    const archiveBytes = new TextEncoder().encode("exact worker archive");
    writeFileSync(fixture.archive, archiveBytes, { mode: 0o600 });
    const archiveDigest = await sha256(archiveBytes);
    const manifestBody = JSON.stringify({
      kind: "takosumi.cloud-edge-worker-materialization@v1",
      deployment: {
        id: DEPLOYMENT_ID,
        digest: DEPLOYMENT_DIGEST,
        state: "promotion_pending",
      },
      versions: [{ id: VERSION_ID, digest: VERSION_DIGEST }],
    });
    const manifestDigest = `sha256:${await sha256(
      new TextEncoder().encode(manifestBody),
    )}`;
    const calls: Array<{
      method: string;
      path: string;
      headers: Headers;
      body: Uint8Array;
    }> = [];
    const fetchImpl = async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      const body = await requestBytes(init?.body);
      calls.push({
        method: init?.method ?? "GET",
        path: url.pathname,
        headers,
        body,
      });
      expect(headers.get("authorization")).toBe(
        "Bearer test-access-token-value",
      );

      if (url.pathname.endsWith(`/edge-worker-releases/${RESOURCE}`)) {
        return json({ versions: [], deployments: [], secrets: [] });
      }
      if (url.pathname.endsWith("/artifacts")) {
        const purpose = headers.get("x-takosumi-artifact-purpose");
        const expected = headers.get("x-takosumi-artifact-sha256");
        const ref = purpose === "worker_release" ? ARCHIVE_REF : MANIFEST_REF;
        return json({
          artifact: {
            purpose,
            ref,
            digest: expected,
            sizeBytes: body.byteLength,
          },
          run: {
            id: "run_artifact_1",
            type: "artifact",
            resourceOperation: "artifact",
            status: "succeeded",
          },
          replayed: false,
        });
      }
      if (url.pathname.endsWith("/secrets/SESSION_SECRET")) {
        expect(JSON.parse(new TextDecoder().decode(body))).toEqual({
          value: "never-return-this-secret",
        });
        return json({
          secret: {
            name: "SESSION_SECRET",
            versionRef: "secret_version_1",
            updatedAt: "2026-07-20T00:00:00.000Z",
          },
        });
      }
      if (url.pathname.endsWith("/materialize")) {
        const request = JSON.parse(new TextDecoder().decode(body));
        expect(request).toMatchObject({
          archiveRef: ARCHIVE_REF,
          archiveSha256: `sha256:${archiveDigest}`,
          compatibilityDate: "2026-07-20",
          secretNames: ["SESSION_SECRET"],
        });
        expect(JSON.stringify(request)).not.toContain(
          "never-return-this-secret",
        );
        expect(JSON.stringify(request)).not.toContain("ts_acc_managed");
        return json({
          materialization: {
            kind: "takosumi.cloud-edge-worker-bundle-materialization@v1",
            archive: {
              ref: ARCHIVE_REF,
              sha256: `sha256:${archiveDigest}`,
            },
            version: { id: VERSION_ID, digest: VERSION_DIGEST },
            deployment: {
              id: DEPLOYMENT_ID,
              digest: DEPLOYMENT_DIGEST,
              state: "promotion_pending",
            },
            manifestPurpose: "worker_release_manifest",
            manifestContentType:
              "application/vnd.takosumi.cloud-edge-worker-release+json",
            manifestBody,
            manifestSha256: manifestDigest,
          },
        });
      }
      if (url.pathname === "/v1/resources/preview") {
        const desired = JSON.parse(new TextDecoder().decode(body));
        return json({
          resource: resource(desired.spec.source, "Planning", 0, 0),
          planDigest: `sha256:${"a".repeat(64)}`,
          quote: {
            quoteId: "quote_1",
            quoteDigest: `sha256:${"b".repeat(64)}`,
          },
        });
      }
      if (url.pathname === `/v1/resources/EdgeWorker/${RESOURCE}`) {
        const desired = JSON.parse(new TextDecoder().decode(body));
        expect(desired.review).toEqual({
          planDigest: `sha256:${"a".repeat(64)}`,
          quoteId: "quote_1",
          quoteDigest: `sha256:${"b".repeat(64)}`,
        });
        return json(resource(desired.spec.source, "Ready", 1, 1));
      }
      if (url.pathname.endsWith(`/deployments/${DEPLOYMENT_ID}/confirm`)) {
        expect(JSON.parse(new TextDecoder().decode(body))).toEqual({
          manifestRef: MANIFEST_REF,
          manifestSha256: manifestDigest,
        });
        return json({
          deployment: {
            id: DEPLOYMENT_ID,
            digest: DEPLOYMENT_DIGEST,
            state: "active",
            canonicalResourceEtag: '"resource-generation-1"',
          },
        });
      }
      return json({ error: "not_found" }, 404);
    };

    const result = await releaseTakosumiManagedEdgeWorker({
      outputs: {
        cloudflare_account_id: "ts_acc_managed",
        service_runtime_name: RESOURCE,
        worker_env: { PUBLIC_VALUE: "ordinary" },
        launch_url: "https://takos.example.test",
      },
      environment: "production",
      artifactConfig: { file: fixture.archive, sha256: archiveDigest },
      env: fixture.env,
      fetchImpl: fetchImpl as typeof fetch,
      wait: async () => {},
      cwd: resolve(import.meta.dir, "../../.."),
    });

    expect(result).toMatchObject({
      mode: "takosumi-managed",
      archive: { sha256: `sha256:${archiveDigest}` },
      manifest: { ref: MANIFEST_REF, sha256: manifestDigest },
      deployment: { id: DEPLOYMENT_ID, state: "active" },
      resource: { generation: 1, phase: "Ready" },
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      `GET /v1/cloud/edge-worker-releases/${RESOURCE}`,
      `POST /v1/resources/EdgeWorker/${RESOURCE}/artifacts`,
      `PUT /v1/cloud/edge-worker-releases/${RESOURCE}/secrets/SESSION_SECRET`,
      `POST /v1/cloud/edge-worker-releases/${RESOURCE}/materialize`,
      `POST /v1/resources/EdgeWorker/${RESOURCE}/artifacts`,
      "POST /v1/resources/preview",
      `PUT /v1/resources/EdgeWorker/${RESOURCE}`,
      `POST /v1/cloud/edge-worker-releases/${RESOURCE}/deployments/${DEPLOYMENT_ID}/confirm`,
    ]);
    expect(
      calls.filter((call) =>
        new TextDecoder()
          .decode(call.body)
          .includes("never-return-this-secret"),
      ),
    ).toHaveLength(1);
  } finally {
    fixture.cleanup();
  }
});

test("managed Takos release leaves promotion unconfirmed when canonical Ready is not exact", async () => {
  const fixture = makeFixture({ secretNames: [] });
  try {
    const archiveBytes = new TextEncoder().encode("archive");
    writeFileSync(fixture.archive, archiveBytes, { mode: 0o600 });
    const archiveDigest = await sha256(archiveBytes);
    const manifestBody = JSON.stringify({
      kind: "takosumi.cloud-edge-worker-materialization@v1",
      deployment: {
        id: DEPLOYMENT_ID,
        digest: DEPLOYMENT_DIGEST,
        state: "promotion_pending",
      },
      versions: [{ id: VERSION_ID, digest: VERSION_DIGEST }],
    });
    const manifestDigest = `sha256:${await sha256(
      new TextEncoder().encode(manifestBody),
    )}`;
    let confirmed = false;
    const fetchImpl = async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      const body = await requestBytes(init?.body);
      if (url.pathname.endsWith(`/edge-worker-releases/${RESOURCE}`)) {
        return json({ versions: [], deployments: [], secrets: [] });
      }
      if (url.pathname.endsWith("/artifacts")) {
        const purpose = headers.get("x-takosumi-artifact-purpose");
        return json({
          artifact: {
            purpose,
            ref: purpose === "worker_release" ? ARCHIVE_REF : MANIFEST_REF,
            digest: headers.get("x-takosumi-artifact-sha256"),
            sizeBytes: body.byteLength,
          },
          run: {
            type: "artifact",
            resourceOperation: "artifact",
            status: "succeeded",
          },
          replayed: false,
        });
      }
      if (url.pathname.endsWith("/materialize")) {
        return json({
          materialization: {
            kind: "takosumi.cloud-edge-worker-bundle-materialization@v1",
            archive: {
              ref: ARCHIVE_REF,
              sha256: `sha256:${archiveDigest}`,
            },
            version: { id: VERSION_ID, digest: VERSION_DIGEST },
            deployment: {
              id: DEPLOYMENT_ID,
              digest: DEPLOYMENT_DIGEST,
              state: "promotion_pending",
            },
            manifestPurpose: "worker_release_manifest",
            manifestContentType:
              "application/vnd.takosumi.cloud-edge-worker-release+json",
            manifestBody,
            manifestSha256: manifestDigest,
          },
        });
      }
      if (url.pathname === "/v1/resources/preview") {
        return json({
          resource: resource(
            { artifactRef: MANIFEST_REF, artifactSha256: manifestDigest },
            "Planning",
            0,
            0,
          ),
          planDigest: `sha256:${"a".repeat(64)}`,
        });
      }
      if (url.pathname === `/v1/resources/EdgeWorker/${RESOURCE}`) {
        return json(
          resource(
            { artifactRef: MANIFEST_REF, artifactSha256: manifestDigest },
            "Applying",
            1,
            0,
          ),
        );
      }
      if (url.pathname.endsWith("/confirm")) confirmed = true;
      return json({ error: "unexpected" }, 500);
    };

    await expect(
      releaseTakosumiManagedEdgeWorker({
        outputs: {
          cloudflare_account_id: "ts_acc_managed",
          service_runtime_name: RESOURCE,
        },
        environment: "production",
        artifactConfig: { file: fixture.archive, sha256: archiveDigest },
        env: {
          ...fixture.env,
          TAKOS_MANAGED_RELEASE_READY_ATTEMPTS: "1",
        },
        fetchImpl: fetchImpl as typeof fetch,
        wait: async () => {},
        cwd: resolve(import.meta.dir, "../../.."),
      }),
    ).rejects.toThrow(/promotion remains unconfirmed/u);
    expect(confirmed).toBe(false);
  } finally {
    fixture.cleanup();
  }
});

test("managed Takos release rejects a manifest that does not exactly bind materialization", async () => {
  const fixture = makeFixture({ secretNames: [] });
  try {
    const archiveBytes = new TextEncoder().encode("archive");
    writeFileSync(fixture.archive, archiveBytes, { mode: 0o600 });
    const archiveDigest = await sha256(archiveBytes);
    const manifestBody = JSON.stringify({
      kind: "takosumi.cloud-edge-worker-materialization@v1",
      deployment: {
        id: DEPLOYMENT_ID,
        digest: `sha256:${"f".repeat(64)}`,
        state: "promotion_pending",
      },
      versions: [{ id: VERSION_ID, digest: VERSION_DIGEST }],
    });
    const manifestDigest = `sha256:${await sha256(
      new TextEncoder().encode(manifestBody),
    )}`;
    let previewed = false;
    const fetchImpl = async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      const body = await requestBytes(init?.body);
      if (url.pathname.endsWith(`/edge-worker-releases/${RESOURCE}`)) {
        return json({ versions: [], deployments: [], secrets: [] });
      }
      if (url.pathname.endsWith("/artifacts")) {
        return json({
          artifact: {
            purpose: "worker_release",
            ref: ARCHIVE_REF,
            digest: headers.get("x-takosumi-artifact-sha256"),
            sizeBytes: body.byteLength,
          },
          run: {
            type: "artifact",
            resourceOperation: "artifact",
            status: "succeeded",
          },
          replayed: false,
        });
      }
      if (url.pathname.endsWith("/materialize")) {
        return json({
          materialization: {
            kind: "takosumi.cloud-edge-worker-bundle-materialization@v1",
            archive: {
              ref: ARCHIVE_REF,
              sha256: `sha256:${archiveDigest}`,
            },
            version: { id: VERSION_ID, digest: VERSION_DIGEST },
            deployment: {
              id: DEPLOYMENT_ID,
              digest: DEPLOYMENT_DIGEST,
              state: "promotion_pending",
            },
            manifestPurpose: "worker_release_manifest",
            manifestContentType:
              "application/vnd.takosumi.cloud-edge-worker-release+json",
            manifestBody,
            manifestSha256: manifestDigest,
          },
        });
      }
      if (url.pathname === "/v1/resources/preview") previewed = true;
      return json({ error: "unexpected" }, 500);
    };

    await expect(
      releaseTakosumiManagedEdgeWorker({
        outputs: {
          cloudflare_account_id: "ts_acc_managed",
          service_runtime_name: RESOURCE,
        },
        environment: "production",
        artifactConfig: { file: fixture.archive, sha256: archiveDigest },
        env: fixture.env,
        fetchImpl: fetchImpl as typeof fetch,
        wait: async () => {},
        cwd: resolve(import.meta.dir, "../../.."),
      }),
    ).rejects.toThrow(/does not exactly bind/u);
    expect(previewed).toBe(false);
  } finally {
    fixture.cleanup();
  }
});

test("managed config uses canonical runtime_binding connections without provider ids", () => {
  const root = mkdtempSync(join(tmpdir(), "takos-managed-config-"));
  try {
    const configPath = join(root, "config.json");
    const resourceUid = `tkrn:${WORKSPACE}:SQLDatabase:primary`;
    writeFileSync(
      configPath,
      JSON.stringify({
        kind: "takos.managed-edge-worker-release@v1",
        compatibilityDate: "2026-07-20",
        connections: {
          DB: {
            resource: resourceUid,
            permissions: ["read", "write"],
            projection: "runtime_binding",
          },
        },
        resources: [
          {
            name: "DB",
            resource: {
              space: WORKSPACE,
              kind: "SQLDatabase",
              name: "primary",
              uid: resourceUid,
              observedGeneration: 1,
              etag: '"resource-generation-1"',
              nativeResources: [],
            },
          },
        ],
      }),
    );

    const config = readManagedReleaseConfig(
      configPath,
      {},
      resolve(import.meta.dir, "../../.."),
    );
    expect(config.connections).toEqual({
      DB: {
        resource: resourceUid,
        permissions: ["read", "write"],
        projection: "runtime_binding",
      },
    });
    expect(JSON.stringify(config)).not.toContain("cloudflare_d1_database");
    expect(() =>
      readManagedReleaseConfig(
        configPath,
        {
          worker_env: {
            sensitive: true,
            value: { PASSWORD: "must-not-be-projected" },
          },
        },
        resolve(import.meta.dir, "../../.."),
      ),
    ).toThrow(/cannot project sensitive output worker_env/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("managed credential files must be private and outside the repository", () => {
  const root = mkdtempSync(join(tmpdir(), "takos-managed-secret-mode-"));
  try {
    const path = join(root, "secrets.json");
    writeFileSync(path, "{}", { mode: 0o644 });
    expect(() => readManagedReleaseSecrets(path)).toThrow(/mode 0600/u);
    chmodSync(path, 0o400);
    expect(() => readManagedReleaseSecrets(path)).toThrow(/mode 0600/u);
    chmodSync(path, 0o600);
    expect(readManagedReleaseSecrets(path)).toEqual({});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("managed release settings require explicit stable operator coordinates", () => {
  expect(() =>
    managedReleaseSettings(
      { service_runtime_name: RESOURCE },
      "production",
      {},
    ),
  ).toThrow(/TAKOS_MANAGED_RELEASE_URL/u);
  expect(() =>
    managedReleaseSettings({ service_runtime_name: RESOURCE }, "production", {
      TAKOS_MANAGED_RELEASE_URL: "https://app.takosumi.test/api",
      TAKOS_MANAGED_RELEASE_WORKSPACE_ID: WORKSPACE,
      TAKOS_MANAGED_RELEASE_ACCESS_TOKEN_FILE: "/tmp/token",
      TAKOS_MANAGED_RELEASE_CONFIG_FILE: "/tmp/config",
      TAKOS_MANAGED_RELEASE_IDEMPOTENCY_KEY: "candidate-1",
    }),
  ).toThrow(/bare origin/u);
});

function makeFixture(input: { secretNames: string[] }) {
  const root = mkdtempSync(join(tmpdir(), "takos-managed-release-"));
  const archive = join(root, "release.tar.gz");
  const token = join(root, "token");
  const config = join(root, "config.json");
  const secrets = join(root, "secrets.json");
  writeFileSync(token, "test-access-token-value\n", { mode: 0o600 });
  writeFileSync(
    config,
    JSON.stringify({
      kind: "takos.managed-edge-worker-release@v1",
      compatibilityDate: "2026-07-20",
      compatibilityFlags: ["nodejs_compat"],
      vars: [{ type: "plain_text", name: "CONFIG_VALUE", text: "exact" }],
      resources: [],
      secretNames: input.secretNames,
      profiles: ["static_assets"],
      observability: { enabled: true, headSamplingRate: 0.1 },
    }),
  );
  writeFileSync(
    secrets,
    JSON.stringify(
      input.secretNames.length > 0
        ? { SESSION_SECRET: "never-return-this-secret" }
        : {},
    ),
    { mode: 0o600 },
  );
  return {
    root,
    archive,
    env: {
      TAKOS_MANAGED_RELEASE_URL: "https://app.takosumi.test",
      TAKOS_MANAGED_RELEASE_WORKSPACE_ID: WORKSPACE,
      TAKOS_MANAGED_RELEASE_ACCESS_TOKEN_FILE: token,
      TAKOS_MANAGED_RELEASE_CONFIG_FILE: config,
      TAKOS_MANAGED_RELEASE_SECRETS_FILE: secrets,
      TAKOS_MANAGED_RELEASE_IDEMPOTENCY_KEY: "release-candidate-1",
      TAKOS_MANAGED_RELEASE_READY_INTERVAL_MS: "0",
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function resource(
  source: { artifactRef: string; artifactSha256: string },
  phase: string,
  generation: number,
  observedGeneration: number,
) {
  return {
    id: `tkrn:${WORKSPACE}:EdgeWorker:${RESOURCE}`,
    apiVersion: "takosumi.dev/v1alpha1",
    kind: "EdgeWorker",
    metadata: {
      name: RESOURCE,
      space: WORKSPACE,
      generation,
      managedBy: "opentofu",
    },
    spec: {
      name: RESOURCE,
      source,
      compatibilityDate: "2026-07-20",
      compatibilityFlags: ["nodejs_compat"],
      profiles: ["static_assets"],
    },
    status: { phase, observedGeneration },
  };
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function requestBytes(body: BodyInit | null | undefined) {
  if (body === undefined || body === null) return new Uint8Array();
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  return new Uint8Array(await new Response(body).arrayBuffer());
}

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
