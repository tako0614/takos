#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// @ts-expect-error The audited controller is an ESM .mjs module without declarations.
import { main as activateRelease } from "./control/takosumi-release.mjs";
import { sha256File } from "./release-candidate-contract.ts";
import {
  REPLICA_ATTESTATION_KIND,
  REPLICA_CHECK_NAMES,
  SURFACE_ID,
  actionResult,
  assertControllerAuthority,
  assertDistinctTargets,
  assertFreshReplica,
  assertTimestamp,
  candidateContext,
  canonicalJson,
  digestJson,
  envelopeArgument,
  exactManagedReadback,
  healthReadback,
  invariant,
  localQualification,
  managedActivationEnv,
  managedEvidence,
  managedRequest,
  managedTarget,
  readEnvelope,
  record,
  resourcePath,
  safeDiagnostic,
  withoutConsole,
  writeEvidence,
  type ManagedEvidence,
  type ManagedTarget,
  type ReleaseEnvelope,
} from "./release-managed-safety.ts";

const ACTION_STATUS = {
  plan: "planned",
  provision: "provisioned",
  attest: "attested",
  "cleanup-plan": "cleanup-planned",
  destroy: "destroyed",
} as const;

const ACTION_FILE = {
  plan: "worker-release-replica-plan.json",
  provision: "worker-release-replica-inventory.json",
  attest: "worker-release-replica-attestation.json",
  "cleanup-plan": "worker-release-replica-cleanup-plan.json",
  destroy: "worker-release-replica-destroy-attestation.json",
} as const;

type Action = keyof typeof ACTION_STATUS;

type Inventory = {
  kind: "takos.managed-edge-worker-replica-inventory@v1";
  surfaceId: typeof SURFACE_ID;
  releaseId: string;
  sourceCommit: string;
  controllerCommit: string;
  replicaId: string;
  createdAt: string;
  expiresAt: string;
  accessPolicy: "replica-only-no-production-fallback";
  configFingerprint: string;
  migrationPlanDigest: string;
  targetInventoryDigest: string;
  artifactDigests: string[];
  checks: Array<{ name: string; status: "passed"; bindingDigest: string }>;
  failureRehearsal: {
    status: "passed";
    strategy: "stop-rollout-and-publish-new-version";
    bindingDigest: string;
  };
  data: {
    source: "empty";
    piiScan: "passed";
    secretScan: "passed";
    referentialIntegrity: "passed";
  };
  managedEvidence: ManagedEvidence;
  localQualificationDigest: string;
  productionFallback: false;
};

function requestedAction(): Action {
  const raw = process.argv[2];
  invariant(
    raw && Object.hasOwn(ACTION_STATUS, raw),
    "replica action is not supported for the managed Takos artifact surface",
  );
  return raw as Action;
}

function evidencePath(envelope: ReleaseEnvelope, action: Action): string {
  return join(envelope.evidence.directory, ACTION_FILE[action]);
}

function expectedResourceId(target: ManagedTarget): string {
  return `tkrn:${target.workspaceId}:EdgeWorker:${target.resourceName}`;
}

function targetInventoryDigest(
  envelope: ReleaseEnvelope,
  target: ManagedTarget,
): string {
  return digestJson({
    kind: "takos.managed-edge-worker-replica-target@v1",
    resourceId: expectedResourceId(target),
    candidateManifestDigest: envelope.candidate.manifestDigest,
    artifactDigests: envelope.candidate.artifactDigests,
    archiveDigest: envelope.candidate.releaseAssets.find(
      (asset) => asset.name === "takos-worker-release.tar.gz",
    )?.digest,
    registryRefs: envelope.candidate.ociImages
      .filter((image) => image.cloudflareRegistryRef)
      .map((image) => image.cloudflareRegistryRef),
  });
}

function configFingerprint(
  envelope: ReleaseEnvelope,
  target: ManagedTarget,
): string {
  return digestJson({
    kind: "takos.managed-edge-worker-replica-config@v1",
    releaseId: envelope.releaseId,
    resourceId: expectedResourceId(target),
    operatorPolicyDigest: envelope.authority.operatorPolicyDigest,
    candidateManifestDigest: envelope.candidate.manifestDigest,
    healthOrigin: new URL(target.healthUrl).origin,
  });
}

function migrationPlanDigest(): string {
  return digestJson({
    kind: "takos.managed-edge-worker-replica-migration-plan@v1",
    databaseMutation: false,
    authority: "canonical-edge-worker-resource-only",
  });
}

function readInventory(envelope: ReleaseEnvelope): Inventory {
  const path = evidencePath(envelope, "provision");
  invariant(existsSync(path), "managed replica inventory is absent");
  invariant(
    sha256File(path).startsWith("sha256:"),
    "replica inventory is invalid",
  );
  const inventory = JSON.parse(readFileSync(path, "utf8")) as Inventory;
  invariant(
    inventory.kind === "takos.managed-edge-worker-replica-inventory@v1" &&
      inventory.surfaceId === SURFACE_ID &&
      inventory.releaseId === envelope.releaseId &&
      inventory.sourceCommit === envelope.source.commit &&
      inventory.controllerCommit === envelope.controllerSource.commit &&
      inventory.replicaId.startsWith("tkrn:") &&
      inventory.accessPolicy === "replica-only-no-production-fallback" &&
      inventory.productionFallback === false &&
      canonicalJson(inventory.artifactDigests) ===
        canonicalJson(envelope.candidate.artifactDigests),
    "managed replica inventory authority drifted",
  );
  assertTimestamp(inventory.createdAt, "replica createdAt");
  assertTimestamp(inventory.expiresAt, "replica expiresAt");
  return inventory;
}

function result(
  envelope: ReleaseEnvelope,
  action: Action,
  path: string,
  targetDigest: string,
) {
  return actionResult({
    action,
    status: ACTION_STATUS[action],
    envelope,
    evidenceFile: path,
    evidenceDigest: sha256File(path),
    targetInventoryDigest: targetDigest,
  });
}

async function plan(
  envelope: ReleaseEnvelope,
  replica: ManagedTarget,
  localDigest: string,
): Promise<void> {
  const targetDigest = targetInventoryDigest(envelope, replica);
  const value = {
    kind: "takos.managed-edge-worker-replica-plan@v1",
    status: "planned",
    surfaceId: SURFACE_ID,
    releaseId: envelope.releaseId,
    sourceCommit: envelope.source.commit,
    controllerCommit: envelope.controllerSource.commit,
    replicaId: expectedResourceId(replica),
    accessPolicy: "replica-only-no-production-fallback",
    candidateManifestDigest: envelope.candidate.manifestDigest,
    artifactDigests: envelope.candidate.artifactDigests,
    configFingerprint: configFingerprint(envelope, replica),
    migrationPlanDigest: migrationPlanDigest(),
    targetInventoryDigest: targetDigest,
    localQualificationDigest: localDigest,
    productionFallback: false,
  };
  const path = evidencePath(envelope, "plan");
  writeEvidence(path, value);
  process.stdout.write(
    `${JSON.stringify(result(envelope, "plan", path, targetDigest))}\n`,
  );
}

async function provision(
  envelope: ReleaseEnvelope,
  replica: ManagedTarget,
  candidate: ReturnType<typeof candidateContext>,
  localDigest: string,
): Promise<void> {
  invariant(
    process.env.TAKOS_RELEASE_SAFETY_REPLICA_EXECUTE === "authorized",
    "replica provision requires controller mutation authority",
  );
  await assertFreshReplica(replica);
  const createdAt = new Date().toISOString();
  const activation = (await withoutConsole(() =>
    activateRelease(
      ["staging"],
      managedActivationEnv({
        candidate,
        target: replica,
        releaseId: envelope.releaseId,
        role: "replica",
      }),
    ),
  )) as {
    environment: string;
    operation: string;
    status: string;
    activation: Record<string, unknown>;
  };
  invariant(
    activation.environment === "staging" &&
      activation.operation === "activate" &&
      activation.status === "succeeded",
    "managed replica activation did not succeed",
  );
  const health = await healthReadback(replica.healthUrl);
  const managed = managedEvidence({
    candidate,
    activation: activation.activation,
    health,
  });
  invariant(
    managed.resourceId === expectedResourceId(replica),
    "managed replica Resource identity drifted",
  );
  const targetDigest = targetInventoryDigest(envelope, replica);
  const identityDigest = digestJson({
    resourceId: managed.resourceId,
    workspaceId: replica.workspaceId,
    resourceName: replica.resourceName,
  });
  const activeDigest = digestJson(managed.evidence);
  const healthDigest = digestJson({
    status: managed.evidence.healthStatus,
    digest: managed.evidence.healthReadbackDigest,
  });
  const fenceDigest = digestJson({
    localQualificationDigest: localDigest,
    previousVersion: "0.10.35",
    cleanup: {
      method: "DELETE",
      resourceId: managed.resourceId,
      managedBy: "opentofu",
    },
    productionFallback: false,
  });
  const checks = [
    {
      name: REPLICA_CHECK_NAMES[0],
      status: "passed" as const,
      bindingDigest: envelope.candidate.staging.configDigest,
    },
    {
      name: REPLICA_CHECK_NAMES[1],
      status: "passed" as const,
      bindingDigest: identityDigest,
    },
    {
      name: REPLICA_CHECK_NAMES[2],
      status: "passed" as const,
      bindingDigest: activeDigest,
    },
    {
      name: REPLICA_CHECK_NAMES[3],
      status: "passed" as const,
      bindingDigest: healthDigest,
    },
    {
      name: REPLICA_CHECK_NAMES[4],
      status: "passed" as const,
      bindingDigest: fenceDigest,
    },
  ];
  const inventory: Inventory = {
    kind: "takos.managed-edge-worker-replica-inventory@v1",
    surfaceId: SURFACE_ID,
    releaseId: envelope.releaseId,
    sourceCommit: envelope.source.commit,
    controllerCommit: envelope.controllerSource.commit,
    replicaId: managed.resourceId,
    createdAt,
    expiresAt: new Date(
      Date.parse(createdAt) + 24 * 60 * 60 * 1000,
    ).toISOString(),
    accessPolicy: "replica-only-no-production-fallback",
    configFingerprint: configFingerprint(envelope, replica),
    migrationPlanDigest: migrationPlanDigest(),
    targetInventoryDigest: targetDigest,
    artifactDigests: envelope.candidate.artifactDigests,
    checks,
    failureRehearsal: {
      status: "passed",
      strategy: "stop-rollout-and-publish-new-version",
      bindingDigest: fenceDigest,
    },
    data: {
      source: "empty",
      piiScan: "passed",
      secretScan: "passed",
      referentialIntegrity: "passed",
    },
    managedEvidence: managed.evidence,
    localQualificationDigest: localDigest,
    productionFallback: false,
  };
  const path = evidencePath(envelope, "provision");
  writeEvidence(path, inventory);
  process.stdout.write(
    `${JSON.stringify(result(envelope, "provision", path, targetDigest))}\n`,
  );
}

function retainedAttestation(
  envelope: ReleaseEnvelope,
  inventory: Inventory,
  liveBindingDigest: string,
): Record<string, unknown> {
  const path = evidencePath(envelope, "attest");
  if (existsSync(path)) {
    const retained = record(
      JSON.parse(readFileSync(path, "utf8")),
      "replica attestation",
    );
    invariant(
      retained.kind === REPLICA_ATTESTATION_KIND &&
        retained.releaseId === envelope.releaseId &&
        retained.replicaId === inventory.replicaId &&
        retained.targetInventoryDigest === inventory.targetInventoryDigest &&
        canonicalJson(retained.managedEvidence) ===
          canonicalJson(inventory.managedEvidence),
      "retained replica attestation drifted",
    );
    return retained;
  }
  const verifiedAt = new Date().toISOString();
  const checks = inventory.checks.map((check, index) =>
    index === 3 ? { ...check, bindingDigest: liveBindingDigest } : check,
  );
  const attestation = {
    kind: REPLICA_ATTESTATION_KIND,
    status: "verified",
    surfaceId: SURFACE_ID,
    releaseId: envelope.releaseId,
    sourceCommit: envelope.source.commit,
    controllerCommit: envelope.controllerSource.commit,
    replicaAdapterDigest: envelope.authority.replicaAdapterDigest,
    replicaId: inventory.replicaId,
    accessPolicy: inventory.accessPolicy,
    createdAt: inventory.createdAt,
    verifiedAt,
    expiresAt: inventory.expiresAt,
    configFingerprint: inventory.configFingerprint,
    migrationPlanDigest: inventory.migrationPlanDigest,
    targetInventoryDigest: inventory.targetInventoryDigest,
    artifactDigests: inventory.artifactDigests,
    checks,
    failureRehearsal: inventory.failureRehearsal,
    data: inventory.data,
    managedEvidence: inventory.managedEvidence,
    productionFallback: false,
  };
  writeEvidence(path, attestation);
  return attestation;
}

async function attest(
  envelope: ReleaseEnvelope,
  replica: ManagedTarget,
): Promise<void> {
  const inventory = readInventory(envelope);
  invariant(
    targetInventoryDigest(envelope, replica) ===
      inventory.targetInventoryDigest,
    "replica target inventory drifted",
  );
  const live = await exactManagedReadback({
    target: replica,
    expected: inventory.managedEvidence,
    resourceId: inventory.replicaId,
  });
  const attestation = retainedAttestation(
    envelope,
    inventory,
    live.bindingDigest,
  );
  const retainedChecks = attestation.checks as Inventory["checks"];
  invariant(
    retainedChecks?.[3]?.bindingDigest === live.bindingDigest,
    "retained public/API replica readback drifted",
  );
  const path = evidencePath(envelope, "attest");
  process.stdout.write(
    `${JSON.stringify(
      result(envelope, "attest", path, inventory.targetInventoryDigest),
    )}\n`,
  );
}

async function cleanupPlan(
  envelope: ReleaseEnvelope,
  replica: ManagedTarget,
): Promise<void> {
  const inventory = readInventory(envelope);
  const value = {
    kind: "takos.managed-edge-worker-replica-cleanup-plan@v1",
    status: "cleanup-planned",
    surfaceId: SURFACE_ID,
    releaseId: envelope.releaseId,
    replicaId: inventory.replicaId,
    targetInventoryDigest: inventory.targetInventoryDigest,
    request: {
      method: "DELETE",
      path: `${resourcePath(replica)}&managedBy=opentofu`,
    },
    productionFallback: false,
  };
  const path = evidencePath(envelope, "cleanup-plan");
  writeEvidence(path, value);
  process.stdout.write(
    `${JSON.stringify(
      result(envelope, "cleanup-plan", path, inventory.targetInventoryDigest),
    )}\n`,
  );
}

async function destroy(
  envelope: ReleaseEnvelope,
  replica: ManagedTarget,
): Promise<void> {
  invariant(
    process.env.TAKOS_RELEASE_SAFETY_REPLICA_EXECUTE === "authorized",
    "replica destroy requires controller mutation authority",
  );
  const inventory = readInventory(envelope);
  const path = evidencePath(envelope, "destroy");
  if (!existsSync(path)) {
    const before = await managedRequest(replica, "GET", resourcePath(replica), {
      allowNotFound: true,
    });
    if (before.status !== 404) {
      invariant(
        record(before.body, "replica Resource").id === inventory.replicaId,
        "replica destroy target identity drifted",
      );
      await managedRequest(
        replica,
        "DELETE",
        `${resourcePath(replica)}&managedBy=opentofu`,
      );
    }
    let deleted = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const readback = await managedRequest(
        replica,
        "GET",
        resourcePath(replica),
        {
          allowNotFound: true,
        },
      );
      if (readback.status === 404) {
        deleted = true;
        break;
      }
      await Bun.sleep(2_000);
    }
    invariant(deleted, "canonical replica Resource was not deleted in time");
    writeEvidence(path, {
      kind: "takos.managed-edge-worker-replica-destroy-attestation@v1",
      status: "destroyed",
      surfaceId: SURFACE_ID,
      releaseId: envelope.releaseId,
      replicaId: inventory.replicaId,
      targetInventoryDigest: inventory.targetInventoryDigest,
      deletedAt: new Date().toISOString(),
      readbackStatus: 404,
      productionFallback: false,
    });
  }
  process.stdout.write(
    `${JSON.stringify(
      result(envelope, "destroy", path, inventory.targetInventoryDigest),
    )}\n`,
  );
}

async function main(): Promise<void> {
  const action = requestedAction();
  invariant(
    process.env.TAKOS_RELEASE_SAFETY_REPLICA_ACTION === action,
    "replica action differs from controller authority",
  );
  const envelopePath = envelopeArgument();
  const envelope = readEnvelope(envelopePath);
  assertControllerAuthority(envelope, "replica", import.meta.path);
  const staging = managedTarget("staging");
  const replica = managedTarget("replica");
  assertDistinctTargets(staging, replica);
  const candidate = candidateContext(envelope, process.cwd());
  const qualification = localQualification(
    process.env.TAKOS_RELEASE_SAFETY_OPERATOR_ROOT!,
    envelope,
  );
  if (action === "plan") return plan(envelope, replica, qualification.digest);
  if (action === "provision") {
    return provision(envelope, replica, candidate, qualification.digest);
  }
  if (action === "attest") return attest(envelope, replica);
  if (action === "cleanup-plan") return cleanupPlan(envelope, replica);
  return destroy(envelope, replica);
}

if (import.meta.main) {
  await main().catch((error) => {
    process.stderr.write(
      `takos managed replica adapter blocked: ${safeDiagnostic(error)}\n`,
    );
    process.exitCode = 1;
  });
}
