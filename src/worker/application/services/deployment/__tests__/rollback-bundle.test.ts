import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import {
  deleteDeploymentSourceArtifacts,
  rollbackDeploymentSteps,
} from "../rollback.ts";
import type { Deployment } from "../models.ts";

/**
 * Guards the resume invariant: the deployment pipeline retries/resumes on the
 * SAME deploymentId and re-reads bundle_r2_key, which the retry path never
 * re-uploads. The per-attempt rollback must therefore NOT delete the source
 * bundle/wasm (deleting it turned a transient deploy_worker error into a
 * permanent "Bundle not found" failure). Terminal cleanup happens only via
 * deleteDeploymentSourceArtifacts (DLQ, after retries are exhausted).
 */

function bundleEnv(deleted: string[]) {
  const db = {
    select() {
      return { from: () => ({ where: () => ({ get: async () => null }) }) };
    },
    insert() {
      return { values: async () => ({}) };
    },
    update() {
      return { set: () => ({ where: async () => ({}) }) };
    },
    delete() {
      return { where: async () => ({}) };
    },
    prepare() {
      return {};
    },
  };
  const WORKER_BUNDLES = {
    delete: async (key: string) => {
      deleted.push(key);
    },
  };
  return { DB: db, WORKER_BUNDLES } as unknown as Parameters<
    typeof deleteDeploymentSourceArtifacts
  >[0];
}

const deployment = {
  bundle_r2_key: "deployments/svc/3/bundle.js",
  wasm_r2_key: "deployments/svc/3/module.wasm",
} as unknown as Deployment;

test("per-attempt rollback does NOT delete the source bundle/wasm", async () => {
  const deleted: string[] = [];
  await rollbackDeploymentSteps({
    env: bundleEnv(deleted) as never,
    deploymentId: "dep_1",
    deployment,
    // No completed steps -> only the (removed) source-bundle delete would have
    // run on the old code path.
    completedStepNames: [],
    routingRollbackSnapshot: null,
    workerHostname: null,
    deploymentArtifactRef: null,
    backend: {} as never,
  });
  assertEquals(deleted, []);
});

test("deleteDeploymentSourceArtifacts removes the source bundle and wasm", async () => {
  const deleted: string[] = [];
  await deleteDeploymentSourceArtifacts(bundleEnv(deleted), "dep_1", deployment);
  assertEquals(deleted.sort(), [
    "deployments/svc/3/bundle.js",
    "deployments/svc/3/module.wasm",
  ]);
});
