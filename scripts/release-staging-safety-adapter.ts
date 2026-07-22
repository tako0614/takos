#!/usr/bin/env bun

import { join } from "node:path";

// @ts-expect-error The audited controller is an ESM .mjs module without declarations.
import { main as activateRelease } from "./control/takosumi-release.mjs";
import {
  DIRECT_STAGING_RESULT_KIND,
  STAGING_ATTESTATION_KIND,
  SURFACE_ID,
  assertControllerAuthority,
  candidateContext,
  ensureManagedPublicRoute,
  envelopeArgument,
  healthReadback,
  invariant,
  managedActivationEnv,
  managedEvidence,
  managedTarget,
  readEnvelope,
  safeDiagnostic,
  withoutConsole,
  writeEvidence,
} from "./release-managed-safety.ts";

async function main(): Promise<void> {
  const envelopePath = envelopeArgument();
  const envelope = readEnvelope(envelopePath);
  assertControllerAuthority(envelope, "staging", import.meta.path);
  const sourceDir = process.cwd();
  const candidate = candidateContext(envelope, sourceDir);
  const target = managedTarget("staging");
  const activation = (await withoutConsole(() =>
    activateRelease(
      ["staging"],
      managedActivationEnv({
        candidate,
        target,
        releaseId: envelope.releaseId,
        role: "staging",
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
    "managed staging activation did not succeed",
  );
  const route = await ensureManagedPublicRoute(target);
  const health = await healthReadback(route.healthUrl);
  const managed = managedEvidence({
    candidate,
    activation: activation.activation,
    route,
    health,
  });
  const readbackAt = new Date().toISOString();
  const healthChecks = envelope.candidate.staging.healthChecks.map((check) => ({
    ...check,
    status: "passed" as const,
  }));
  const attestation = {
    kind: STAGING_ATTESTATION_KIND,
    surfaceId: SURFACE_ID,
    releaseId: envelope.releaseId,
    sourceCommit: envelope.source.commit,
    controllerCommit: envelope.controllerSource.commit,
    controllerDigest: envelope.authority.controllerDigest,
    stagingAdapterDigest: envelope.authority.stagingAdapterDigest,
    manifestDigest: envelope.candidate.manifestDigest,
    policyDigest: envelope.candidate.policyDigest,
    targetFingerprint: envelope.candidate.staging.targetFingerprint,
    resourceId: managed.resourceId,
    artifactDigests: envelope.candidate.artifactDigests,
    readbackAt,
    healthChecks,
    remoteEvidence: managed.evidence,
  };
  const evidenceFile = join(
    envelope.evidence.directory,
    "takos-managed-staging-attestation.json",
  );
  const attestationDigest = writeEvidence(evidenceFile, attestation);
  process.stdout.write(
    `${JSON.stringify({
      kind: DIRECT_STAGING_RESULT_KIND,
      status: "verified",
      surfaceId: SURFACE_ID,
      releaseId: envelope.releaseId,
      sourceCommit: envelope.source.commit,
      controllerCommit: envelope.controllerSource.commit,
      controllerDigest: envelope.authority.controllerDigest,
      stagingAdapterDigest: envelope.authority.stagingAdapterDigest,
      artifactDigests: envelope.candidate.artifactDigests,
      targetFingerprint: envelope.candidate.staging.targetFingerprint,
      attestationDigest,
      immutableId: managed.resourceId,
      readbackAt,
      healthChecks,
    })}\n`,
  );
}

if (import.meta.main) {
  await main().catch((error) => {
    process.stderr.write(
      `takos managed staging adapter blocked: ${safeDiagnostic(error)}\n`,
    );
    process.exitCode = 1;
  });
}
