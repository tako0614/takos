import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sha256Bytes } from "./release-candidate-contract.ts";
import {
  SURFACE_ID,
  assertDistinctTargets,
  assertManagedPublicRouteAbsent,
  digestJson,
  ensureManagedPublicRoute,
  healthReadback,
  localQualification,
  managedEvidence,
  managedTarget,
  readManagedPublicRoute,
  type CandidateContext,
  type ManagedTarget,
  type ReleaseEnvelope,
} from "./release-managed-safety.ts";

const roots: string[] = [];
const originalOperatorRoot = process.env.TAKOS_RELEASE_SAFETY_OPERATOR_ROOT;

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
  if (originalOperatorRoot === undefined) {
    delete process.env.TAKOS_RELEASE_SAFETY_OPERATOR_ROOT;
  } else {
    process.env.TAKOS_RELEASE_SAFETY_OPERATOR_ROOT = originalOperatorRoot;
  }
});

function digest(character: string): string {
  return `sha256:${character.repeat(64)}`;
}

function target(
  workspaceId: string,
  resourceName: string,
  healthPath = "/health",
): ManagedTarget {
  return {
    paths: {} as ManagedTarget["paths"],
    outputsText: "{}",
    outputs: {},
    origin: "https://operator.example.test",
    workspaceId,
    resourceName,
    accessFile: "/operator/access",
    configFile: "/operator/config",
    secretsFile: "/operator/secrets",
    healthPath,
  };
}

describe("managed Takos release safety", () => {
  test("requires staging and replica to be distinct canonical targets", () => {
    const staging = target("workspace-staging", "takos-staging");
    const replica = target("workspace-replica", "takos-replica");
    expect(() => assertDistinctTargets(staging, replica)).not.toThrow();
    expect(() =>
      assertDistinctTargets(
        staging,
        target(staging.workspaceId, replica.resourceName),
      ),
    ).toThrow("Workspace identities must be distinct");
  });

  test("binds exact managed Ready and active deployment evidence", () => {
    const candidate = {
      manifest: {
        releaseAssets: [
          {
            name: "takos-worker-release.tar.gz",
            digest: digest("1"),
          },
        ],
        ociImages: [
          {
            name: "takos-agent",
            cloudflareRegistryDigest: digest("2"),
          },
          {
            name: "takos-worker-runtime",
            cloudflareRegistryDigest: digest("3"),
          },
        ],
      },
    } as unknown as CandidateContext;
    const activation = {
      managed: {
        mode: "takosumi-managed",
        archive: { sha256: digest("1"), sizeBytes: 123 },
        manifest: { ref: "artifact:manifest", sha256: digest("4") },
        version: { id: `ewv_${"5".repeat(64)}`, digest: digest("5") },
        deployment: {
          id: `ewd_${"6".repeat(64)}`,
          digest: digest("6"),
          state: "active",
          canonicalResourceEtag: '"resource-etag"',
        },
        resource: {
          id: "tkrn:workspace-replica:EdgeWorker:takos-replica",
          generation: 1,
          phase: "Ready",
        },
      },
    };
    const evidence = managedEvidence({
      candidate,
      activation,
      route: {
        healthUrl: "https://replica.example.test/health",
        digest: digest("8"),
      },
      health: { status: 200, digest: digest("7") },
    });
    expect(evidence.resourceId).toBe(
      "tkrn:workspace-replica:EdgeWorker:takos-replica",
    );
    expect(evidence.evidence).toMatchObject({
      archiveDigest: digest("1"),
      executorRegistryDigest: digest("2"),
      runtimeRegistryDigest: digest("3"),
      managedDeploymentDigest: digest("6"),
      resourceGeneration: 1,
      publicRouteDigest: digest("8"),
      healthStatus: 200,
    });
    expect(() =>
      managedEvidence({
        candidate,
        activation: {
          managed: {
            ...activation.managed,
            resource: { ...activation.managed.resource, phase: "Pending" },
          },
        },
        route: {
          healthUrl: "https://replica.example.test/health",
          digest: digest("8"),
        },
        health: { status: 200, digest: digest("7") },
      }),
    ).toThrow("not exact Ready");
  });

  test("loads only 0600 operator files and validates an absolute health path", () => {
    const root = mkdtempSync(join(tmpdir(), "takos-managed-policy-"));
    roots.push(root);
    chmodSync(root, 0o700);
    const directory = join(root, "takos-release-artifacts", "replica");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(join(root, "takos-release-artifacts"), 0o700);
    chmodSync(directory, 0o700);
    const files: Record<string, string> = {
      "outputs.json": JSON.stringify({
        cloudflare_account_id: { value: "ts_acc_replica" },
        service_runtime_name: { value: "takos-replica" },
      }),
      "managed-origin": "https://app.operator.example.test\n",
      "workspace-id": "workspace-replica\n",
      "access-token": "a".repeat(32),
      "managed-config.json": JSON.stringify({
        kind: "takos.managed-edge-worker-release@v1",
      }),
      "managed-secrets.json": "{}",
      "health-path": "/health\n",
    };
    for (const [name, body] of Object.entries(files)) {
      const path = join(directory, name);
      writeFileSync(path, body, { mode: 0o600 });
      chmodSync(path, 0o600);
    }
    process.env.TAKOS_RELEASE_SAFETY_OPERATOR_ROOT = root;
    expect(managedTarget("replica")).toMatchObject({
      workspaceId: "workspace-replica",
      resourceName: "takos-replica",
      healthPath: "/health",
    });
    writeFileSync(join(directory, "health-path"), "https://takos.jp/health\n", {
      mode: 0o600,
    });
    expect(() => managedTarget("replica")).toThrow("absolute wildcard-free");
    writeFileSync(join(directory, "health-path"), "//example.test/health\n", {
      mode: 0o600,
    });
    expect(() => managedTarget("replica")).toThrow("absolute wildcard-free");
  });

  test("retries bounded transient network and HTTP health failures", async () => {
    const attempts: string[] = [];
    const fetchImpl = (async () => {
      attempts.push("fetch");
      if (attempts.length === 1) throw new TypeError("network unavailable");
      if (attempts.length === 2) {
        return new Response("pending", { status: 503 });
      }
      return Response.json({ ok: true });
    }) as unknown as typeof fetch;
    const waits: number[] = [];
    const result = await healthReadback("https://replica.example.test/health", {
      fetchImpl,
      wait: async (milliseconds) => {
        waits.push(milliseconds);
      },
      timeoutMs: 5_000,
    });
    expect(result.status).toBe(200);
    expect(attempts).toHaveLength(3);
    expect(waits).toHaveLength(2);
  });

  test("materializes and reuses the exact Resource-owned public route", async () => {
    const root = mkdtempSync(join(tmpdir(), "takos-managed-route-"));
    roots.push(root);
    chmodSync(root, 0o700);
    const accessFile = join(root, "access-token");
    writeFileSync(accessFile, "a".repeat(32), { mode: 0o600 });
    chmodSync(accessFile, 0o600);
    const managed = {
      ...target("workspace-replica", "takos-replica"),
      accessFile,
    };
    const resourceId = "tkrn:workspace-replica:EdgeWorker:takos-replica";
    const endpoint = "https://ew-test.app-staging.takos.jp/";
    const resource = {
      id: resourceId,
      kind: "EdgeWorker",
      metadata: {
        space: managed.workspaceId,
        name: managed.resourceName,
        generation: 2,
      },
      status: {
        phase: "Ready",
        observedGeneration: 2,
        outputs: { url: endpoint },
      },
    };
    let iface: Record<string, unknown> | undefined;
    let binding: Record<string, unknown> | undefined;
    let writes = 0;
    const fetchImpl = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = init?.method ?? "GET";
      if (url.pathname.startsWith("/v1/resources/EdgeWorker/")) {
        return Response.json(resource);
      }
      if (url.pathname === "/v1/interfaces" && method === "GET") {
        return Response.json({ interfaces: iface ? [iface] : [] });
      }
      if (url.pathname === "/v1/interfaces" && method === "POST") {
        writes += 1;
        const request = JSON.parse(String(init?.body)) as Record<
          string,
          unknown
        >;
        iface = {
          kind: "Interface",
          metadata: {
            id: "if_route",
            workspaceId: request.workspaceId,
            name: request.name,
            ownerRef: request.ownerRef,
            generation: 1,
          },
          spec: request.spec,
          status: {
            phase: "Resolved",
            observedGeneration: 1,
            resolvedRevision: 1,
            resolvedInputs: { endpoint },
          },
        };
        return Response.json(iface, { status: 201 });
      }
      if (
        url.pathname === "/v1/interfaces/if_route/bindings" &&
        method === "GET"
      ) {
        return Response.json({ bindings: binding ? [binding] : [] });
      }
      if (
        url.pathname === "/v1/interfaces/if_route/bindings" &&
        method === "POST"
      ) {
        writes += 1;
        const request = JSON.parse(String(init?.body)) as Record<
          string,
          unknown
        >;
        binding = {
          kind: "InterfaceBinding",
          metadata: {
            id: "ifb_route",
            workspaceId: managed.workspaceId,
            generation: 1,
          },
          spec: { interfaceId: "if_route", ...request },
          status: {
            phase: "Ready",
            observedInterfaceRevision: 1,
          },
        };
        return Response.json(binding, { status: 201 });
      }
      return Response.json({ error: "unexpected_request" }, { status: 404 });
    }) as typeof fetch;

    const first = await ensureManagedPublicRoute(managed, fetchImpl);
    const replay = await ensureManagedPublicRoute(managed, fetchImpl);
    expect(first.healthUrl).toBe(`${endpoint}health`);
    expect(first.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(replay).toEqual(first);
    expect(writes).toBe(2);

    iface = undefined;
    await expect(readManagedPublicRoute(managed, fetchImpl)).rejects.toThrow(
      "public route Interface is absent",
    );
    expect(writes).toBe(2);
    await expect(
      assertManagedPublicRouteAbsent(managed, fetchImpl),
    ).resolves.toBeUndefined();
    iface = {
      kind: "Interface",
      metadata: { id: "if_stale" },
    };
    await expect(
      assertManagedPublicRouteAbsent(managed, fetchImpl),
    ).rejects.toThrow("still has an active public route Interface");

    resource.status.outputs.url = "https://app.takosumi.com/";
    await expect(ensureManagedPublicRoute(managed, fetchImpl)).rejects.toThrow(
      "not an isolated credential-free system URL",
    );
    expect(writes).toBe(2);
  });

  test("binds local Docker qualification to the exact workflow and v0.10.35 images", () => {
    const root = mkdtempSync(join(tmpdir(), "takos-local-qualification-"));
    roots.push(root);
    chmodSync(root, 0o700);
    const directory = join(root, "takos-release-artifacts", "replica");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(join(root, "takos-release-artifacts"), 0o700);
    chmodSync(directory, 0o700);
    const sourceCommit = "a".repeat(40);
    const candidateManifestDigest = digest("b");
    const candidateImages = {
      worker: `ghcr.io/tako0614/takos-worker@${digest("1")}`,
      agent: `ghcr.io/tako0614/takos-agent@${digest("2")}`,
      runtime: `ghcr.io/tako0614/takos-worker-runtime@${digest("3")}`,
    };
    const previousImages = {
      worker:
        "ghcr.io/tako0614/takos-worker@sha256:ba8f0af05473728707168fc3a2e37568691767b706b3a78378c0e61ad485fc9b",
      agent:
        "ghcr.io/tako0614/takos-agent@sha256:8e01bf1a2eb3530d8ed941acc455ebe01e021e9e025eaa5bfe1119dd8647c0d6",
      runtime:
        "ghcr.io/tako0614/takos-worker-runtime@sha256:3164eb048307bc054b848f61656d4899ef1bed6ea4e43636ec852580eca4e474",
    };
    const previousExecutionImages = {
      worker: `ghcr.io/tako0614/takos-worker@${digest("5")}`,
      agent: `ghcr.io/tako0614/takos-agent@${digest("6")}`,
      runtime: `ghcr.io/tako0614/takos-worker-runtime@${digest("7")}`,
    };
    const config = {
      runner: "github-hosted-ubuntu-24.04",
      runnerImageOS: "ubuntu24",
      runnerImageVersion: "20260720.1",
      controllerRuntime: {
        version: "v24.18.0",
        executable: "/opt/hostedtoolcache/node/24.18.0/x64/bin/node",
        versionReadback: "v24.18.0",
      },
      osRelease: {
        path: "/etc/os-release",
        digest: sha256Bytes("ubuntu"),
        contents: "ubuntu",
      },
      kernel: "6.11.0",
      dockerArchitecture: "amd64",
      dockerServer: "28.0.0",
      dockerSecurityOptions: [
        "name=apparmor",
        "name=cgroupns",
        "name=seccomp,profile=builtin",
      ],
      containerProfiles: Object.fromEntries(
        ["worker", "agent", "runtime", "postgres", "redis"].map((key) => [
          key,
          "docker-default (enforce)",
        ]),
      ),
      topology: [
        "takos-worker",
        "takos-agent",
        "takos-worker-runtime",
        "postgres@sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229",
        "redis@sha256:6ab0b6e7381779332f97b8ca76193e45b0756f38d4c0dcda72dbb3c32061ab99",
      ],
      productionFallback: false,
      productionCredentialsUsed: false,
      environment: "production",
      defaultAppArmor: true,
      defaultSeccomp: true,
      cgroupNamespace: true,
      domains: "reserved-.test-only",
      namedPersistentVolumes: 3,
      sourceCommit,
      workflowCommit: sourceCommit,
      candidateRunId: "456",
      candidateManifestDigest,
      previousImages,
      previousExecutionImages,
      candidateImages,
    };
    const verifiedAt = new Date(Date.now() - 1_000).toISOString();
    const expiresAt = new Date(
      Date.parse(verifiedAt) + 24 * 60 * 60 * 1_000,
    ).toISOString();
    const checkNames = [
      "previous worker health",
      "previous Takosumi discovery",
      "previous agent health",
      "previous runtime health",
      "candidate worker health",
      "candidate Takosumi discovery",
      "candidate capabilities",
      "candidate agent health",
      "candidate runtime health",
      "previous worker health after rollback",
      "final candidate worker health",
      "final candidate agent health",
      "final candidate runtime health",
    ];
    const qualification = {
      kind: "takos.release-replica-qualification@v1",
      surfaceId: SURFACE_ID,
      releaseId: "takos-release-artifacts-0.11.0-attempt-1",
      replicaId: `takos-replica-${sha256Bytes("takos-release-artifacts-0.11.0-attempt-1").slice(7, 19)}-789`,
      sourceCommit,
      workflowCommit: sourceCommit,
      workflowRunId: "789",
      accessPolicy: "replica-only-no-production-fallback",
      dataSource: "empty",
      candidateRunId: "456",
      candidateManifestDigest,
      candidateBuiltAt: new Date(Date.now() - 5_000).toISOString(),
      previousVersion: "0.10.35",
      previousImages,
      candidateImages,
      status: "verified",
      createdAt: new Date(Date.now() - 2_000).toISOString(),
      verifiedAt,
      expiresAt,
      productionEquivalent: true,
      productionCredentialsUsed: false,
      config,
      configFingerprint: digestJson(config),
      previousImageResolution: {
        publishedVersion: "0.10.35",
        publishedIndexes: previousImages,
        platformExecutionImages: previousExecutionImages,
        mappings: Object.fromEntries(
          (["worker", "agent", "runtime"] as const).map((key) => {
            const publishedIndex = previousImages[key];
            const executionImage = previousExecutionImages[key];
            const repository = publishedIndex.slice(
              0,
              publishedIndex.indexOf("@"),
            );
            return [
              key,
              {
                publishedIndex,
                sourceTag: `${repository}:0.10.35`,
                rawIndexDigest: publishedIndex.slice(
                  publishedIndex.indexOf("@") + 1,
                ),
                rawIndexBodySize: 100,
                transportSize: 101,
                trailingLineFeedRemoved: true,
                platform: { os: "linux", architecture: "amd64" },
                executionImage,
                childManifestDigest: executionImage.slice(
                  executionImage.indexOf("@") + 1,
                ),
                childManifestBodySize: 200,
                childManifestTransportSize: 200,
                childManifestTrailingLineFeedRemoved: false,
              },
            ];
          }),
        ),
        exactPullReadback: previousExecutionImages,
      },
      migration: {
        directory: "db/migrations-control/migrations",
        count: 105,
        first: "0001_initial.sql",
        last: "0105_current.sql",
        planDigest: digest("8"),
        schemaCanonicalization: "pg_dump-restrict-pair-v1",
        countBeforeUpgrade: 105,
        countAfterUpgrade: 105,
        schemaFingerprintBefore: digest("9"),
        schemaFingerprintAfter: digest("9"),
        changedFromPreviousRelease: false,
      },
      checks: checkNames.map((name) => ({
        name,
        status: "passed",
        responseDigest: digest("4"),
      })),
      failureRehearsal: {
        status: "passed",
        strategy: "stop-rollout-and-publish-new-version",
        result: "failed-closed-exit-1",
      },
      rollbackRehearsal: {
        status: "passed",
        from: candidateImages.worker,
        to: previousExecutionImages.worker,
        final: candidateImages.worker,
      },
      digestReadback: {
        candidate: candidateImages,
        finalCandidate: candidateImages,
      },
      data: {
        source: "empty",
        tableCount: 42,
        nonMigrationRows: 0,
        piiScan: "passed",
        secretScan: "passed",
        referentialIntegrity: "passed",
        foreignKeyConstraints: 12,
      },
      cleanupPolicy: "exact-replica-resources-destroyed-after-evidence",
    };
    const path = join(directory, "local-docker-qualification.json");
    writeFileSync(path, JSON.stringify(qualification), { mode: 0o600 });
    chmodSync(path, 0o600);
    const envelope = {
      releaseId: qualification.releaseId,
      source: { commit: sourceCommit },
      candidate: {
        workflowRunId: "456",
        manifestDigest: candidateManifestDigest,
        ociImages: [
          { name: "takos-worker", digest: digest("1") },
          { name: "takos-agent", digest: digest("2") },
          { name: "takos-worker-runtime", digest: digest("3") },
        ],
      },
    } as unknown as ReleaseEnvelope;
    expect(localQualification(root, envelope).value).toMatchObject({
      previousVersion: "0.10.35",
      workflowCommit: sourceCommit,
    });
    qualification.previousImages = {
      ...previousImages,
      worker: candidateImages.worker,
    };
    writeFileSync(path, JSON.stringify(qualification), { mode: 0o600 });
    expect(() => localQualification(root, envelope)).toThrow(
      "local Docker qualification authority drifted",
    );
  });
});
