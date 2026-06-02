#!/usr/bin/env -S bun
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import * as runtime from "./runtime.ts";

type JsonRecord = Record<string, unknown>;

type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
};

const checks: CheckResult[] = [];
const distributionPath = "deploy/distributions/selfhosted.json";
const opentofuDir = "deploy/opentofu/environments/selfhosted";
const opentofuMainPath = `${opentofuDir}/main.tf`;
const opentofuTfvarsExamplePath = `${opentofuDir}/opentofu.tfvars.example`;
const helmBasePath = "deploy/helm/takos/values.yaml";
const helmOverlayPath = "deploy/helm/takos/values-selfhosted.yaml";
const requiredArtifacts = new Set([
  "opentofu:deploy/opentofu/environments/selfhosted",
  "helm:deploy/helm/takos/values-selfhosted.yaml",
  "compose:../takos-private/compose.server.yml",
]);
const imageKeys = [
  "takosWorker",
  "takosumi",
  "takosumiAccounts",
  "takosGit",
  "takosAgent",
] as const;
const managedCredentialPatterns = [
  /\bCLOUDFLARE_API_TOKEN\b/,
  /\bCLOUDFLARE_ACCOUNT_ID\b/,
  /\bAWS_ACCESS_KEY_ID\b/,
  /\bAWS_SECRET_ACCESS_KEY\b/,
  /\bAWS_SESSION_TOKEN\b/,
  /\bGOOGLE_APPLICATION_CREDENTIALS\b/,
  /\bGOOGLE_CLOUD_PROJECT\b/,
  /\bGCLOUD_PROJECT\b/,
  /\bAZURE_CLIENT_SECRET\b/,
  /\bAZURE_TENANT_ID\b/,
];
const managedAnnotationPatterns = [
  /alb\.ingress\.kubernetes\.io/,
  /eks\.amazonaws\.com/,
  /networking\.gke\.io/,
  /iam\.gke\.io/,
  /kubernetes\.io\/ingress\.global-static-ip-name/,
];

await checkDistribution();
await checkOpenTofuSelfhost();
await checkHelmBase();
await checkHelmOverlay();

const failed = checks.filter((check) => !check.ok);
if (failed.length > 0) {
  for (const check of failed) {
    console.error(`selfhost-no-managed-credentials: failed ${check.name}: ${check.detail}`);
  }
  runtime.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  kind: "takos.selfhost-no-managed-credentials@v1",
  checked: checks.length,
  artifacts: [...requiredArtifacts].sort(),
}, null, 2));

async function checkDistribution(): Promise<void> {
  const text = await readText(distributionPath);
  const distribution = JSON.parse(text) as JsonRecord;
  const artifacts = arrayOfRecords(distribution.artifacts);
  const actual = new Set(artifacts.map((artifact) => `${artifact.kind}:${artifact.ref}`));
  const missing = [...requiredArtifacts].filter((artifact) => !actual.has(artifact));
  const unexpected = [...actual].filter((artifact) => !requiredArtifacts.has(artifact));
  checks.push({
    name: "selfhost-distribution-artifacts",
    ok: missing.length === 0 && unexpected.length === 0,
    detail: missing.length === 0 && unexpected.length === 0
      ? "selfhosted distribution carries OpenTofu, Helm, and compose artifacts"
      : `missing ${missing.join(", ") || "(none)"}; unexpected ${unexpected.join(", ") || "(none)"}`,
  });

  const providerProof = record(distribution.providerProof);
  const commandText = [
    providerProof.readOnlySmokeTask,
    providerProof.provisioningSmokeTask,
    providerProof.cleanupTask,
    providerProof.fixturePath,
    providerProof.liveEnvPrefix,
  ].join("\n");
  checks.push({
    name: "selfhost-provider-proof-prefix",
    ok: commandText.includes("TAKOSUMI_PROVIDER_SELFHOSTED") &&
      commandText.includes("TAKOSUMI_PROVIDER_LIVE_PROVIDER=selfhosted") &&
      !hasManagedCredential(commandText),
    detail: "self-hosted provider proof uses TAKOSUMI_PROVIDER_SELFHOSTED and no managed provider credential variables",
  });
}

async function checkOpenTofuSelfhost(): Promise<void> {
  assertExists(opentofuMainPath);
  assertExists(opentofuTfvarsExamplePath);
  const main = await readText(opentofuMainPath);
  const tfvarsExample = await readText(opentofuTfvarsExamplePath);
  const combined = `${main}\n${tfvarsExample}`;
  const blockers: string[] = [];
  if (/\bprovider\s+"/.test(main)) {
    blockers.push("self-hosted OpenTofu environment must not declare provider blocks");
  }
  if (/\bbackend\s+"/.test(main)) {
    blockers.push("self-hosted OpenTofu environment must not declare a state backend");
  }
  if (!/output\s+"platform_services"/.test(main)) {
    blockers.push("missing platform_services output");
  }
  if (!/output\s+"helm_values"/.test(main)) {
    blockers.push("missing helm_values output");
  }
  if (hasManagedCredential(combined)) {
    blockers.push("managed provider credential variable found");
  }
  if (hasManagedAnnotation(combined)) {
    blockers.push("managed cloud annotation found");
  }
  checks.push({
    name: "selfhost-opentofu-static-boundary",
    ok: blockers.length === 0,
    detail: blockers.length === 0
      ? "self-hosted OpenTofu environment is provider/backend-free and emits only credential-free outputs"
      : blockers.join("; "),
  });
}

async function checkHelmBase(): Promise<void> {
  const base = parseYamlRecord(await readText(helmBasePath), helmBasePath);
  const runtimeConfig = record(base.runtimeConfig);
  const defaultApps = record(runtimeConfig.defaultApps);
  const secrets = record(base.secrets);
  const existingSecrets = record(secrets.existingSecrets);
  const images = record(base.images);
  const blockers: string[] = [];
  if (runtimeConfig.environment !== "local") {
    blockers.push("base runtimeConfig.environment must remain local");
  }
  if (defaultApps.preinstallEnabled !== false) {
    blockers.push("base defaultApps.preinstallEnabled must remain false");
  }
  for (const key of imageKeys) {
    const image = record(images[key]);
    if (image.tag !== "") {
      blockers.push(`base images.${key}.tag must be empty`);
    }
  }
  for (const key of ["platform", "auth", "llm"]) {
    if (!(key in existingSecrets)) {
      blockers.push(`base secrets.existingSecrets.${key} is missing`);
    }
  }
  checks.push({
    name: "helm-base-fail-closed-defaults",
    ok: blockers.length === 0,
    detail: blockers.length === 0
      ? "base Helm values keep local environment, no default app preinstall, empty image tags, and existingSecret support"
      : blockers.join("; "),
  });
}

async function checkHelmOverlay(): Promise<void> {
  const text = await readText(helmOverlayPath);
  const overlay = parseYamlRecord(text, helmOverlayPath);
  const runtimeConfig = record(overlay.runtimeConfig);
  const defaultApps = record(runtimeConfig.defaultApps);
  const operatorProfile = record(runtimeConfig.operatorProfile);
  const implementationIds = Array.isArray(operatorProfile.implementationIds)
    ? operatorProfile.implementationIds
    : [];
  const secrets = record(overlay.secrets);
  const existingSecrets = record(secrets.existingSecrets);
  const ingress = record(overlay.ingress);
  const gcpManagedCertificate = record(ingress.gcpManagedCertificate);
  const annotations = record(ingress.annotations);
  const accounts = record(overlay.accounts);
  const persistence = record(accounts.persistence);
  const blockers: string[] = [];
  if (runtimeConfig.environment !== "production") {
    blockers.push("self-host overlay must set runtimeConfig.environment=production");
  }
  if (defaultApps.preinstallEnabled !== false) {
    blockers.push("self-host overlay must keep defaultApps.preinstallEnabled=false");
  }
  if (operatorProfile.distribution !== "takosumi") {
    blockers.push("self-host overlay runtimeConfig.operatorProfile.distribution must be takosumi");
  }
  if (operatorProfile.profileId !== "operator.takosumi.selfhosted") {
    blockers.push("self-host overlay runtimeConfig.operatorProfile.profileId must be operator.takosumi.selfhosted");
  }
  if (implementationIds.length !== 0) {
    blockers.push("self-host overlay runtimeConfig.operatorProfile.implementationIds must remain empty/fail-closed");
  }
  if (secrets.create !== false) {
    blockers.push("self-host overlay must set secrets.create=false");
  }
  for (const key of ["platform", "auth", "llm"]) {
    if (typeof existingSecrets[key] !== "string" || existingSecrets[key].trim() === "") {
      blockers.push(`self-host overlay secrets.existingSecrets.${key} must name an existing Secret`);
    }
  }
  if (record(overlay.images) && Object.keys(record(overlay.images)).length > 0) {
    blockers.push("self-host overlay must not hard-code image tags; pass them via operator/CI values");
  }
  if (ingress.className !== "caddy") {
    blockers.push("self-host overlay ingress.className must be caddy");
  }
  if (Object.keys(annotations).length > 0) {
    blockers.push("self-host overlay ingress.annotations must be empty");
  }
  if (gcpManagedCertificate.enabled !== false) {
    blockers.push("self-host overlay must keep gcpManagedCertificate.enabled=false");
  }
  if (persistence.enabled !== true) {
    blockers.push("self-host overlay accounts.persistence.enabled must be true");
  }
  if (persistence.runMigrations !== false) {
    blockers.push("self-host overlay accounts.persistence.runMigrations must be false");
  }
  if (hasManagedCredential(text)) {
    blockers.push("managed provider credential variable found");
  }
  if (hasManagedAnnotation(text)) {
    blockers.push("managed cloud ingress/service-account annotation found");
  }
  checks.push({
    name: "helm-selfhost-overlay-boundary",
    ok: blockers.length === 0,
    detail: blockers.length === 0
      ? "self-host Helm overlay is fail-closed and free of managed-provider credentials/annotations"
      : blockers.join("; "),
  });
}

function parseYamlRecord(text: string, path: string): JsonRecord {
  const parsed = parseYaml(text);
  if (!isRecord(parsed)) throw new Error(`${path} must parse to an object`);
  return parsed;
}

async function readText(path: string): Promise<string> {
  return await runtime.readTextFile(path);
}

function assertExists(path: string): void {
  runtime.statSync(resolve(runtime.cwd(), path));
}

function hasManagedCredential(text: string): boolean {
  return managedCredentialPatterns.some((pattern) => pattern.test(text));
}

function hasManagedAnnotation(text: string): boolean {
  return managedAnnotationPatterns.some((pattern) => pattern.test(text));
}

function record(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function arrayOfRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
