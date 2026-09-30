import { Buffer } from "node:buffer";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, jest, test } from "bun:test";

import {
  assertExactAbsence,
  assertNativeResidualCapability,
  assertNativeResidualResponse,
  assertExactIdentitySet,
  assertExactProbeBody,
  assertReadbackResource,
  assertAuthoritativeAbsence,
  assertEndpointAbsence,
  assertExactPlan,
  assertNoKnownSecrets,
  assertGithubReleaseRedirect,
  assertProviderLockfile,
  buildTofuEnvironment,
  buildNativeResidualURL,
  canonicalDigest,
  cleanupRunRoot,
  cleanupAfterApply,
  combineTracerFailures,
  createRevisionNameContext,
  createProviderInstallConfig,
  discoverV1,
  EVIDENCE_TOKEN_ENV,
  isJsonMediaType,
  MUTATION_TOKEN_ENV,
  knownResourceAddresses,
  materializeEndpointOrigin,
  PROVIDER4_FORM_REFS,
  PUBLIC_PROVIDER_H1_HASHES,
  PUBLIC_PROVIDER_CHECKSUM_SOURCE,
  PUBLIC_PROVIDER_PLATFORMS,
  PUBLIC_PROVIDER_REGISTRY_DOWNLOAD_BASE,
  PUBLIC_PROVIDER_SIGNING_KEY_ARMOR,
  PUBLIC_PROVIDER_SIGNATURE_SOURCE,
  PUBLIC_PROVIDER_SIGNING_KEY_FINGERPRINT,
  PUBLIC_PROVIDER_SIGNING_KEY_ID,
  PUBLIC_PROVIDER_ZH_HASHES,
  PROVIDER_CONSTRAINT,
  PROVIDER_SOURCE,
  PROVIDER_VERSION,
  parseArgs,
  parsePublicProviderChecksums,
  parseWorkspaceStatus,
  parseTofuOutputs,
  projectResourceName,
  probeRuntime,
  redactOutput,
  RESOURCE_KEYS,
  resourceURL,
  readHostResource,
  readResourceExecutionEvidence,
  readResponseBody,
  runBoundedCommand,
  runTracer,
  unwrapTofuOutput,
  validateBareOrigin,
  validateEndpointOriginTemplate,
  validateOrganizationId,
  validateSpace,
  validateV1Discovery,
  verifyNativeAbsence,
  type ResourceIdentity,
  type RevisionNameContext,
  type FetchFunction,
  type SpawnFunction,
  type SpawnedChild,
  assertProviderRegistryMetadata,
  assertResourceExecutionEvidenceCapability,
  assertDestroyExecutionEvidenceSuccessor,
  fetchPublicProviderRelease,
  verifyPublicProviderRelease,
} from "../takoserver-fetch-tracer.ts";
const token = "test-token-value";
const evidenceToken = "test-evidence-token-value";
const nonce = "a".repeat(64);
const projectUid = `puid-${nonce}`;
const publicProviderChecksums = [
  ["a2b1f6c0bda3065c1e181db3b97eef52d9c823a74dc25e19339a4881ff501b17", "terraform-provider-takoform_4.0.0_darwin_amd64.zip"],
  ["1a70d45661665b3ad799196637e93dd7765323b32fbc7eba7bd30496e225e3bd", "terraform-provider-takoform_4.0.0_darwin_arm64.zip"],
  ["23fc2f43deec7e9bf20a4fe8253169fdbaa163840a8fdf8dfe1f4293f2346044", "terraform-provider-takoform_4.0.0_linux_amd64.zip"],
  ["3a7d9e2f0edf19713a1df989b32541efe1ac5cf0926ca7a0c3b421e8acd3a633", "terraform-provider-takoform_4.0.0_linux_arm64.zip"],
  ["f809ab383cca0a5f83072981c64208cbd7fa67e986a86ee02dd2c82333221e32", "terraform-provider-takoform_4.0.0_manifest.json"],
  ["ecd934d19ff177229afd0a9248ea2b37ef2a8bba8182f03acf21b36b4b9e2298", "terraform-provider-takoform_4.0.0_windows_amd64.zip"],
] as const;
const publicProviderChecksumText = publicProviderChecksums.map(([hash, name]) => `${hash}  ${name}`).join("\n") + "\n";
const publicProviderSignature = Buffer.from(
  "iQIzBAABCgAdFiEENRDnXgW7zDA7ktd5NPwYrIl/twkFAmqX6hQACgkQNPwYrIl/twliRg/6Aiukc6gd+fMd/UAZhR7/1WU2t/CYS+t98T6IWv6jmOLpI2qInVjaZ71FChQWh8x9Buuzvg4fjhRpwl5UH6dJWrn+m1ASTzqOmIiYnRjK6ATsv7WJbNUVuTxGbIg+HYRjGSfvRz1v99VxDNr0z7l+7+IaDH4uMHdWVtcdzbDI3Iwje/46PF2KJuRHzh5T2mqo+Kl+iSW17Aa3HyD6+i5PS+FAWzTJS6YCMunbpDwNIkDrlHYYAC96RzR7seOvBio94jBuXHaLssIPppBs0OyLxtxh1PTPD56M5b239PgDdiehwnM7gsVcxxSQO6TjPxUdeoBMl4qbdLTwCeurw4En3DXPuC+H8HHJLYFfYalQEDCbEyhvOXE/ge3n8ung3iJJN5HEoOg1cKIGJtSVyMj10nnyHxubp01SVyDleOPW8mjHzDQP+R1watQUSKvkhuvRNPOGrC3gtZvWjm9rSeieXTDxLtLp3kGDGWADG+8JW/k+2W2/BYkDVfhsM1qRPMAmOABZECOyB5kOuK+biEXii87PG8WeRy1h+Ay9p3T5XPF54HGnsoOth6oUFy1RY/QXwUidmOG7xW74/0en39W1d7CLwY38FTHDXIjlmrHlSp2+G0gT/E8FZ8x1eoiPdTKvHnsqEsZTKSZlOkVxAgQ2YlQt5i1wmCEqMJviZq/Wv1I=",
  "base64",
);

function publicProviderMetadataFixture(): readonly Record<string, unknown>[] {
  return PUBLIC_PROVIDER_PLATFORMS.map(([os, arch]) => {
    const filename = `terraform-provider-takoform_4.0.0_${os}_${arch}.zip`;
    const checksum = publicProviderChecksums.find(([, name]) => name === filename)?.[0];
    if (!checksum) throw new Error(`missing fixture checksum for ${filename}`);
    return {
      protocols: ["6.0"],
      os,
      arch,
      filename,
      download_url: `https://github.com/tako0614/terraform-provider-takoform/releases/download/v4.0.0/${filename}`,
      shasums_url: PUBLIC_PROVIDER_CHECKSUM_SOURCE,
      shasums_signature_url: PUBLIC_PROVIDER_SIGNATURE_SOURCE,
      shasum: checksum,
      signing_keys: {
        gpg_public_keys: [{
          key_id: PUBLIC_PROVIDER_SIGNING_KEY_ID,
          ascii_armor: PUBLIC_PROVIDER_SIGNING_KEY_ARMOR,
          trust_signature: "",
          source: "",
          source_url: null,
        }],
      },
    };
  });
}

const publicProviderMetadata = publicProviderMetadataFixture();
const publicProviderFetch: FetchFunction = async (input) => {
  const url = new URL(String(input));
  const registryPrefix = `${PUBLIC_PROVIDER_REGISTRY_DOWNLOAD_BASE}/`;
  if (url.toString().startsWith(registryPrefix)) {
    const metadata = publicProviderMetadata.find((entry) => `${entry.os}/${entry.arch}` === url.toString().slice(registryPrefix.length));
    if (!metadata) return new Response("missing platform", { status: 404 });
    return new Response(JSON.stringify(metadata), { status: 200 });
  }
  if (url.toString() === PUBLIC_PROVIDER_CHECKSUM_SOURCE) return new Response(publicProviderChecksumText, { status: 200 });
  if (url.toString() === PUBLIC_PROVIDER_SIGNATURE_SOURCE) return new Response(Uint8Array.from(publicProviderSignature), { status: 200 });
  throw new Error(`unexpected provider provenance URL ${url}`);
};

const releaseAssetQuery = {
  sp: "r",
  sv: "2018-11-09",
  sr: "b",
  spr: "https",
  se: "2099-01-01T00:00:00Z",
  rscd: "",
  rsct: "application/octet-stream",
  skoid: "01234567-89ab-cdef-0123-456789abcdef",
  sktid: "01234567-89ab-cdef-0123-456789abcdef",
  skt: "2099-01-01T00:00:00Z",
  ske: "2099-01-01T00:00:00Z",
  sks: "b",
  skv: "2018-11-09",
  sig: "signed-release-asset-token",
  jwt: "signed-release-asset-jwt",
  "response-content-disposition": "",
  "response-content-type": "application/octet-stream",
} as const;

function githubReleaseAssetUrl(filename: string): string {
  const url = new URL("https://release-assets.githubusercontent.com/github-production-release-asset/1302857015/01234567-89ab-cdef-0123-456789abcdef");
  const disposition = `attachment; filename=${filename}`;
  for (const [key, value] of Object.entries({
    ...releaseAssetQuery,
    rscd: disposition,
    "response-content-disposition": disposition,
  })) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function redirectedPublicProviderFetch(options: {
  readonly checksumLocation?: string;
  readonly signatureLocation?: string;
  readonly secondChecksumRedirect?: string;
} = {}): FetchFunction {
  let registryIndex = 0;
  const checksumLocation = options.checksumLocation ?? githubReleaseAssetUrl("terraform-provider-takoform_4.0.0_SHA256SUMS");
  const signatureLocation = options.signatureLocation ?? githubReleaseAssetUrl("terraform-provider-takoform_4.0.0_SHA256SUMS.sig");
  return async (input) => {
    const url = String(input);
    if (url.startsWith(`${PUBLIC_PROVIDER_REGISTRY_DOWNLOAD_BASE}/`)) {
      return new Response(JSON.stringify(publicProviderMetadata[registryIndex++]));
    }
    if (url === PUBLIC_PROVIDER_CHECKSUM_SOURCE) {
      return new Response(null, { status: 302, headers: { location: checksumLocation } });
    }
    if (url === PUBLIC_PROVIDER_SIGNATURE_SOURCE) {
      return new Response(null, { status: 302, headers: { location: signatureLocation } });
    }
    if (options.secondChecksumRedirect && url === checksumLocation) {
      return new Response(null, { status: 302, headers: { location: options.secondChecksumRedirect } });
    }
    if (url === checksumLocation) return new Response(publicProviderChecksumText);
    if (url === signatureLocation) return new Response(Uint8Array.from(publicProviderSignature));
    throw new Error(`unexpected provider provenance URL ${url}`);
  };
}

function strictPlanFixture(environment: Record<string, string | undefined>): Record<string, unknown> {
  const projectName = environment.TF_VAR_project_name as string;
  const space = environment.TF_VAR_space as string;
  const configValue = environment.TF_VAR_config_value as string;
  const runNonce = environment.TF_VAR_project_nonce as string;
  const runUid = environment.TF_VAR_project_uid as string;
  const revisions = createRevisionNameContext({
    projectName,
    configValue,
    nonce: runNonce,
    projectUid: runUid,
    workerModuleSha256: "sha256:0a0076dcbdef296ac1f61d506f1ef25e75531001beb116e84041a8c186c68765",
    workerModuleSize: 1871,
    bundleManifestDigest: "sha256:9053305f3308c67b2a25758422bf72b83980974c3f0f4c16c4866b0e578302b9",
  });
  const commonUnknown = {
    conditions: true,
    form_api_version: true,
    form_definition_version: true,
    form_kind: true,
    form_package_digest: true,
    form_schema_digest: true,
    generation: true,
    outputs_json: true,
    pending_operation_id: true,
    ready: true,
    relation_drift_reason: true,
    revision: true,
    uid: true,
  };
  const commonSensitive = { conditions: [] };
  const change = (type: string, after: unknown, afterUnknown: unknown, afterSensitive: unknown) => ({
    address: `${type}.app`,
    mode: "managed",
    type,
    name: "app",
    provider_name: PROVIDER_SOURCE,
    change: {
      actions: ["create"],
      before: null,
      after,
      after_unknown: afterUnknown,
      before_sensitive: false,
      after_sensitive: afterSensitive,
    },
  });
  const changes = [
    change("takoform_module_worker", { create_timeout: null, delete_timeout: null, name: projectName, space }, commonUnknown, commonSensitive),
    change("takoform_worker_bundle", {
      create_timeout: null,
      delete_timeout: null,
      main_module: "worker.mjs",
      manifest_digest: revisions.bundleManifestDigest,
      modules: [{ content_file: "./worker.mjs", content_type: "application/javascript+module", digest: "sha256:0a0076dcbdef296ac1f61d506f1ef25e75531001beb116e84041a8c186c68765", name: "worker.mjs", size: 1871 }],
      name: revisions.bundleName,
      revision_owner: projectName,
      space,
    }, { ...commonUnknown, modules: [{}] }, { ...commonSensitive, modules: [{}] }),
    change("takoform_worker_version", {
      actor_bindings: [],
      apply_idempotency_key: null,
      assets: null,
      bucket_bindings: [],
      bundle: revisions.bundleName,
      create_timeout: null,
      delete_timeout: null,
      external_services: [],
      handlers: ["fetch"],
      kv_bindings: [],
      name: revisions.workerVersionName,
      queue_producer_bindings: [],
      required_sensitive_vars: [],
      revision_owner: projectName,
      service_bindings: [],
      space,
      sqlite_bindings: [],
      vars_json: JSON.stringify({ TAKOS_FETCH_TRACER_CONFIG: configValue, TAKOS_FETCH_TRACER_NONCE: runNonce, TAKOS_FETCH_TRACER_PROJECT_UID: runUid }),
      worker: projectName,
      workflow_bindings: [],
    }, {
      actor_bindings: [],
      bucket_bindings: true,
      conditions: true,
      external_services: [],
      form_api_version: true,
      form_definition_version: true,
      form_kind: true,
      form_package_digest: true,
      form_schema_digest: true,
      generation: true,
      handlers: [false],
      kv_bindings: [],
      outputs_json: true,
      pending_operation_id: true,
      queue_producer_bindings: [],
      ready: true,
      relation_drift_reason: true,
      required_sensitive_vars: [],
      revision: true,
      service_bindings: [],
      sqlite_bindings: [],
      uid: true,
      workflow_bindings: [],
    }, {
      actor_bindings: [],
      bucket_bindings: [],
      conditions: [],
      external_services: [],
      handlers: [false],
      kv_bindings: [],
      queue_producer_bindings: [],
      required_sensitive_vars: [],
      service_bindings: [],
      sqlite_bindings: [],
      workflow_bindings: [],
    }),
    change("takoform_worker_deployment", {
      create_timeout: null,
      delete_timeout: null,
      name: `${projectName}-deployment`,
      space,
      update_timeout: null,
      versions: [{ weight: 10000, worker_version: revisions.workerVersionName }],
      worker: projectName,
    }, { ...commonUnknown, versions: [{}] }, { ...commonSensitive, versions: [{}] }),
    change("takoform_worker_endpoint", {
      create_timeout: null,
      delete_timeout: null,
      name: `${projectName}-endpoint`,
      space,
      worker: projectName,
    }, { ...commonUnknown, hostname: true, url: true }, commonSensitive),
  ];
  const output = (after: unknown, afterUnknown: unknown, hasAfter = true) => ({
    actions: ["create"],
    before: null,
    ...(hasAfter ? { after } : {}),
    after_unknown: afterUnknown,
    before_sensitive: false,
    after_sensitive: false,
  });
  const identityAfter = {
    module_worker: { hostname: null, name: projectName, space, url: null },
    worker_bundle: { hostname: null, name: revisions.bundleName, space, url: null },
    worker_deployment: { hostname: null, name: `${projectName}-deployment`, space, url: null },
    worker_endpoint: { name: `${projectName}-endpoint`, space },
    worker_version: { hostname: null, name: revisions.workerVersionName, space, url: null },
  };
  const identityUnknown = {
    module_worker: { form_api_version: true, form_definition_version: true, form_kind: true, form_schema_digest: true, generation: true, ready: true, revision: true, uid: true },
    worker_bundle: { form_api_version: true, form_definition_version: true, form_kind: true, form_schema_digest: true, generation: true, ready: true, revision: true, uid: true },
    worker_deployment: { form_api_version: true, form_definition_version: true, form_kind: true, form_schema_digest: true, generation: true, ready: true, revision: true, uid: true },
    worker_endpoint: { form_api_version: true, form_definition_version: true, form_kind: true, form_schema_digest: true, generation: true, hostname: true, ready: true, revision: true, uid: true, url: true },
    worker_version: { form_api_version: true, form_definition_version: true, form_kind: true, form_schema_digest: true, generation: true, ready: true, revision: true, uid: true },
  };
  return {
    resource_changes: changes,
    output_changes: {
      config_value: output(configValue, false),
      endpoint_hostname: output(undefined, true, false),
      endpoint_url: output(undefined, true, false),
      project_nonce: output(runNonce, false),
      project_uid: output(runUid, false),
      resource_identities: output(identityAfter, identityUnknown),
    },
  };
}

function identity(
  key: "module_worker" | "worker_bundle" | "worker_version" | "worker_deployment" | "worker_endpoint",
  projectName = "takos-fetch-tracer",
  revisions?: RevisionNameContext,
): ResourceIdentity {
  const form = PROVIDER4_FORM_REFS[key];
  return {
    name: projectResourceName(key, projectName, revisions),
    space: "space-a",
    uid: `uid-${key}`,
    generation: "1",
    revision: "1",
    ready: true,
    form_api_version: form.apiVersion,
    form_kind: form.kind,
    form_definition_version: form.definitionVersion,
    form_schema_digest: form.schemaDigest,
    hostname: key === "worker_endpoint" ? `${projectName}.invalid` : null,
    url: key === "worker_endpoint" ? `https://${projectName}.invalid/` : null,
  };
}

function identities(projectName = "takos-fetch-tracer"): Record<string, ResourceIdentity> {
  return {
    module_worker: identity("module_worker", projectName),
    worker_bundle: identity("worker_bundle", projectName),
    worker_version: identity("worker_version", projectName),
    worker_deployment: identity("worker_deployment", projectName),
    worker_endpoint: identity("worker_endpoint", projectName),
  };
}

function neverEndingStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start() {
      // The abort signal supplied by runBoundedCommand cancels this reader.
    },
  });
}

describe("takoserver fetch tracer pure contracts", () => {
  test("parses the exact JSON media type without accepting JSONP lookalikes", () => {
    expect(isJsonMediaType("application/json")).toBe(true);
    expect(isJsonMediaType("Application/JSON; charset=utf-8")).toBe(true);
    expect(isJsonMediaType(" application/json ; profile=\"urn:test;v=1\" ")).toBe(true);
    expect(isJsonMediaType("application/jsonp")).toBe(false);
    expect(isJsonMediaType("application/json; charset")).toBe(false);
    expect(isJsonMediaType("application/json; charset=\"unterminated")).toBe(false);
  });

  test("requires explicit opt-in, keeps credentials in env, and rejects local providers", () => {
    expect(() => parseArgs(["--host", "https://host.example", "--space", "space-a"], {
      [MUTATION_TOKEN_ENV]: token,
      [EVIDENCE_TOKEN_ENV]: evidenceToken,
    })).toThrow(/refusing to mutate/u);
    expect(() => parseArgs([
      "--run",
      "--host", "https://host.example",
      "--space", "space-a",
      "--token", token,
    ], { [MUTATION_TOKEN_ENV]: token, [EVIDENCE_TOKEN_ENV]: evidenceToken })).toThrow(/never argv/u);
    expect(() => parseArgs([
      "--run",
      "--host", "https://host.example",
      "--space", "space-a",
      "--evidence-token", evidenceToken,
    ], { [MUTATION_TOKEN_ENV]: token, [EVIDENCE_TOKEN_ENV]: evidenceToken })).toThrow(/never argv/u);
    expect(() => parseArgs([
      "--run",
      "--host", "https://host.example",
      "--space", "space-a",
      "--provider-binary", "/tmp/provider",
    ], { [MUTATION_TOKEN_ENV]: token, [EVIDENCE_TOKEN_ENV]: evidenceToken })).toThrow(/local provider/u);

    expect(() => parseArgs([
      "--run",
      "--host", "https://host.example",
      "--space", "space-a",
    ], { [MUTATION_TOKEN_ENV]: token, [EVIDENCE_TOKEN_ENV]: evidenceToken })).toThrow(/organization/u);

    const config = parseArgs([
      "--run",
      "--host", "https://host.example",
      "--space", "space-a",
      "--organization-id", "org-integration-e2e",
    ], { [MUTATION_TOKEN_ENV]: token, [EVIDENCE_TOKEN_ENV]: evidenceToken });
    expect(config.organizationId).toBe("org-integration-e2e");
    expect(config.token).toBe(token);
    expect(config.tokenEnv).toBe(MUTATION_TOKEN_ENV);
    expect(config.evidenceToken).toBe(evidenceToken);
    expect(config.evidenceTokenEnv).toBe(EVIDENCE_TOKEN_ENV);

    const customEnvConfig = parseArgs([
      "--run",
      "--host", "https://host.example",
      "--space", "space-a",
      "--organization-id", "org-integration-e2e",
      "--token-env", "CUSTOM_MUTATION_TOKEN",
      "--evidence-token-env", "CUSTOM_EVIDENCE_TOKEN",
    ], { CUSTOM_MUTATION_TOKEN: token, CUSTOM_EVIDENCE_TOKEN: evidenceToken });
    expect(customEnvConfig.token).toBe(token);
    expect(customEnvConfig.evidenceToken).toBe(evidenceToken);
    expect(() => parseArgs([
      "--run",
      "--host", "https://host.example",
      "--space", "space-a",
      "--organization-id", "org-integration-e2e",
      "--token-env", "PATH",
    ], { PATH: token, [EVIDENCE_TOKEN_ENV]: evidenceToken })).toThrow(/inherited process environment/u);

    expect(() => parseArgs([
      "--run",
      "--host", "https://host.example",
      "--space", "space-a",
      "--organization-id", "org-integration-e2e",
      "--config-value", "prefix-" + token + "-suffix",
    ], { [MUTATION_TOKEN_ENV]: token, [EVIDENCE_TOKEN_ENV]: evidenceToken })).toThrow(/must not contain a token/u);

    const environment = buildTofuEnvironment({
      host: config.host,
      space: config.space,
      token,
      configValue: "safe-config",
      cliConfigFile: "/tmp/tofu.tfrc",
      tfDataDir: "/tmp/tofu-data",
    });
    expect(environment.TAKOFORM_TOKEN).toBe(token);
    expect(environment.TAKOFORM_EVIDENCE_TOKEN).toBeUndefined();
    expect(environment.TF_VAR_config_value).toBe("safe-config");
    expect(environment.TF_CLI_CONFIG_FILE).toBe("/tmp/tofu.tfrc");
    expect(environment.TF_DATA_DIR).toBe("/tmp/tofu-data");
    const tokenless = buildTofuEnvironment({
      host: config.host,
      space: config.space,
      token,
      includeToken: false,
      configValue: "safe-config",
      cliConfigFile: "/tmp/tofu.tfrc",
      tfDataDir: "/tmp/tofu-data",
      projectNonce: nonce,
      projectUid,
    });
    expect(tokenless.TAKOFORM_TOKEN).toBeUndefined();
    expect(tokenless.TF_VAR_project_nonce).toBe(nonce);
    expect(tokenless.TF_VAR_project_uid).toBe(projectUid);

    const collision = buildTofuEnvironment({
      base: {
        PATH: "/safe/bin",
        TF_CLI_CONFIG_FILE: "/caller/config",
        TF_DATA_DIR: "/caller/data",
        TF_WORKSPACE: "caller-workspace",
        TF_CLI_ARGS_apply: "-lock=false",
        TF_LOG: "TRACE",
        TF_PLUGIN_CACHE_DIR: "/caller/cache",
        TF_REATTACH_PROVIDERS: "caller-reattach",
        TF_REGISTRY_CLIENT_CERT: "caller-cert",
        AWS_SECRET_ACCESS_KEY: "caller-secret",
        CALLER_TOKEN: "caller-token",
      },
      host: config.host,
      space: config.space,
      token,
      tokenEnv: "TF_CLI_CONFIG_FILE",
      configValue: "safe-config",
      cliConfigFile: "/owned/tofu.tfrc",
      tfDataDir: "/owned/tofu-data",
      projectName: "takos-fetch-tracer-abc",
    });
    expect(collision.PATH).toBe("/safe/bin");
    expect(collision.TF_CLI_CONFIG_FILE).toBe("/owned/tofu.tfrc");
    expect(collision.TF_DATA_DIR).toBe("/owned/tofu-data");
    expect(collision.TAKOFORM_TOKEN).toBe(token);
    expect(collision.TAKOFORM_EVIDENCE_TOKEN).toBeUndefined();
    expect(collision.TF_WORKSPACE).toBeUndefined();
    expect(collision.TF_CLI_ARGS_apply).toBeUndefined();
    expect(collision.TF_LOG).toBeUndefined();
    expect(collision.TF_PLUGIN_CACHE_DIR).toBeUndefined();
    expect(collision.TF_REATTACH_PROVIDERS).toBeUndefined();
    expect(collision.TF_REGISTRY_CLIENT_CERT).toBeUndefined();
    expect(collision.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(collision.CALLER_TOKEN).toBeUndefined();
    expect(() => buildTofuEnvironment({
      base: { HTTPS_PROXY: "https://operator:secret@proxy.example" },
      host: config.host,
      space: config.space,
      token,
      configValue: "safe-config",
      cliConfigFile: "/owned/tofu.tfrc",
      tfDataDir: "/owned/tofu-data",
    })).toThrow(/proxy environment/u);
    expect(() => buildTofuEnvironment({
      base: { PATH: "/safe/../unsafe" },
      host: config.host,
      space: config.space,
      token,
      configValue: "safe-config",
      cliConfigFile: "/owned/tofu.tfrc",
      tfDataDir: "/owned/tofu-data",
    })).toThrow(/unsafe path/u);
  });

  test("validates bare origins, SpaceIDs, and digest spelling", () => {
    expect(validateBareOrigin("https://host.example")).toBe("https://host.example");
    expect(validateBareOrigin("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
    expect(() => validateBareOrigin("https://host.example/path")).toThrow();
    expect(() => validateBareOrigin("http://host.example")).toThrow(/HTTPS/u);
    expect(validateSpace("team alpha")).toBe("team alpha");
    expect(() => validateSpace(" team")).toThrow();
    expect(() => validateSpace("team/name")).toThrow();
    expect(canonicalDigest("A".repeat(64))).toBe(`sha256:${"a".repeat(64)}`);
    expect(() => canonicalDigest("sha256:abc")).toThrow();
  });

  test("requires an exact project-derived HTTPS endpoint origin and rejects SSRF targets", async () => {
    expect(validateEndpointOriginTemplate("https://{project}.workers.example/")).toBe("https://{project}.workers.example/");
    expect(materializeEndpointOrigin("https://{project}.workers.example/", "takos-fetch-tracer-abc")).toBe("https://takos-fetch-tracer-abc.workers.example/");
    expect(() => validateEndpointOriginTemplate("https://workers.example/")).toThrow(/placeholder/u);
    expect(() => validateEndpointOriginTemplate("https://{project}.invalid/path")).toThrow();
    expect(() => validateEndpointOriginTemplate("https://127.0.0.1/{project}/")).toThrow();
    expect(() => validateEndpointOriginTemplate("https://{project}.localhost/")).toThrow();
    expect(() => validateEndpointOriginTemplate("https://{project}.127.0.0.1.nip.io/")).toThrow();
    expect(() => validateEndpointOriginTemplate("http://{project}.workers.example/")).toThrow();
    const config = parseArgs([
      "--run", "--host", "https://host.example", "--space", "space-a",
      "--organization-id", "org-integration-e2e",
    ], { [MUTATION_TOKEN_ENV]: token, [EVIDENCE_TOKEN_ENV]: evidenceToken });
    await expect(runTracer(config, { spawn: () => { throw new Error("must fail before spawn"); } })).rejects.toThrow(/non-.invalid/u);
  });

  test("proves assigned endpoint absence separately from Host resource absence", async () => {
    const requests: string[] = [];
    const evidence = await assertEndpointAbsence({
      assignedUrl: "https://takos-fetch-tracer-abc.workers.example/",
      expectedOrigin: "https://takos-fetch-tracer-abc.workers.example/",
      targetHost: "https://host.example",
      nonce,
      timeoutMs: 100,
      fetchImpl: async (input, init) => {
        requests.push(`${String(input)}:${new Headers(init?.headers).get("authorization") ?? "none"}`);
        return new Response("gone", { status: 410 });
      },
    });
    expect(evidence).toMatchObject({ assignedUrl: "https://takos-fetch-tracer-abc.workers.example/", nonce, status: 410 });
    if (evidence.applicability !== "applicable") throw new Error("expected applicable endpoint absence evidence");
    expect(evidence.bodySha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(requests).toEqual(["https://takos-fetch-tracer-abc.workers.example/:none"]);
    await expect(assertEndpointAbsence({
      assignedUrl: "https://127.0.0.1/",
      expectedOrigin: "https://127.0.0.1/",
      targetHost: "https://host.example",
      nonce,
      timeoutMs: 100,
      fetchImpl: async () => new Response("gone", { status: 404 }),
    })).rejects.toThrow(/hostname/u);
  });

  test("allows .invalid only for an explicit HTTP loopback diagnostic Host", async () => {
    const endpoint = identity("worker_endpoint");
    const diagnostic = await probeRuntime({
      endpoint,
      workerPath: join(import.meta.dir, "../../deploy/opentofu/takoserver-fetch-tracer/worker.mjs"),
      configValue: "safe-config",
      nonce,
      projectUid,
      expectedEndpointOrigin: "https://takos-fetch-tracer.invalid/",
      targetHost: "http://127.0.0.1:8787",
      timeoutMs: 500,
    });
    expect(diagnostic).toEqual({
      mode: "loopback-diagnostic",
      assignedUrl: "https://takos-fetch-tracer.invalid/",
      evidence: "diagnostic-only-not-host-runtime",
      checks: [
        { name: "root-correlation", path: "/", status: 200, anonymous: true },
        { name: "health", path: "/health", status: 200, anonymous: true },
        { name: "takos-discovery", path: "/.well-known/takos", status: 200, anonymous: true },
      ],
    });
    await expect(probeRuntime({
      endpoint,
      workerPath: join(import.meta.dir, "../../deploy/opentofu/takoserver-fetch-tracer/worker.mjs"),
      configValue: "safe-config",
      nonce,
      projectUid,
      expectedEndpointOrigin: "https://takos-fetch-tracer.invalid/",
      targetHost: "https://host.example",
      timeoutMs: 100,
      fetchImpl: async () => new Response("must not fetch", { status: 200 }),
    })).rejects.toThrow(/live Host/u);
  });

  test("accepts only a five-create saved plan", () => {
    const plan = {
      resource_changes: [
        "takoform_module_worker",
        "takoform_worker_bundle",
        "takoform_worker_version",
        "takoform_worker_deployment",
        "takoform_worker_endpoint",
      ].map((type) => ({ address: `${type}.app`, mode: "managed", type, name: "app", change: { actions: ["create"] } })),
    };
    expect(assertExactPlan(plan)).toEqual([
      "takoform_module_worker.app",
      "takoform_worker_bundle.app",
      "takoform_worker_deployment.app",
      "takoform_worker_endpoint.app",
      "takoform_worker_version.app",
    ]);
    expect(() => assertExactPlan({ resource_changes: [...plan.resource_changes, { address: "data.foo", mode: "data", type: "foo", name: "bar", change: { actions: ["read"] } }] })).toThrow(/exactly five/u);
    expect(() => assertExactPlan({ resource_changes: plan.resource_changes.map((entry, index) => index === 0 ? { ...entry, change: { actions: ["update"] } } : entry) })).toThrow(/create-only/u);
  });

  test("redacts exact secrets from diagnostics and rejects argv leakage", async () => {
    expect(redactOutput(`stdout ${token} stderr`, token)).toBe("stdout <redacted> stderr");
    const spawn = () => {
      throw new Error("spawn must not be reached");
    };
    await expect(runBoundedCommand({ command: "tofu", args: [token], cwd: "/tmp", env: {}, timeoutMs: 10, killGraceMs: 10, token, spawn })).rejects.toThrow(/argv/u);
  });

  test("walks serialized output recursively and rejects known secrets, proxy credentials, and unsafe paths", () => {
    expect(() => assertNoKnownSecrets({ outer: [{ inner: `prefix-${token}` }] }, token)).toThrow(/known secret/u);
    expect(() => assertNoKnownSecrets({ HTTP_PROXY: "https://proxy-user:proxy-pass@proxy.example" })).toThrow(/proxy credentials/u);
    expect(() => assertNoKnownSecrets({ recoveryPath: "/tmp/../operator-secret" })).toThrow(/unsafe path/u);
    expect(() => assertNoKnownSecrets({ diagnostic: "line\nwith-control" })).toThrow(/control character/u);
    expect(() => assertNoKnownSecrets({ TAKOFORM_TOKEN: "unredacted" })).toThrow(/credential field/u);
    expect(() => assertNoKnownSecrets({ safe: "https://host.example/", nested: [{ value: "plain" }] }, token)).not.toThrow();
  });

  test("keeps successful provenance bytes raw without weakening error redaction", async () => {
    const output = `diff contains ${token}`;
    const spawn = (): SpawnedChild => ({
      pid: 41_001,
      exited: Promise.resolve(0),
      stdout: new Response(output).body,
      stderr: new Response("").body,
    });
    const raw = await runBoundedCommand({
      command: "git",
      args: ["diff"],
      cwd: "/tmp",
      env: {},
      timeoutMs: 100,
      killGraceMs: 10,
      token,
      redactSuccessfulOutput: false,
      spawn,
    });
    expect(raw.stdout).toBe(output);
    const surfaced = await runBoundedCommand({
      command: "git",
      args: ["diff"],
      cwd: "/tmp",
      env: {},
      timeoutMs: 100,
      killGraceMs: 10,
      token,
      spawn,
    });
    expect(surfaced.stdout).toBe("diff contains <redacted>");
  });

  test("separates mutation and evidence credentials at every boundary", async () => {
    const config = parseArgs([
      "--run",
      "--host", "https://host.example",
      "--space", "space-a",
      "--organization-id", "org-integration-e2e",
    ], { [MUTATION_TOKEN_ENV]: token, [EVIDENCE_TOKEN_ENV]: evidenceToken });
    const childEnvironment = buildTofuEnvironment({
      host: config.host,
      space: config.space,
      token: config.token,
      configValue: "safe-config",
      cliConfigFile: "/tmp/tofu.tfrc",
      tfDataDir: "/tmp/tofu-data",
    });
    expect(childEnvironment.TAKOFORM_TOKEN).toBe(token);
    expect(childEnvironment.TAKOFORM_EVIDENCE_TOKEN).toBeUndefined();

    const authorizationHeaders: string[] = [];
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      authorizationHeaders.push(String(new Headers(init?.headers).get("authorization")));
      return new Response(JSON.stringify({
        api_versions: ["forms.takoform.com/v1"],
        features: {
          service_forms: true,
          exact_form_ref: true,
          optimistic_concurrency: true,
          idempotent_lifecycle: true,
          operations: true,
          artifact_upload: true,
          support_profiles: true,
        },
        endpoints: { api: "https://host.example/apis/forms.takoform.com/v1" },
      }), { status: 200 });
    };
    await discoverV1({ host: config.host, token: config.evidenceToken, timeoutMs: 100, fetchImpl });
    expect(authorizationHeaders).toEqual([`Bearer ${evidenceToken}`]);
  });

  test("uses evidence credentials for resource readback and absence GETs", async () => {
    const current = identity("module_worker");
    const readback = {
      apiVersion: current.form_api_version,
      kind: current.form_kind,
      form: { formRef: { apiVersion: current.form_api_version, kind: current.form_kind, definitionVersion: current.form_definition_version, schemaDigest: current.form_schema_digest } },
      metadata: { name: current.name, space: current.space, uid: current.uid, generation: current.generation, revision: current.revision },
      spec: {},
      status: { observedGeneration: current.generation, conditions: [{ type: "Ready", status: "True", reason: "Available", lastTransitionTime: "2026-01-01T00:00:00Z" }] },
    };
    const authorizationHeaders: string[] = [];
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      authorizationHeaders.push(String(new Headers(init?.headers).get("authorization")));
      if (authorizationHeaders.length === 1) return new Response(JSON.stringify(readback), { status: 200 });
      return new Response(JSON.stringify({ error: { code: "resource_not_found", message: "gone", requestId: "request-1", retryable: false } }), { status: 404 });
    };
    await readHostResource({
      apiRoot: "https://host.example/apis/forms.takoform.com/v1",
      identity: current,
      token: evidenceToken,
      timeoutMs: 100,
      fetchImpl,
    });
    await assertAuthoritativeAbsence({
      apiRoot: "https://host.example/apis/forms.takoform.com/v1",
      addresses: knownResourceAddresses("space-a"),
      token: evidenceToken,
      timeoutMs: 100,
      fetchImpl,
    });
    expect(authorizationHeaders).toHaveLength(6);
    expect(authorizationHeaders.every((value) => value === `Bearer ${evidenceToken}`)).toBe(true);
    expect(authorizationHeaders.every((value) => !value.includes(token))).toBe(true);
  });

  test("uses one total deadline across delayed Host headers and body", async () => {
    jest.useFakeTimers({ now: 0 });
    const realSetTimeout = globalThis.setTimeout;
    let parentDeadline: (() => void) | undefined;
    const bodyDeadlines: Array<() => void> = [];
    globalThis.setTimeout = ((
      handler: Parameters<typeof globalThis.setTimeout>[0],
      _delay?: Parameters<typeof globalThis.setTimeout>[1],
    ): ReturnType<typeof globalThis.setTimeout> => {
      if (typeof handler !== "function") throw new Error("test timer handler must be callable");
      const callback = (): void => handler();
      if (parentDeadline) bodyDeadlines.push(callback);
      else parentDeadline = callback;
      return realSetTimeout(() => undefined, 0);
    }) as typeof globalThis.setTimeout;

    let requestSignal: AbortSignal | undefined;
    let bodyCancelled = false;
    let bodyAttemptResolve: ((aborted: boolean) => void) | undefined;
    const bodyAttempt = new Promise<boolean>((resolve) => {
      bodyAttemptResolve = resolve;
    });
    let releaseHeaders: (() => void) | undefined;
    const headersReady = new Promise<void>((resolve) => {
      releaseHeaders = resolve;
    });
    const fetchImpl: FetchFunction = async (_input, init) => {
      requestSignal = init?.signal ?? undefined;
      await headersReady;
      const body = new ReadableStream<Uint8Array>({
        pull() {
          return new Promise<never>(() => undefined);
        },
        cancel() {
          bodyCancelled = true;
          bodyAttemptResolve?.(requestSignal?.aborted ?? false);
        },
      });
      return new Response(body, { status: 200 });
    };

    try {
      const run = discoverV1({
        host: "https://host.example",
        token: evidenceToken,
        timeoutMs: 50,
        fetchImpl,
      });
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
      jest.setSystemTime(25);
      releaseHeaders?.();
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
      expect(parentDeadline).toBeDefined();

      // Force the body cancellation callback to win the exact deadline race.
      // A real timer scheduler can deliver the two callbacks in either order;
      // this controlled clock makes the parent-signal contract deterministic.
      jest.setSystemTime(50);
      if (bodyDeadlines.length > 0) bodyDeadlines[0]();
      else parentDeadline?.();

      await expect(run).rejects.toThrow(/deadline/u);
      expect(await bodyAttempt).toBe(true);
      expect(bodyCancelled).toBe(true);
      expect(Date.now()).toBe(50);
    } finally {
      globalThis.setTimeout = realSetTimeout;
      jest.useRealTimers();
    }
  });

  test("retains a standalone timeoutMs when an external signal never aborts", async () => {
    jest.useFakeTimers({ now: 0 });
    const external = new AbortController();
    let bodyCancelled = false;
    let run: Promise<string> | undefined;
    try {
      const body = new ReadableStream<Uint8Array>({
        pull() {
          return new Promise<never>(() => undefined);
        },
        cancel() {
          bodyCancelled = true;
        },
      });
      run = readResponseBody(new Response(body, { status: 200 }), {
        signal: external.signal,
        timeoutMs: 25,
      });
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
      jest.advanceTimersByTime(25);
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
      expect(bodyCancelled).toBe(true);
      await expect(run).rejects.toThrow(/deadline/u);
    } finally {
      external.abort();
      await run?.catch(() => undefined);
      jest.useRealTimers();
    }
  });

  test("aborts the request signal when the wall-clock guard reaches its deadline first", async () => {
    jest.useFakeTimers({ now: 0 });
    let requestSignal: AbortSignal | undefined;
    let bodyCancelled = false;
    let clockAdvanced = false;
    const fetchImpl: FetchFunction = async (_input, init) => {
      requestSignal = init?.signal ?? undefined;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!clockAdvanced) {
            clockAdvanced = true;
            jest.setSystemTime(51);
          }
          controller.enqueue(new Uint8Array());
        },
        cancel() {
          bodyCancelled = true;
        },
      });
      return new Response(body, { status: 200 });
    };

    try {
      await expect(discoverV1({
        host: "https://host.example",
        token: evidenceToken,
        timeoutMs: 50,
        fetchImpl,
      })).rejects.toThrow(/deadline/u);
      expect(requestSignal?.aborted).toBe(true);
      expect(bodyCancelled).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test("bounds a Host fetch that ignores AbortSignal and cancels its late body", async () => {
    let bodyCancelled = false;
    const fetchImpl: FetchFunction = async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      const body = new ReadableStream<Uint8Array>({
        cancel() {
          bodyCancelled = true;
        },
      });
      return new Response(body, { status: 200 });
    };
    const started = Date.now();
    await expect(discoverV1({
      host: "https://host.example",
      token: evidenceToken,
      timeoutMs: 25,
      fetchImpl,
    })).rejects.toThrow(/deadline/u);
    expect(Date.now() - started).toBeLessThan(100);
    // The custom fetch resolves after the deadline and ignores the supplied
    // signal; fetchWithTimeout must still dispose of the late response body.
    await new Promise<void>((resolve) => setTimeout(resolve, 125));
    expect(bodyCancelled).toBe(true);
  });

  test("terminates the process group on a hard timeout", async () => {
    const signals: Array<string | number | undefined> = [];
    const child: SpawnedChild = {
      pid: 987654,
      exited: new Promise<number>(() => undefined),
      stdout: neverEndingStream(),
      stderr: neverEndingStream(),
      kill(signal) {
        signals.push(signal);
      },
    };
    await expect(runBoundedCommand({ command: "tofu", cwd: "/tmp", env: {}, timeoutMs: 10, killGraceMs: 10, spawn: () => child })).rejects.toMatchObject({ name: "CommandTimeoutError" });
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  test("accepts only the exact public Provider 4.0.0 lockfile", () => {
    const lockfile = [
      'provider "registry.terraform.io/tako0614/takoform" {',
      '  version     = "4.0.0"',
      '  constraints = "4.0.0"',
      '  hashes = [',
      ...[...PUBLIC_PROVIDER_H1_HASHES, ...PUBLIC_PROVIDER_ZH_HASHES].map((hash) => `    "${hash}"`),
      '  ]',
      '}',
      "",
    ].join("\n");
    const lock = assertProviderLockfile(lockfile);
    expect(lock.address).toBe(PROVIDER_SOURCE);
    expect(lock.version).toBe(PROVIDER_VERSION);
    expect(PROVIDER_SOURCE).toBe("registry.terraform.io/tako0614/takoform");
    expect(PROVIDER_CONSTRAINT).toBe("= 4.0.0");
    expect(() => assertProviderLockfile(lockfile.replace("4.0.0", "4.0.1"))).toThrow();
    expect(() => assertProviderLockfile(lockfile.replace("provider", "provider_installation"))).toThrow();
  });

  test("regresses the registry platform metadata to the signed GitHub release and six zh checksums", () => {
    const platforms = [
      ["darwin", "amd64", "a2b1f6c0bda3065c1e181db3b97eef52d9c823a74dc25e19339a4881ff501b17"],
      ["darwin", "arm64", "1a70d45661665b3ad799196637e93dd7765323b32fbc7eba7bd30496e225e3bd"],
      ["linux", "amd64", "23fc2f43deec7e9bf20a4fe8253169fdbaa163840a8fdf8dfe1f4293f2346044"],
      ["linux", "arm64", "3a7d9e2f0edf19713a1df989b32541efe1ac5cf0926ca7a0c3b421e8acd3a633"],
      ["windows", "amd64", "ecd934d19ff177229afd0a9248ea2b37ef2a8bba8182f03acf21b36b4b9e2298"],
    ] as const;
    const metadata = platforms.map(([os, arch, shasum]) => ({
      protocols: ["6.0"],
      os,
      arch,
      filename: `terraform-provider-takoform_4.0.0_${os}_${arch}.zip`,
      download_url: `https://github.com/tako0614/terraform-provider-takoform/releases/download/v4.0.0/terraform-provider-takoform_4.0.0_${os}_${arch}.zip`,
      shasums_url: PUBLIC_PROVIDER_CHECKSUM_SOURCE,
      shasums_signature_url: PUBLIC_PROVIDER_SIGNATURE_SOURCE,
      shasum,
      signing_keys: {
        gpg_public_keys: [{
          key_id: PUBLIC_PROVIDER_SIGNING_KEY_ID,
          ascii_armor: PUBLIC_PROVIDER_SIGNING_KEY_ARMOR,
          trust_signature: "",
          source: "",
          source_url: null,
        }],
      },
    }));
    const checksums = publicProviderChecksumText;
    const evidence = verifyPublicProviderRelease({
      metadata,
      checksums: new TextEncoder().encode(checksums),
      signature: publicProviderSignature,
    });
    expect(evidence.checksumSource).toBe(PUBLIC_PROVIDER_CHECKSUM_SOURCE);
    expect(evidence.signatureSource).toBe(PUBLIC_PROVIDER_SIGNATURE_SOURCE);
    expect(evidence.signingKeyId).toBe(PUBLIC_PROVIDER_SIGNING_KEY_ID);
    expect(evidence.signingKeyFingerprint).toBe(PUBLIC_PROVIDER_SIGNING_KEY_FINGERPRINT);
    expect([...parsePublicProviderChecksums(checksums)].sort()).toEqual([...PUBLIC_PROVIDER_ZH_HASHES].sort());
    expect(() => assertProviderRegistryMetadata(metadata.map((entry) => ({ ...entry, shasums_url: "https://registry.terraform.io/v1/providers/tako0614/takoform/4.0.0/download" })), checksums)).toThrow(/SHA256SUMS URL/u);
    expect(() => assertProviderRegistryMetadata(metadata.map((entry) => ({ ...entry, protocols: ["5.0"] })), checksums)).toThrow(/protocols/u);
    expect(() => verifyPublicProviderRelease({
      metadata,
      checksums: new TextEncoder().encode(checksums.replace(publicProviderChecksums[0][0], "0".repeat(64))),
      signature: publicProviderSignature,
    })).toThrow(/checksum|signature/u);
    const modifiedSignature = Uint8Array.from(publicProviderSignature);
    modifiedSignature[modifiedSignature.length - 1] ^= 0x01;
    expect(() => verifyPublicProviderRelease({ metadata, checksums: new TextEncoder().encode(checksums), signature: modifiedSignature })).toThrow(/signature/u);
    expect(() => assertProviderRegistryMetadata(metadata.map((entry) => ({
      ...entry,
      signing_keys: {
        gpg_public_keys: [{
          key_id: PUBLIC_PROVIDER_SIGNING_KEY_ID,
          ascii_armor: "Takoform Provider Release Signing",
          trust_signature: "",
          source: "",
          source_url: null,
        }],
      },
    })), checksums)).toThrow(/armor|signing key/u);
    expect(() => assertProviderRegistryMetadata(metadata.map((entry) => ({
      ...entry,
      signing_keys: {
        gpg_public_keys: [{
          key_id: PUBLIC_PROVIDER_SIGNING_KEY_ID,
          ascii_armor: PUBLIC_PROVIDER_SIGNING_KEY_ARMOR.replace("mQIN", "mQIO"),
          trust_signature: "",
          source: "",
          source_url: null,
        }],
      },
    })), checksums)).toThrow(/armor|CRC|fingerprint|public key/u);
    expect(() => assertProviderRegistryMetadata(metadata.map((entry) => ({
      ...entry,
      download_url: "https://registry.terraform.io/v1/providers/tako0614/takoform/4.0.0/download/linux/amd64",
    })), checksums)).toThrow(/archive URL/u);
    expect(() => assertProviderRegistryMetadata(metadata.slice(1), checksums)).toThrow(/exactly five|platform/u);
  });

  test("accepts one exact GitHub release-assets hop and rejects redirect confusion", async () => {
    const checksumsLocation = githubReleaseAssetUrl("terraform-provider-takoform_4.0.0_SHA256SUMS");
    const signatureLocation = githubReleaseAssetUrl("terraform-provider-takoform_4.0.0_SHA256SUMS.sig");
    const evidence = await fetchPublicProviderRelease({
      timeoutMs: 500,
      fetchImpl: redirectedPublicProviderFetch({ checksumLocation: checksumsLocation, signatureLocation }),
    });
    expect(evidence.signatureVerified).toBe(true);

    const expectedFilename = "terraform-provider-takoform_4.0.0_SHA256SUMS";
    const missingSp = new URL(checksumsLocation);
    missingSp.searchParams.delete("sp");
    const invalidLocations = [
      checksumsLocation.replace("https://release-assets", "https://user:password@release-assets"),
      checksumsLocation.replace("release-assets.githubusercontent.com/", "release-assets.githubusercontent.com:8443/"),
      `${checksumsLocation}#unexpected-fragment`,
      checksumsLocation.replace("/github-production-release-asset/", "/wrong-release-asset/"),
      checksumsLocation.replace("release-assets.githubusercontent.com", "objects.githubusercontent.com"),
      `${checksumsLocation}&unexpected=1`,
      missingSp.toString(),
      checksumsLocation.replace("github-production-release-asset", "GitHub-production-release-asset"),
      githubReleaseAssetUrl("terraform-provider-takoform_4.0.0_other.txt"),
    ];
    for (const location of invalidLocations) {
      expect(() => assertGithubReleaseRedirect(new URL(location), expectedFilename)).toThrow(/redirect/u);
    }

    const secondHop = githubReleaseAssetUrl(expectedFilename).replace("1302857015", "1302857016");
    await expect(fetchPublicProviderRelease({
      timeoutMs: 500,
      fetchImpl: redirectedPublicProviderFetch({ secondChecksumRedirect: secondHop }),
    })).rejects.toThrow(/redirect/u);
  });

  test("bounds and cancels a never-ending release body across the full deadline", async () => {
    let registryIndex = 0;
    let cancelled = false;
    const neverEnding = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl: FetchFunction = async (input) => {
      const url = String(input);
      if (url.startsWith(`${PUBLIC_PROVIDER_REGISTRY_DOWNLOAD_BASE}/`)) {
        return new Response(JSON.stringify(publicProviderMetadata[registryIndex++]));
      }
      if (url === PUBLIC_PROVIDER_CHECKSUM_SOURCE) return new Response(neverEnding);
      throw new Error(`unexpected provider URL ${url}`);
    };
    await expect(fetchPublicProviderRelease({ timeoutMs: 25, fetchImpl })).rejects.toThrow(/deadline|timed out/u);
    expect(cancelled).toBe(true);
  });

  test("bounds a release body that resolves empty chunks without yielding to timers", async () => {
    let registryIndex = 0;
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array());
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl: FetchFunction = async (input) => {
      const url = String(input);
      if (url.startsWith(`${PUBLIC_PROVIDER_REGISTRY_DOWNLOAD_BASE}/`)) {
        return new Response(JSON.stringify(publicProviderMetadata[registryIndex++]));
      }
      if (url === PUBLIC_PROVIDER_CHECKSUM_SOURCE) return new Response(endless);
      throw new Error(`unexpected provider URL ${url}`);
    };
    await expect(fetchPublicProviderRelease({ timeoutMs: 25, fetchImpl })).rejects.toThrow(/deadline|timed out/u);
    expect(cancelled).toBe(true);
  });

  test("bounds a release request that never returns headers", async () => {
    let aborted = false;
    const fetchImpl: FetchFunction = async (_input, init) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        aborted = true;
        reject(new Error("mock fetch observed abort"));
      }, { once: true });
    });
    await expect(fetchPublicProviderRelease({ timeoutMs: 25, fetchImpl })).rejects.toThrow(/deadline/u);
    expect(aborted).toBe(true);
  });

  test("rejects an oversized release body before concatenating it", async () => {
    let registryIndex = 0;
    let cancelled = false;
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4 * 1024 * 1024 + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl: FetchFunction = async (input) => {
      const url = String(input);
      if (url.startsWith(`${PUBLIC_PROVIDER_REGISTRY_DOWNLOAD_BASE}/`)) {
        return new Response(JSON.stringify(publicProviderMetadata[registryIndex++]));
      }
      if (url === PUBLIC_PROVIDER_CHECKSUM_SOURCE) return new Response(oversized);
      throw new Error(`unexpected provider URL ${url}`);
    };
    await expect(fetchPublicProviderRelease({ timeoutMs: 500, fetchImpl })).rejects.toThrow(/bounded release asset size/u);
    expect(cancelled).toBe(true);
  });

  test("validates exact v1 discovery and the five resource identities", () => {
    const discovery = validateV1Discovery(
      {
        api_versions: ["forms.takoform.com/v1"],
        features: {
          service_forms: true,
          exact_form_ref: true,
          optimistic_concurrency: true,
          idempotent_lifecycle: true,
          operations: true,
          artifact_upload: true,
          support_profiles: true,
        },
        endpoints: { api: "https://host.example/apis/forms.takoform.com/v1" },
      },
      "https://host.example",
    );
    expect(discovery.apiRoot).toBe("https://host.example/apis/forms.takoform.com/v1");
    expect(() => validateV1Discovery({ api_versions: ["forms.takoform.com/v1beta1"], features: {}, endpoints: {} }, "https://host.example")).toThrow();
    const checked = assertExactIdentitySet(identities(), "space-a");
    expect(checked.worker_endpoint.url).toBe("https://takos-fetch-tracer.invalid/");
    expect(() => assertExactIdentitySet({ ...identities(), extra: identity("module_worker") }, "space-a")).toThrow();
    const endpoint = checked.worker_endpoint;
    expect(resourceURL(discovery.apiRoot, endpoint).searchParams.get("schemaDigest")).toBe(endpoint.form_schema_digest);
  });

  test("requires exact readback resources and exact absence envelopes", () => {
    const current = { ...identity("worker_endpoint"), revision: "2" };
    const wire = {
      apiVersion: current.form_api_version,
      kind: current.form_kind,
      form: { formRef: { apiVersion: current.form_api_version, kind: current.form_kind, definitionVersion: current.form_definition_version, schemaDigest: current.form_schema_digest } },
      metadata: { name: current.name, space: current.space, uid: current.uid, generation: current.generation, revision: "3" },
      spec: {},
      status: { observedGeneration: "1", conditions: [{ type: "Ready", status: "True", reason: "Available", lastTransitionTime: "2026-01-01T00:00:00Z" }], outputs: { hostname: current.hostname, url: current.url } },
    };
    const authoritative = assertReadbackResource(wire, current);
    expect(authoritative).toMatchObject({ ready: true, revision: "3", uid: current.uid });
    expect(() => assertReadbackResource({ ...wire, metadata: { ...wire.metadata, revision: "1" } }, current)).toThrow(/regressed/u);
    const absent = { error: { code: "resource_not_found", message: "gone", requestId: "request-1", retryable: false } };
    expect(() => assertExactAbsence(404, absent)).not.toThrow();
    expect(() => assertExactAbsence(404, { error: { ...absent.error, code: "permission_denied" } })).toThrow();
    expect(() => assertExactProbeBody({ buildIdentity: "wrong", configValue: "safe", nonce, projectUid }, "safe", nonce, projectUid)).toThrow();
    expect(() => assertExactProbeBody({ buildIdentity: "takos-fetch-tracer@public-registry-provider-4.0.0", configValue: "safe", nonce, projectUid, extra: true }, "safe", nonce, projectUid)).toThrow();
  });

  test("probes an assigned public Worker endpoint with the exact build contract", async () => {
    const endpoint = {
      ...identity("worker_endpoint"),
      hostname: "takos-fetch-tracer.example",
      url: "https://takos-fetch-tracer.example/",
    };
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const result = await probeRuntime({
      endpoint,
      workerPath: join(import.meta.dir, "../../deploy/opentofu/takoserver-fetch-tracer/worker.mjs"),
      configValue: "safe-config",
      nonce,
      projectUid,
      expectedEndpointOrigin: "https://takos-fetch-tracer.example/",
      targetHost: "https://host.example",
      timeoutMs: 100,
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        requests.push({
          url: url.toString(),
          authorization: new Headers(init?.headers).get("authorization"),
        });
        if (url.pathname === "/health") {
          return new Response(JSON.stringify({
            component: "takoserver-fetch-tracer",
            product: "takos",
            scope: "integration-only",
            status: "ok",
          }), { status: 200 });
        }
        if (url.pathname === "/.well-known/takos") {
          return new Response(JSON.stringify({
            artifact: "takoserver-fetch-tracer",
            capabilities: ["fetch"],
            fullRuntime: false,
            name: "Takos",
            product: "takos",
            runtime: "neutral-javascript-fetch",
            scope: "integration-only",
          }), { status: 200 });
        }
        return new Response(JSON.stringify({
          buildIdentity: "takos-fetch-tracer@public-registry-provider-4.0.0",
          configValue: "safe-config",
          nonce,
          projectUid,
        }), { status: 200 });
      },
    });
    expect(result).toEqual({
      mode: "assigned-endpoint",
      assignedUrl: "https://takos-fetch-tracer.example/",
      evidence: "host-runtime-readback",
      checks: [
        { name: "root-correlation", path: "/", status: 200, anonymous: true },
        { name: "health", path: "/health", status: 200, anonymous: true },
        { name: "takos-discovery", path: "/.well-known/takos", status: 200, anonymous: true },
      ],
    });
    expect(requests).toEqual([
      { url: "https://takos-fetch-tracer.example/", authorization: null },
      { url: "https://takos-fetch-tracer.example/health", authorization: null },
      { url: "https://takos-fetch-tracer.example/.well-known/takos", authorization: null },
    ]);
  });

  test("serves scoped Takos health and discovery anonymously without claiming the full runtime", async () => {
    const workerPath = join(
      import.meta.dir,
      "../../deploy/opentofu/takoserver-fetch-tracer/worker.mjs",
    );
    const workerModule = (await import(
      `${new URL(`file://${workerPath}`).href}?routes=${Date.now()}`
    )) as {
      default: {
        fetch(request: Request, env: Record<string, string>): Promise<Response>;
      };
    };
    const env = {
      TAKOS_FETCH_TRACER_CONFIG: "safe-config",
      TAKOS_FETCH_TRACER_NONCE: nonce,
      TAKOS_FETCH_TRACER_PROJECT_UID: projectUid,
    };

    const root = await workerModule.default.fetch(
      new Request("https://tracer.example/"),
      env,
    );
    expect(root.status).toBe(200);
    expect(await root.json()).toEqual({
      buildIdentity: "takos-fetch-tracer@public-registry-provider-4.0.0",
      configValue: "safe-config",
      nonce,
      projectUid,
    });

    const health = await workerModule.default.fetch(
      new Request("https://tracer.example/health"),
      env,
    );
    expect(health.status).toBe(200);
    expect(health.headers.get("www-authenticate")).toBeNull();
    expect(health.headers.get("set-cookie")).toBeNull();
    expect(await health.json()).toEqual({
      component: "takoserver-fetch-tracer",
      product: "takos",
      scope: "integration-only",
      status: "ok",
    });

    const discovery = await workerModule.default.fetch(
      new Request("https://tracer.example/.well-known/takos"),
      env,
    );
    expect(discovery.status).toBe(200);
    expect(discovery.headers.get("www-authenticate")).toBeNull();
    expect(discovery.headers.get("set-cookie")).toBeNull();
    expect(await discovery.json()).toEqual({
      artifact: "takoserver-fetch-tracer",
      capabilities: ["fetch"],
      fullRuntime: false,
      name: "Takos",
      product: "takos",
      runtime: "neutral-javascript-fetch",
      scope: "integration-only",
    });

    const missing = await workerModule.default.fetch(
      new Request("https://tracer.example/not-a-product-route"),
      env,
    );
    expect(missing.status).toBe(404);
  });

  test("checks all five static project addresses for exact absence", async () => {
    const requests: string[] = [];
    const projectName = "takos-fetch-tracer-aaaaaaaaaaaa";
    const revisions = createRevisionNameContext({
      projectName,
      configValue: "safe-config",
      nonce,
      projectUid,
      workerModuleSha256: "sha256:b5004673bb9ab47cc66d468963f80934e95226acad0bba11de618cc10ad23e9a",
      workerModuleSize: 654,
      bundleManifestDigest: "sha256:0cd32958ba84ab50dc92e794a18f73e4aeabb6dcbf821f81a48da9bd03a71fdb",
    });
    await assertAuthoritativeAbsence({
      apiRoot: "https://host.example/apis/forms.takoform.com/v1",
      addresses: knownResourceAddresses("space-a", projectName, revisions),
      token,
      timeoutMs: 100,
      fetchImpl: async (input) => {
        requests.push(String(input));
        return new Response(JSON.stringify({ error: { code: "resource_not_found", message: "gone", requestId: "request-1", retryable: false } }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      },
    });
    expect(requests).toHaveLength(5);
    expect(requests.every((request) => {
      const url = new URL(request);
      return [...url.searchParams.keys()].sort().join(",") ===
        "definitionVersion,schemaDigest,space" &&
        url.searchParams.get("definitionVersion") !== null &&
        url.searchParams.get("schemaDigest")?.startsWith("sha256:") === true;
    })).toBe(true);
    expect(requests.some((request) => request.includes(`ModuleWorker/${projectName}`))).toBe(true);
    expect(requests.some((request) => request.includes(`WorkerBundle/${revisions.bundleName}`))).toBe(true);
    expect(requests.some((request) => request.includes(`WorkerVersion/${revisions.workerVersionName}`))).toBe(true);
    expect(requests.some((request) => request.includes(`WorkerDeployment/${projectName}-deployment`))).toBe(true);
    expect(requests.some((request) => request.includes(`WorkerEndpoint/${projectName}-endpoint`))).toBe(true);
  });

  test("requires five authoritative Takoserver native-absence attestations and attempts every UID", async () => {
    expect(validateOrganizationId("org-integration-e2e")).toBe(
      "org-integration-e2e",
    );
    expect(() => validateOrganizationId("../operator")).toThrow(/organization/u);
    expect(
      buildNativeResidualURL({
        host: "https://host.example",
        organizationId: "org-integration-e2e",
        identity: identity("module_worker"),
      }).toString(),
    ).toBe(
      "https://host.example/v1/organizations/org-integration-e2e/resources/uid-module_worker/native-residual?space=space-a&name=takos-fetch-tracer",
    );

    const absent = {
      residual: {
        checkedAt: "2026-09-03T00:00:00.000Z",
        deploymentCount: 1,
        effectCount: 6,
        evidenceRef: `sha256:${"b".repeat(64)}`,
        source: "provider",
        status: "absent",
      },
    };
    const nativeNowMs = Date.parse("2026-09-03T00:00:01.000Z");
    expect(assertNativeResidualResponse(absent, nativeNowMs)).toMatchObject(absent.residual);
    expect(assertNativeResidualResponse(absent, nativeNowMs)).toMatchObject({
      status: "absent",
      deploymentCount: 1,
      effectCount: 6,
    });
    expect(() =>
      assertNativeResidualResponse({
        residual: { ...absent.residual, status: "indeterminate" },
      }),
    ).toThrow(/absent/u);
    expect(() =>
      assertNativeResidualResponse({
        residual: { ...absent.residual, evidenceRef: undefined },
      }),
    ).toThrow(/evidenceRef/u);
    expect(() =>
      assertNativeResidualResponse({
        residual: { ...absent.residual, reason: "deployment_active" },
      }),
    ).toThrow(/reason/u);
    expect(() => assertNativeResidualResponse({
      residual: {
        ...absent.residual,
        checkedAt: "2026-09-01T23:59:59.999Z",
      },
    }, nativeNowMs)).toThrow(/evidence window/u);
    expect(() => assertNativeResidualResponse({
      residual: {
        ...absent.residual,
        checkedAt: "2026-09-02T01:00:01.000Z",
      },
    }, nativeNowMs)).toThrow(/evidence window/u);
    expect(() => assertNativeResidualResponse({
      residual: {
        ...absent.residual,
        checkedAt: "2026-02-29T00:00:00.000Z",
      },
    }, nativeNowMs)).toThrow(/canonical/u);

    await expect(verifyNativeAbsence({
      host: "https://host.example",
      organizationId: "org-integration-e2e",
      identities: identities(),
      token: evidenceToken,
      timeoutMs: 100,
      nowMs: nativeNowMs,
      evidenceWindow: {
        destroyStartedAtMs: nativeNowMs - 60_000,
        destroyCompletedAtMs: nativeNowMs - 30_000,
        readbackStartedAtMs: nativeNowMs - 5_000,
      },
      fetchImpl: async () => new Response(JSON.stringify({
        residual: {
          ...absent.residual,
          checkedAt: "2026-09-02T01:00:01.000Z",
        },
      }), {
        status: 200,
        headers: { "cache-control": "no-store", "content-type": "application/json" },
      }),
    })).rejects.toThrow(/5 of 5/u);

    const requests: Array<{ url: string; authorization: string | null }> = [];
    const evidence = await verifyNativeAbsence({
      host: "https://host.example",
      organizationId: "org-integration-e2e",
      identities: identities(),
      token: evidenceToken,
      timeoutMs: 100,
      nowMs: nativeNowMs,
      fetchImpl: async (input, init) => {
        requests.push({
          url: String(input),
          authorization: new Headers(init?.headers).get("authorization"),
        });
        return new Response(JSON.stringify(absent), {
          status: 200,
          headers: { "cache-control": "no-store", "content-type": "application/json" },
        });
      },
    });
    expect(evidence).toMatchObject({
      kind: "takos.takoserver-native-absence@v1",
      status: "passed",
      organizationId: "org-integration-e2e",
      space: "space-a",
      resourceCount: 5,
      checkedCount: 5,
    });
    expect(Object.keys(evidence.resources)).toEqual([...RESOURCE_KEYS]);
    expect(requests).toHaveLength(5);
    expect(
      requests.every(({ authorization }) => authorization === `Bearer ${evidenceToken}`),
    ).toBe(true);

    await expect(
      verifyNativeAbsence({
        host: "https://host.example",
        organizationId: "org-integration-e2e",
        identities: identities(),
        token: evidenceToken,
        timeoutMs: 100,
        nowMs: nativeNowMs,
        fetchImpl: async () => new Response(JSON.stringify(absent), {
          status: 200,
          headers: {
            "cache-control": "no-store",
            "content-type": "application/jsonp",
          },
        }),
      }),
    ).rejects.toThrow(/5 of 5/u);

    let malformedCalls = 0;
    await expect(
      verifyNativeAbsence({
        host: "https://host.example",
        organizationId: "org-integration-e2e",
        identities: identities(),
        token: evidenceToken,
        timeoutMs: 100,
        nowMs: nativeNowMs,
        fetchImpl: async () => {
          malformedCalls += 1;
          return new Response(JSON.stringify(absent), {
            status: 200,
            headers: { "cache-control": "no-store" },
          });
        },
      }),
    ).rejects.toThrow(/5 of 5/u);
    expect(malformedCalls).toBe(5);

    let failedCalls = 0;
    await expect(
      verifyNativeAbsence({
        host: "https://host.example",
        organizationId: "org-integration-e2e",
        identities: identities(),
        token: evidenceToken,
        timeoutMs: 100,
        nowMs: nativeNowMs,
        fetchImpl: async () => {
          failedCalls += 1;
          return new Response("operator-private diagnostic", { status: 503 });
        },
      }),
    ).rejects.toThrow(/5 of 5/u);
    expect(failedCalls).toBe(5);
  });

  test("proves the authenticated Resource execution-evidence route before mutation", async () => {
    const requests: Array<{ readonly url: string; readonly authorization: string | null }> = [];
    await assertResourceExecutionEvidenceCapability({
      host: "https://host.example",
      organizationId: "org-integration-e2e",
      nonce,
      token: evidenceToken,
      timeoutMs: 100,
      fetchImpl: async (input, init) => {
        requests.push({
          url: String(input),
          authorization: new Headers(init?.headers).get("authorization"),
        });
        return new Response(JSON.stringify({
          error: {
            code: "not_found",
            message: "Resource execution evidence was not found",
            requestId: "request-capability-1",
            retryable: false,
          },
        }), {
          status: 404,
          headers: {
            "cache-control": "private, no-store",
            "content-type": "application/json",
            "x-content-type-options": "nosniff",
          },
        });
      },
    });
    expect(requests).toEqual([{
      url:
        `https://host.example/v1/organizations/org-integration-e2e/resources/capability-${nonce}/execution-evidence`,
      authorization: `Bearer ${evidenceToken}`,
    }]);

    await expect(assertResourceExecutionEvidenceCapability({
      host: "https://host.example",
      organizationId: "org-integration-e2e",
      nonce,
      token: evidenceToken,
      timeoutMs: 100,
      fetchImpl: async () => new Response(JSON.stringify({
        error: {
          code: "not_found",
          message: "missing",
          requestId: "request-capability-jsonp",
          retryable: false,
        },
      }), {
        status: 404,
        headers: {
          "cache-control": "private, no-store",
          "content-type": "application/jsonp",
          "x-content-type-options": "nosniff",
        },
      }),
    })).rejects.toThrow(/not available/u);

    await expect(assertResourceExecutionEvidenceCapability({
      host: "https://host.example",
      organizationId: "org-integration-e2e",
      nonce,
      token: evidenceToken,
      timeoutMs: 100,
      fetchImpl: async () => new Response(JSON.stringify({
        error: {
          code: "not_found",
          message: "missing",
          requestId: "request-capability-2",
          retryable: false,
        },
      }), { status: 404, headers: { "cache-control": "private, no-store" } }),
    })).rejects.toThrow(/not available/u);
  });

  test("proves the authenticated native-residual backend before mutation", async () => {
    const requests: Array<{ readonly url: string; readonly authorization: string | null }> = [];
    await assertNativeResidualCapability({
      host: "https://host.example",
      organizationId: "org-integration-e2e",
      space: "space-a",
      nonce,
      token: evidenceToken,
      timeoutMs: 100,
      fetchImpl: async (input, init) => {
        requests.push({
          url: String(input),
          authorization: new Headers(init?.headers).get("authorization"),
        });
        return new Response(JSON.stringify({
          error: {
            code: "resource_not_found",
            message: "Resource was not found",
            requestId: "request-native-capability-1",
            retryable: false,
          },
        }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      },
    });
    expect(requests).toEqual([{
      url:
        `https://host.example/v1/organizations/org-integration-e2e/resources/capability-${nonce}/native-residual?space=space-a&name=capability-${nonce.slice(0, 32)}`,
      authorization: `Bearer ${evidenceToken}`,
    }]);

    await expect(assertNativeResidualCapability({
      host: "https://host.example",
      organizationId: "org-integration-e2e",
      space: "space-a",
      nonce,
      token: evidenceToken,
      timeoutMs: 100,
      fetchImpl: async () => new Response(JSON.stringify({
        error: {
          code: "resource_not_found",
          message: "missing",
          requestId: "request-native-capability-jsonp",
          retryable: false,
        },
      }), { status: 404, headers: { "content-type": "application/jsonp" } }),
    })).rejects.toThrow(/not available/u);

    await expect(assertNativeResidualCapability({
      host: "https://host.example",
      organizationId: "org-integration-e2e",
      space: "space-a",
      nonce,
      token: evidenceToken,
      timeoutMs: 100,
      fetchImpl: async () => new Response(JSON.stringify({
        error: {
          code: "backend_unavailable",
          message: "backend unavailable",
          requestId: "request-native-capability-2",
          retryable: true,
        },
      }), { status: 503, headers: { "content-type": "application/json" } }),
    })).rejects.toThrow(/Host backend is unavailable/u);
  });

  test("reads one complete immutable Resource execution lifecycle across every page", async () => {
    const resource = identity("module_worker");
    const evidence = (commits: readonly Record<string, unknown>[], snapshotFence: number) => ({
      format: "takoserver.resource-execution-evidence/v1",
      organizationId: "org-integration-e2e",
      resource: {
        uid: resource.uid,
        address: {
          space: resource.space,
          apiVersion: resource.form_api_version,
          kind: resource.form_kind,
          name: resource.name,
        },
        formRef: {
          apiVersion: resource.form_api_version,
          kind: resource.form_kind,
          definitionVersion: resource.form_definition_version,
          schemaDigest: resource.form_schema_digest,
        },
      },
      coverage: "complete",
      snapshotFence,
      commits,
    });
    const commit = (sequence: number, action: "create" | "update") => ({
      sequence,
      operationId: `operation-${sequence}`,
      action,
      outcome: "committed",
      resourceVersion: { generation: "1", revision: String(sequence) },
      committedAt: `2026-09-04T00:00:0${sequence}.000Z`,
    });
    const pages = [
      { executionEvidence: evidence([commit(2, "update")], 2), cursor: "next-page" },
      { executionEvidence: evidence([commit(1, "create")], 2) },
    ];
    const requests: string[] = [];
    const snapshot = await readResourceExecutionEvidence({
      host: "https://host.example",
      organizationId: "org-integration-e2e",
      identity: resource,
      phase: "apply",
      token: evidenceToken,
      timeoutMs: 100,
      fetchImpl: async (input) => {
        requests.push(String(input));
        const page = pages.shift();
        if (!page) throw new Error("unexpected execution evidence page");
        return new Response(JSON.stringify(page), {
          status: 200,
          headers: {
            "cache-control": "private, no-store",
            "content-type": "application/json",
            "x-content-type-options": "nosniff",
          },
        });
      },
    });
    expect(snapshot).toMatchObject({
      uid: resource.uid,
      snapshotFence: 2,
      latestAction: "update",
      commitCount: 2,
    });
    expect(requests).toHaveLength(2);
    expect(new URL(requests[1]!).searchParams.get("cursor")).toBe("next-page");

    await expect(readResourceExecutionEvidence({
      host: "https://host.example",
      organizationId: "org-integration-e2e",
      identity: resource,
      phase: "apply",
      token: evidenceToken,
      timeoutMs: 100,
      fetchImpl: async () => new Response(JSON.stringify({
        executionEvidence: evidence([commit(1, "create")], 1),
      }), {
        status: 200,
        headers: {
          "cache-control": "private, no-store",
          "content-type": "application/jsonp",
          "x-content-type-options": "nosniff",
        },
      }),
    })).rejects.toThrow(/unavailable/u);

    await expect(readResourceExecutionEvidence({
      host: "https://host.example",
      organizationId: "org-integration-e2e",
      identity: resource,
      phase: "apply",
      token: evidenceToken,
      timeoutMs: 100,
      fetchImpl: async () => new Response(JSON.stringify({
        executionEvidence: evidence([commit(3, "update"), commit(1, "create")], 3),
      }), {
        status: 200,
        headers: {
          "cache-control": "private, no-store",
          "content-type": "application/json",
          "x-content-type-options": "nosniff",
        },
      }),
    })).rejects.toThrow(/contiguous/u);
  });

  test("requires destroy evidence to advance and retain the exact apply history", () => {
    const create = {
      sequence: 1,
      operationId: "operation-create",
      action: "create" as const,
      outcome: "committed" as const,
      resourceVersion: { generation: "1", revision: "1" },
      committedAt: "2026-09-04T00:00:01.000Z",
    };
    const apply = {
      uid: "uid-module_worker",
      snapshotFence: 1,
      latestAction: "create" as const,
      commitCount: 1,
      commits: [create],
    };
    const destroy = {
      uid: "uid-module_worker",
      snapshotFence: 2,
      latestAction: "delete" as const,
      commitCount: 2,
      commits: [{
        sequence: 2,
        operationId: "operation-delete",
        action: "delete" as const,
        outcome: "committed" as const,
        resourceVersion: { generation: "1", revision: "2" },
        committedAt: "2026-09-04T00:00:02.000Z",
      }, create],
    };
    expect(() => assertDestroyExecutionEvidenceSuccessor(apply, destroy)).not.toThrow();
    expect(() => assertDestroyExecutionEvidenceSuccessor(apply, {
      ...destroy,
      snapshotFence: 1,
    })).toThrow(/advance/u);
    expect(() => assertDestroyExecutionEvidenceSuccessor(apply, {
      ...destroy,
      commits: [destroy.commits[0]!, { ...create, operationId: "different-create" }],
    })).toThrow(/retain/u);
  });

  test("unwraps realistic OpenTofu output wrappers before checking exact values", () => {
    const wrapped = {
      sensitive: false,
      type: ["object", { worker_endpoint: ["object", "..."], module_worker: "object" }],
      value: { module_worker: identity("module_worker") },
    };
    expect(unwrapTofuOutput(wrapped, "resource_identities")).toEqual(wrapped.value);
    expect(unwrapTofuOutput({ sensitive: false, type: "string", value: "safe-config" }, "config_value")).toBe("safe-config");
    expect(() => unwrapTofuOutput({ sensitive: true, type: "string", value: token }, "secret")).toThrow(/sensitive/u);
    expect(() => unwrapTofuOutput({ sensitive: false, type: "string", value: "safe", extra: true }, "config_value")).toThrow(/unexpected/u);

    const checked = parseTofuOutputs({
      resource_identities: { sensitive: false, type: ["map", "object"], value: identities() },
      config_value: { sensitive: false, type: "string", value: "safe-config" },
      endpoint_url: { sensitive: false, type: "string", value: "https://takos-fetch-tracer.invalid/" },
      endpoint_hostname: { sensitive: false, type: "string", value: "takos-fetch-tracer.invalid" },
      project_nonce: { sensitive: false, type: "string", value: nonce },
      project_uid: { sensitive: false, type: "string", value: projectUid },
    }, "space-a");
    expect(checked.identities.worker_endpoint.name).toBe("takos-fetch-tracer-endpoint");
    expect(checked.configValue).toBe("safe-config");
  });

  test("allows initial not-ready identities but requires Ready on Host readback", () => {
    const initialIdentities = Object.fromEntries(
      Object.entries(identities()).map(([key, value]) => [key, { ...value, ready: false }]),
    );
    const parsed = parseTofuOutputs({
      resource_identities: { sensitive: false, type: ["map", "object"], value: initialIdentities },
      config_value: { sensitive: false, type: "string", value: "safe-config" },
      endpoint_url: { sensitive: false, type: "string", value: initialIdentities.worker_endpoint.url },
      endpoint_hostname: { sensitive: false, type: "string", value: initialIdentities.worker_endpoint.hostname },
      project_nonce: { sensitive: false, type: "string", value: nonce },
      project_uid: { sensitive: false, type: "string", value: projectUid },
    }, "space-a");
    expect(Object.values(parsed.identities).every((resource) => resource.ready === false)).toBe(true);

    const current = parsed.identities.module_worker;
    const readback = {
      apiVersion: current.form_api_version,
      kind: current.form_kind,
      form: { formRef: { apiVersion: current.form_api_version, kind: current.form_kind, definitionVersion: current.form_definition_version, schemaDigest: current.form_schema_digest } },
      metadata: { name: current.name, space: current.space, uid: current.uid, generation: current.generation, revision: current.revision },
      spec: {},
      status: { observedGeneration: current.generation, conditions: [{ type: "Ready", status: "False", reason: "Reconciling", lastTransitionTime: "2026-01-01T00:00:00Z" }] },
    };
    expect(() => assertReadbackResource(readback, current)).toThrow(/Ready=True/u);
  });

  test("cleans temporary state and exposes a recovery path on cleanup failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "fetch-tracer-test-"));
    const cleaned = await cleanupRunRoot(root);
    expect(cleaned.removed).toBe(true);
    const failure = await cleanupRunRoot("/tmp/recovery-preserved", { remove: async () => { throw new Error("busy"); } });
    expect(failure.removed).toBe(false);
    if (!failure.removed) expect(failure.recoveryPath).toBe("/tmp/recovery-preserved");
  });

  test("keeps recovery state when destroy succeeds but one exact absence check fails", async () => {
    let destroyCalls = 0;
    let absenceCalls = 0;
    let removeCalls = 0;
    await expect(cleanupAfterApply({
      recoveryPath: "/tmp/destroy-zero-absence-fail",
      destroy: async () => { destroyCalls += 1; },
      absence: async () => { absenceCalls += 1; throw new Error("worker_endpoint still exists"); },
      remove: async () => { removeCalls += 1; },
    })).rejects.toMatchObject({ recoveryPath: "/tmp/destroy-zero-absence-fail" });
    expect(destroyCalls).toBe(1);
    expect(absenceCalls).toBe(1);
    expect(removeCalls).toBe(0);
  });

  test("attempts absence after an indeterminate partial apply and preserves recovery", async () => {
    let absenceCalls = 0;
    let removeCalls = 0;
    await expect(cleanupAfterApply({
      recoveryPath: "/tmp/partial-apply",
      destroy: async () => { throw new Error("destroy timeout"); },
      absence: async () => { absenceCalls += 1; throw new Error("one resource is still present"); },
      remove: async () => { removeCalls += 1; },
    })).rejects.toMatchObject({ recoveryPath: "/tmp/partial-apply" });
    expect(absenceCalls).toBe(1);
    expect(removeCalls).toBe(0);
  });

  test("preserves Apply401 while separately reporting a cleanup401", () => {
    const applyFailure = new Error("tofu apply exited with status 401");
    const cleanupFailure = new Error("post-destroy absence returned HTTP 401");
    const combined = combineTracerFailures({
      primary: applyFailure,
      cleanup: cleanupFailure,
      recoveryPath: "/tmp/apply-401",
      completedMilestones: ["provider_verified", "workspace_prepared", "discovery_completed", "validate_completed", "apply_attempted"],
      secrets: [token, evidenceToken],
    });
    expect(combined).toBe(applyFailure);
    expect(combined.message).toContain("tofu apply exited with status 401");
    expect(combined.message).toContain("cleanup also failed");
    expect(combined.message).toContain("post-destroy absence returned HTTP 401");
    expect(combined).toMatchObject({ recoveryPath: "/tmp/apply-401" });
    expect((combined as Error & { cleanupError?: unknown }).cleanupError).toBe(cleanupFailure);
    expect((combined as Error & { completedMilestones?: readonly string[] }).completedMilestones).toEqual([
      "provider_verified",
      "workspace_prepared",
      "discovery_completed",
      "validate_completed",
      "apply_attempted",
    ]);
  });

  test("does not expose either credential when combining phase and cleanup errors", () => {
    const combined = combineTracerFailures({
      primary: new Error(`apply failed with ${token}`),
      cleanup: new Error(`cleanup failed with ${evidenceToken}`),
      secrets: [token, evidenceToken],
    });
    expect(combined.message).not.toContain(token);
    expect(combined.message).not.toContain(evidenceToken);
    expect((combined as Error & { cleanupError?: Error }).cleanupError?.message).not.toContain(evidenceToken);
  });

  test("keeps Apply401 primary when destroy and absence cleanup also return 401", async () => {
    const config = parseArgs([
      "--run",
      "--host", "https://host.example",
      "--space", "space-a",
      "--organization-id", "org-integration-e2e",
      "--timeout-ms", "100",
      "--kill-grace-ms", "100",
      "--endpoint-origin-template", "https://{project}.example/",
    ], { [MUTATION_TOKEN_ENV]: token, [EVIDENCE_TOKEN_ENV]: evidenceToken });
    const spawnCalls: Array<{ argv: readonly string[]; env: Record<string, unknown> }> = [];
    const spawn: SpawnFunction = (argv, options) => {
      spawnCalls.push({ argv, env: options.env as Record<string, unknown> });
      const subcommand = argv[1] ?? "";
      if (subcommand === "version") {
        return { exited: Promise.resolve(0), stdout: new Response("OpenTofu v1.12.3\n").body, stderr: new Response("").body };
      }
      if (subcommand === "init") {
        const workDir = options.cwd as string;
        const providerPath = join(workDir, ".terraform/providers/registry.terraform.io/tako0614/takoform/4.0.0/linux_amd64/terraform-provider-takoform_v4.0.0");
        const setup = mkdir(join(providerPath, ".."), { recursive: true })
          .then(() => writeFile(providerPath, "synthetic-provider-4.0.0"))
          .then(() => chmod(providerPath, 0o755));
        return { exited: setup.then(() => 0), stdout: new Response("").body, stderr: new Response("").body };
      }
      if (subcommand === "validate") {
        return { exited: Promise.resolve(0), stdout: new Response("").body, stderr: new Response("").body };
      }
      if (subcommand === "plan") {
        const setup = writeFile(argv.at(-1) as string, "synthetic-saved-plan");
        return { exited: setup.then(() => 0), stdout: new Response("").body, stderr: new Response("").body };
      }
      if (subcommand === "show") {
        const environment = options.env as Record<string, string | undefined>;
        return { exited: Promise.resolve(0), stdout: new Response(JSON.stringify(strictPlanFixture(environment))).body, stderr: new Response("").body };
      }
      if (subcommand === "apply") {
        return { exited: Promise.resolve(1), stdout: new Response("").body, stderr: new Response("apply " + token).body };
      }
      if (subcommand === "destroy") {
        return { exited: Promise.resolve(1), stdout: new Response("").body, stderr: new Response("destroy " + token).body };
      }
      throw new Error("unexpected child command " + subcommand);
    };
    const discoveryDocument = {
      api_versions: ["forms.takoform.com/v1"],
      features: {
        service_forms: true,
        exact_form_ref: true,
        optimistic_concurrency: true,
        idempotent_lifecycle: true,
        operations: true,
        artifact_upload: true,
        support_profiles: true,
      },
      endpoints: { api: "https://host.example/apis/forms.takoform.com/v1" },
    };
    const authorizationHeaders: string[] = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      authorizationHeaders.push(String(new Headers(init?.headers).get("authorization")));
      const url = new URL(String(input));
      if (url.pathname === "/.well-known/takoform/v1") {
        return new Response(JSON.stringify(discoveryDocument), { status: 200 });
      }
      if (url.pathname.endsWith("/execution-evidence")) {
        return new Response(JSON.stringify({
          error: {
            code: "not_found",
            message: "Resource execution evidence was not found",
            requestId: "request-execution-capability-apply-failure",
            retryable: false,
          },
        }), {
          status: 404,
          headers: {
            "cache-control": "private, no-store",
            "content-type": "application/json",
            "x-content-type-options": "nosniff",
          },
        });
      }
      if (url.pathname.endsWith("/native-residual")) {
        return new Response(JSON.stringify({
          error: {
            code: "resource_not_found",
            message: "Resource was not found",
            requestId: "request-native-capability-apply-failure",
            retryable: false,
          },
        }), { status: 404, headers: { "content-type": "application/json" } });
      }
      return new Response("", { status: 401 });
    };
    let caught: unknown;
    try {
      await runTracer(config, { fetchImpl, providerFetchImpl: publicProviderFetch, spawn });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    const error = caught as Error & { cleanupError?: Error; recoveryPath?: string; completedMilestones?: readonly string[] };
    expect(error.message).toContain("tofu exited with status 1");
    expect(error.message).toContain("cleanup also failed");
    expect(error.message).toContain("post-destroy cleanup proof failed");
    expect(error.message).not.toContain(token);
    expect(error.message).not.toContain(evidenceToken);
    expect(error.cleanupError).toBeInstanceOf(Error);
    expect(error.recoveryPath).toBeTruthy();
    expect(error.completedMilestones).toEqual([
      "workspace_prepared",
      "provider_release_verified",
      "toolchain_verified",
      "init_completed",
      "provider_verified",
      "discovery_completed",
      "execution_evidence_capability_proven",
      "native_residual_capability_proven",
      "validate_completed",
      "plan_completed",
      "plan_verified",
      "apply_attempted",
    ]);
    expect(spawnCalls.map(({ argv }) => argv[1])).toEqual(["version", "init", "validate", "plan", "show", "apply", "destroy"]);
    expect(spawnCalls.filter(({ argv }) => ["version", "init", "validate", "show"].includes(argv[1] ?? "")).every(({ env }) => env.TAKOFORM_TOKEN === undefined)).toBe(true);
    expect(spawnCalls.filter(({ argv }) => ["plan", "apply", "destroy"].includes(argv[1] ?? "")).every(({ env }) => env.TAKOFORM_TOKEN === token)).toBe(true);
    expect(authorizationHeaders).toHaveLength(8);
    expect(authorizationHeaders.every((value) => value === "Bearer " + evidenceToken)).toBe(true);
    if (error.recoveryPath) await rm(error.recoveryPath, { recursive: true, force: true });
  });

  test("runs the public Provider lifecycle through readback, public Worker probe, and absence", async () => {
    const config = parseArgs([
      "--run",
      "--host", "https://host.example",
      "--space", "space-a",
      "--organization-id", "org-integration-e2e",
      "--timeout-ms", "1000",
      "--kill-grace-ms", "100",
      "--config-value", "safe-config",
      "--endpoint-origin-template", "https://{project}.example/",
    ], { [MUTATION_TOKEN_ENV]: token, [EVIDENCE_TOKEN_ENV]: evidenceToken });
    const spawnCommands: string[] = [];
    let outputIdentities: Record<string, ResourceIdentity> | undefined;
    let runtimeNonce: string | undefined;
    let runtimeUid: string | undefined;
    let destroyed = false;
    let executionEvidenceCapabilityProven = false;
    let nativeResidualCapabilityProven = false;
    const spawn: SpawnFunction = (argv, options) => {
      const subcommand = argv[1] ?? "";
      spawnCommands.push(subcommand);
      if (subcommand === "version") {
        return { exited: Promise.resolve(0), stdout: new Response("OpenTofu v1.12.3\non linux_amd64\n").body, stderr: new Response("").body };
      }
      if (subcommand === "init") {
        const workDir = options.cwd as string;
        const providerPath = join(workDir, ".terraform/providers/registry.terraform.io/tako0614/takoform/4.0.0/linux_amd64/terraform-provider-takoform_v4.0.0");
        const setup = mkdir(join(providerPath, ".."), { recursive: true })
          .then(() => writeFile(providerPath, "synthetic-provider-4.0.0"))
          .then(() => chmod(providerPath, 0o755));
        return { exited: setup.then(() => 0), stdout: new Response("").body, stderr: new Response("").body };
      }
      if (subcommand === "validate" || subcommand === "destroy" || subcommand === "state") {
        if (subcommand === "destroy") destroyed = true;
        return { exited: Promise.resolve(0), stdout: new Response("").body, stderr: new Response("").body };
      }
      if (subcommand === "plan") {
        const planPath = argv.at(-1) as string;
        const setup = writeFile(planPath, "synthetic-saved-plan");
        return { exited: setup.then(() => 0), stdout: new Response("").body, stderr: new Response("").body };
      }
      if (subcommand === "show") {
        const environment = options.env as Record<string, string | undefined>;
        return { exited: Promise.resolve(0), stdout: new Response(JSON.stringify(strictPlanFixture(environment))).body, stderr: new Response("").body };
      }
      if (subcommand === "apply") {
        expect(executionEvidenceCapabilityProven).toBe(true);
        expect(nativeResidualCapabilityProven).toBe(true);
        return { exited: Promise.resolve(0), stdout: new Response("").body, stderr: new Response("").body };
      }
      if (subcommand === "output") {
        const environment = options.env as Record<string, string | undefined>;
        const projectName = environment.TF_VAR_project_name as string;
        const runNonce = environment.TF_VAR_project_nonce as string;
        const runUid = environment.TF_VAR_project_uid as string;
        const revisions = createRevisionNameContext({
          projectName,
          configValue: environment.TF_VAR_config_value as string,
          nonce: runNonce,
          projectUid: runUid,
          workerModuleSha256: "sha256:0a0076dcbdef296ac1f61d506f1ef25e75531001beb116e84041a8c186c68765",
          workerModuleSize: 1871,
          bundleManifestDigest: "sha256:9053305f3308c67b2a25758422bf72b83980974c3f0f4c16c4866b0e578302b9",
        });
        runtimeNonce = runNonce;
        runtimeUid = runUid;
        const endpointOrigin = `https://${projectName}.example/`;
        outputIdentities = Object.fromEntries(RESOURCE_KEYS.map((key) => [
          key,
          {
          ...identity(key, projectName, revisions),
            name: projectResourceName(key, projectName, revisions),
            space: environment.TF_VAR_space,
            hostname: key === "worker_endpoint" ? `${projectName}.example` : null,
            url: key === "worker_endpoint" ? endpointOrigin : null,
          },
        ])) as Record<string, ResourceIdentity>;
        return {
          exited: Promise.resolve(0),
          stdout: new Response(JSON.stringify({
            resource_identities: { sensitive: false, type: ["map", "object"], value: outputIdentities },
            config_value: { sensitive: false, type: "string", value: "safe-config" },
            endpoint_url: { sensitive: false, type: "string", value: endpointOrigin },
            endpoint_hostname: { sensitive: false, type: "string", value: `${projectName}.example` },
            project_nonce: { sensitive: false, type: "string", value: runNonce },
            project_uid: { sensitive: false, type: "string", value: runUid },
          })).body,
          stderr: new Response("").body,
        };
      }
      throw new Error("unexpected child command " + subcommand);
    };
    const discoveryDocument = {
      api_versions: ["forms.takoform.com/v1"],
      features: {
        service_forms: true,
        exact_form_ref: true,
        optimistic_concurrency: true,
        idempotent_lifecycle: true,
        operations: true,
        artifact_upload: true,
        support_profiles: true,
      },
      endpoints: { api: "https://host.example/apis/forms.takoform.com/v1" },
    };
    let resourceReads = 0;
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input));
      const authorization = new Headers(init?.headers).get("authorization");
      requests.push({ url: url.toString(), authorization });
      if (url.pathname === "/.well-known/takoform/v1") {
        return new Response(JSON.stringify(discoveryDocument), { status: 200 });
      }
      if (
        /^\/v1\/organizations\/org-integration-e2e\/resources\/capability-[0-9a-f]{64}\/execution-evidence$/u
          .test(url.pathname)
      ) {
        executionEvidenceCapabilityProven = true;
        return new Response(JSON.stringify({
          error: {
            code: "not_found",
            message: "Resource execution evidence was not found",
            requestId: "request-capability-1",
            retryable: false,
          },
        }), {
          status: 404,
          headers: {
            "cache-control": "private, no-store",
            "content-type": "application/json",
            "x-content-type-options": "nosniff",
          },
        });
      }
      if (url.pathname.endsWith("/execution-evidence")) {
        if (!outputIdentities) throw new Error("execution evidence read happened before output");
        const uid = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
        const current = Object.values(outputIdentities).find((resource) => resource.uid === uid);
        if (!current) return new Response("", { status: 404 });
        const createCommit = {
          sequence: 1,
          operationId: `create-${uid}`,
          action: "create",
          outcome: "committed",
          resourceVersion: { generation: "1", revision: "1" },
          committedAt: "2026-09-04T00:00:01.000Z",
        };
        const commits = destroyed
          ? [{
              sequence: 2,
              operationId: `delete-${uid}`,
              action: "delete",
              outcome: "committed",
              resourceVersion: { generation: "1", revision: "2" },
              committedAt: "2026-09-04T00:00:02.000Z",
            }, createCommit]
          : [createCommit];
        return new Response(JSON.stringify({
          executionEvidence: {
            format: "takoserver.resource-execution-evidence/v1",
            organizationId: "org-integration-e2e",
            resource: {
              uid: current.uid,
              address: {
                space: current.space,
                apiVersion: current.form_api_version,
                kind: current.form_kind,
                name: current.name,
              },
              formRef: {
                apiVersion: current.form_api_version,
                kind: current.form_kind,
                definitionVersion: current.form_definition_version,
                schemaDigest: current.form_schema_digest,
              },
            },
            coverage: "complete",
            snapshotFence: commits.length,
            commits,
          },
        }), {
          status: 200,
          headers: {
            "cache-control": "private, no-store",
            "content-type": "application/json",
            "x-content-type-options": "nosniff",
          },
        });
      }
      if (
        /^\/v1\/organizations\/org-integration-e2e\/resources\/capability-[0-9a-f]{64}\/native-residual$/u
          .test(url.pathname)
      ) {
        nativeResidualCapabilityProven = true;
        return new Response(JSON.stringify({
          error: {
            code: "resource_not_found",
            message: "Resource was not found",
            requestId: "request-native-capability-1",
            retryable: false,
          },
        }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.pathname.endsWith("/native-residual")) {
        return new Response(JSON.stringify({
          residual: {
            checkedAt: new Date().toISOString(),
            deploymentCount: 0,
            effectCount: 0,
            evidenceRef: `sha256:${"c".repeat(64)}`,
            source: "provider",
            status: "absent",
          },
        }), {
          status: 200,
          headers: { "cache-control": "no-store", "content-type": "application/json" },
        });
      }
      const endpointOrigin = outputIdentities?.worker_endpoint.url ? new URL(String(outputIdentities.worker_endpoint.url)).origin : undefined;
      if (endpointOrigin && url.origin === endpointOrigin) {
        if (destroyed) return new Response("", { status: 404 });
        if (url.pathname === "/health") {
          return new Response(JSON.stringify({
            component: "takoserver-fetch-tracer",
            product: "takos",
            scope: "integration-only",
            status: "ok",
          }), { status: 200 });
        }
        if (url.pathname === "/.well-known/takos") {
          return new Response(JSON.stringify({
            artifact: "takoserver-fetch-tracer",
            capabilities: ["fetch"],
            fullRuntime: false,
            name: "Takos",
            product: "takos",
            runtime: "neutral-javascript-fetch",
            scope: "integration-only",
          }), { status: 200 });
        }
        return new Response(JSON.stringify({
          buildIdentity: "takos-fetch-tracer@public-registry-provider-4.0.0",
          configValue: "safe-config",
          nonce: runtimeNonce,
          projectUid: runtimeUid,
        }), { status: 200 });
      }
      if (!outputIdentities) throw new Error("resource read happened before output");
      const name = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
      const current = Object.values(outputIdentities).find((resource) => resource.name === name);
      if (!current) return new Response("", { status: 404 });
      resourceReads += 1;
      if (resourceReads > RESOURCE_KEYS.length) {
        return new Response(JSON.stringify({ error: { code: "resource_not_found", message: "gone", requestId: "request-1", retryable: false } }), { status: 404 });
      }
      return new Response(JSON.stringify({
        apiVersion: current.form_api_version,
        kind: current.form_kind,
        form: { formRef: { apiVersion: current.form_api_version, kind: current.form_kind, definitionVersion: current.form_definition_version, schemaDigest: current.form_schema_digest } },
        metadata: { name: current.name, space: current.space, uid: current.uid, generation: current.generation, revision: current.revision },
        spec: {},
        status: {
          observedGeneration: current.generation,
          conditions: [{ type: "Ready", status: "True", reason: "Available", lastTransitionTime: "2026-01-01T00:00:00Z" }],
          ...(current.form_kind === "WorkerEndpoint" ? { outputs: { hostname: current.hostname, url: current.url } } : {}),
        },
      }), { status: 200 });
    };
    const report = await runTracer(config, { fetchImpl, providerFetchImpl: publicProviderFetch, spawn });
    expect(report.kind).toBe("takos.takoserver-fetch-tracer@v2");
    expect(() => assertNoKnownSecrets(report, [token, evidenceToken])).not.toThrow();
    expect(report.provider).toMatchObject({
      source: PROVIDER_SOURCE,
      version: PROVIDER_VERSION,
      constraint: PROVIDER_CONSTRAINT,
      lockfileSha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      checksumSource: PUBLIC_PROVIDER_CHECKSUM_SOURCE,
      signatureSource: PUBLIC_PROVIDER_SIGNATURE_SOURCE,
      signingKeyId: PUBLIC_PROVIDER_SIGNING_KEY_ID,
      signingKeyFingerprint: PUBLIC_PROVIDER_SIGNING_KEY_FINGERPRINT,
    });
    expect(report.runtimeProbe).toEqual({
      mode: "assigned-endpoint",
      assignedUrl: expect.stringMatching(/^https:\/\/takos-fetch-tracer-[0-9a-f]{12}\.example\/$/u),
      exact: true,
      evidence: "host-runtime-readback",
      checks: [
        { name: "root-correlation", path: "/", status: 200, anonymous: true },
        { name: "health", path: "/health", status: 200, anonymous: true },
        { name: "takos-discovery", path: "/.well-known/takos", status: 200, anonymous: true },
      ],
    });
    expect(report.run.nonce).toMatch(/^[0-9a-f]{64}$/u);
    expect(report.run.projectUid).toBe(`puid-${report.run.nonce}`);
    expect(report.runtime.nonce).toBe(report.run.nonce);
    expect(report.ledger.plan.creates).toHaveLength(5);
    expect(report.ledger.plan.planSha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(report.ledger.endpoint).toMatchObject({ status: 404, nonce: report.run.nonce });
    expect(report.native).toMatchObject({
      kind: "takos.takoserver-native-absence@v1",
      status: "passed",
      zeroResidual: true,
      gaEligible: false,
      organizationId: "org-integration-e2e",
      resourceCount: 5,
      checkedCount: 5,
    });
    expect(report.resourceExecution).toMatchObject({
      format: "takoserver.resource-execution-evidence/v1",
      status: "passed",
      organizationId: "org-integration-e2e",
      space: "space-a",
      resourceCount: 5,
      resources: {
        module_worker: {
          uid: expect.stringMatching(/^uid-module_worker$/u),
          apply: { snapshotFence: 1, latestAction: "create", commitCount: 1 },
          destroy: { snapshotFence: 2, latestAction: "delete", commitCount: 2 },
        },
      },
    });
    expect(report.lifecycle).toEqual({ init: "passed", validate: "passed", plan: "passed", apply: "passed", destroy: "passed", absence: "passed" });
    expect(spawnCommands).toEqual(["version", "init", "validate", "plan", "show", "apply", "output", "destroy", "state"]);
    expect(requests).toHaveLength(32);
    expect(
      requests.filter(({ authorization }) => authorization === null),
    ).toHaveLength(4);
    expect(
      requests
        .filter(({ authorization }) => authorization !== null)
        .every(({ authorization }) => authorization === `Bearer ${evidenceToken}`),
    ).toBe(true);
    expect(
      requests.filter(({ url }) => new URL(url).pathname.endsWith("/execution-evidence")),
    ).toHaveLength(11);
    expect(
      requests.filter(({ url }) => new URL(url).pathname.endsWith("/native-residual")),
    ).toHaveLength(6);
  });

  test("runs a real loopback diagnostic lifecycle without .invalid interception and marks runtime absence not-applicable", async () => {
    const hostRequests: string[] = [];
    let outputIdentities: Record<string, ResourceIdentity> | undefined;
    let resourcesPresent = true;
    let capturedWorkDir: string | undefined;
    const discoveryDocument = {
      api_versions: ["forms.takoform.com/v1"],
      features: {
        service_forms: true,
        exact_form_ref: true,
        optimistic_concurrency: true,
        idempotent_lifecycle: true,
        operations: true,
        artifact_upload: true,
        support_profiles: true,
      },
      endpoints: { api: "" },
    };
    let hostServer: ReturnType<typeof Bun.serve>;
    hostServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request: Request): Promise<Response> => {
        const url = new URL(request.url);
        hostRequests.push(url.toString());
        if (url.pathname === "/.well-known/takoform/v1") {
          return new Response(JSON.stringify({ ...discoveryDocument, endpoints: { api: `${hostServer.url.origin}/apis/forms.takoform.com/v1` } }), { status: 200 });
        }
        if (url.pathname.endsWith("/execution-evidence")) {
          const uid = decodeURIComponent(url.pathname.split("/").at(-2) ?? "");
          const current = outputIdentities && Object.values(outputIdentities)
            .find((resource) => resource.uid === uid);
          if (!current) {
            return new Response(JSON.stringify({
              error: {
                code: "not_found",
                message: "Resource execution evidence was not found",
                requestId: "request-loopback-execution-capability",
                retryable: false,
              },
            }), {
              status: 404,
              headers: {
                "cache-control": "private, no-store",
                "content-type": "application/json",
                "x-content-type-options": "nosniff",
              },
            });
          }
          const createCommit = {
            sequence: 1,
            operationId: `create-${uid}`,
            action: "create",
            outcome: "committed",
            resourceVersion: { generation: "1", revision: "1" },
            committedAt: "2026-09-04T00:00:01.000Z",
          };
          const commits = resourcesPresent
            ? [createCommit]
            : [{
                sequence: 2,
                operationId: `delete-${uid}`,
                action: "delete",
                outcome: "committed",
                resourceVersion: { generation: "1", revision: "2" },
                committedAt: "2026-09-04T00:00:02.000Z",
              }, createCommit];
          return new Response(JSON.stringify({
            executionEvidence: {
              format: "takoserver.resource-execution-evidence/v1",
              organizationId: "org-integration-e2e",
              resource: {
                uid: current.uid,
                address: {
                  space: current.space,
                  apiVersion: current.form_api_version,
                  kind: current.form_kind,
                  name: current.name,
                },
                formRef: {
                  apiVersion: current.form_api_version,
                  kind: current.form_kind,
                  definitionVersion: current.form_definition_version,
                  schemaDigest: current.form_schema_digest,
                },
              },
              coverage: "complete",
              snapshotFence: commits.length,
              commits,
            },
          }), {
            status: 200,
            headers: {
              "cache-control": "private, no-store",
              "content-type": "application/json",
              "x-content-type-options": "nosniff",
            },
          });
        }
        if (url.pathname.endsWith("/native-residual")) {
          return new Response(JSON.stringify({
            error: {
              code: "resource_not_found",
              message: "Resource was not found",
              requestId: "request-loopback-native-capability",
              retryable: false,
            },
          }), { status: 404, headers: { "content-type": "application/json" } });
        }
        const name = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
        const current = outputIdentities && Object.values(outputIdentities).find((resource) => resource.name === name);
        if (!current || !resourcesPresent) {
          return new Response(JSON.stringify({ error: { code: "resource_not_found", message: "gone", requestId: "request-loopback", retryable: false } }), { status: 404 });
        }
        return new Response(JSON.stringify({
          apiVersion: current.form_api_version,
          kind: current.form_kind,
          form: { formRef: { apiVersion: current.form_api_version, kind: current.form_kind, definitionVersion: current.form_definition_version, schemaDigest: current.form_schema_digest } },
          metadata: { name: current.name, space: current.space, uid: current.uid, generation: current.generation, revision: current.revision },
          spec: {},
          status: {
            observedGeneration: current.generation,
            conditions: [{ type: "Ready", status: "True", reason: "Available", lastTransitionTime: "2026-01-01T00:00:00Z" }],
            ...(current.form_kind === "WorkerEndpoint" ? { outputs: { hostname: current.hostname, url: current.url } } : {}),
          },
        }), { status: 200 });
      },
    });
    try {
      const config = parseArgs([
        "--run", "--host", hostServer.url.origin, "--space", "space-loopback",
        "--organization-id", "org-integration-e2e", "--timeout-ms", "500", "--kill-grace-ms", "100",
      ], { [MUTATION_TOKEN_ENV]: token, [EVIDENCE_TOKEN_ENV]: evidenceToken });
      const spawn: SpawnFunction = (argv, options) => {
        const subcommand = argv[1] ?? "";
        capturedWorkDir = options.cwd as string;
        if (subcommand === "version") {
          return { exited: Promise.resolve(0), stdout: new Response("OpenTofu v1.12.3\n").body, stderr: new Response("").body };
        }
        if (subcommand === "init") {
          const workDir = options.cwd as string;
          const providerPath = join(workDir, ".terraform/providers/registry.terraform.io/tako0614/takoform/4.0.0/linux_amd64/terraform-provider-takoform_v4.0.0");
          const setup = mkdir(join(providerPath, ".."), { recursive: true })
            .then(() => writeFile(providerPath, "synthetic-provider-4.0.0"))
            .then(() => chmod(providerPath, 0o755));
          return { exited: setup.then(() => 0), stdout: new Response("").body, stderr: new Response("").body };
        }
        if (subcommand === "validate" || subcommand === "destroy" || subcommand === "state") {
          if (subcommand === "destroy") resourcesPresent = false;
          return { exited: Promise.resolve(0), stdout: new Response("").body, stderr: new Response("").body };
        }
        if (subcommand === "plan") {
          return { exited: writeFile(argv.at(-1) as string, "synthetic-saved-plan").then(() => 0), stdout: new Response("").body, stderr: new Response("").body };
        }
        if (subcommand === "show") {
          const environment = options.env as Record<string, string | undefined>;
          return { exited: Promise.resolve(0), stdout: new Response(JSON.stringify(strictPlanFixture(environment))).body, stderr: new Response("").body };
        }
        if (subcommand === "apply") {
          return { exited: Promise.resolve(0), stdout: new Response("").body, stderr: new Response("").body };
        }
        if (subcommand === "output") {
          const environment = options.env as Record<string, string | undefined>;
          const projectName = environment.TF_VAR_project_name as string;
          const runNonce = environment.TF_VAR_project_nonce as string;
          const runUid = environment.TF_VAR_project_uid as string;
          const revisions = createRevisionNameContext({
            projectName,
            configValue: environment.TF_VAR_config_value as string,
            nonce: runNonce,
            projectUid: runUid,
            workerModuleSha256: "sha256:0a0076dcbdef296ac1f61d506f1ef25e75531001beb116e84041a8c186c68765",
            workerModuleSize: 1871,
            bundleManifestDigest: "sha256:9053305f3308c67b2a25758422bf72b83980974c3f0f4c16c4866b0e578302b9",
          });
          const endpointUrl = `https://${projectName}.invalid/`;
          outputIdentities = Object.fromEntries(RESOURCE_KEYS.map((key) => [key, {
            ...identity(key, projectName, revisions),
            name: projectResourceName(key, projectName, revisions),
            space: environment.TF_VAR_space,
            hostname: key === "worker_endpoint" ? `${projectName}.invalid` : null,
            url: key === "worker_endpoint" ? endpointUrl : null,
          }])) as Record<string, ResourceIdentity>;
          return {
            exited: Promise.resolve(0),
            stdout: new Response(JSON.stringify({
              resource_identities: { sensitive: false, type: ["map", "object"], value: outputIdentities },
              config_value: { sensitive: false, type: "string", value: config.configValue },
              endpoint_url: { sensitive: false, type: "string", value: endpointUrl },
              endpoint_hostname: { sensitive: false, type: "string", value: `${projectName}.invalid` },
              project_nonce: { sensitive: false, type: "string", value: runNonce },
              project_uid: { sensitive: false, type: "string", value: runUid },
            })).body,
            stderr: new Response("").body,
          };
        }
        throw new Error(`unexpected child command ${subcommand}`);
      };
      const report = await runTracer(config, { providerFetchImpl: publicProviderFetch, spawn });
      expect(report.runtimeProbe.mode).toBe("loopback-diagnostic");
      expect(report.runtime).toMatchObject({ hostRuntimeEligible: false, e2eEligible: false, gaEligible: false });
      expect(report.ledger.endpoint).toMatchObject({ status: "not-applicable", applicability: "not-applicable", reason: "loopback-diagnostic-endpoint-has-no-host-runtime" });
      expect(report.lifecycle.absence).toBe("not-applicable");
      expect(hostRequests.some((request) => request.includes(".invalid"))).toBe(false);
      expect(capturedWorkDir).toBeTruthy();
      if (capturedWorkDir) await expect(lstat(capturedWorkDir)).rejects.toThrow();
    } finally {
      hostServer.stop(true);
    }
  });

  test("fails closed when post-destroy absence readback returns 401", async () => {
    let removeCalls = 0;
    await expect(cleanupAfterApply({
      recoveryPath: "/tmp/post-destroy-401",
      destroy: async () => undefined,
      absence: async () => {
        throw new Error("absence returned HTTP 401");
      },
      remove: async () => {
        removeCalls += 1;
      },
    })).rejects.toMatchObject({ recoveryPath: "/tmp/post-destroy-401" });
    expect(removeCalls).toBe(0);
  });

  test("renders a token-free direct-only provider install config", () => {
    const config = createProviderInstallConfig();
    expect(config).toContain("provider_installation");
    expect(config).toContain("direct {}");
    expect(config).not.toContain("dev_overrides");
    expect(config).not.toContain(token);
  });

  test("declares revision owners and lets Provider 4 derive immutable names", async () => {
    const configuration = await readFile(
      join(import.meta.dir, "../../deploy/opentofu/takoserver-fetch-tracer/main.tf"),
      "utf8",
    );
    for (const resourceType of ["takoform_worker_bundle", "takoform_worker_version"]) {
      const start = configuration.indexOf(`resource "${resourceType}" "app" {`);
      expect(start).toBeGreaterThanOrEqual(0);
      const next = configuration.indexOf("\nresource ", start + 1);
      const block = configuration.slice(start, next === -1 ? configuration.length : next);
      expect(block).toMatch(/^\s+revision_owner\s*=/mu);
      expect(block).not.toMatch(/^ {2}name\s*=/mu);
    }
  });

  test("projects the exact current control Takoserver-profile outputs", async () => {
    const outputs = await readFile(
      join(import.meta.dir, "../../deploy/opentofu/takoserver-fetch-tracer/outputs.tf"),
      "utf8",
    );
    const outputNames = [...outputs.matchAll(/^output "([^"]+)" \{/gmu)]
      .map((match) => match[1])
      .sort();
    expect(outputNames).toEqual([
      "config_value",
      "endpoint_hostname",
      "endpoint_url",
      "project_nonce",
      "project_uid",
      "resource_identities",
    ]);
    for (const key of RESOURCE_KEYS) {
      expect(outputs).toMatch(
        new RegExp(`^\\s*${key}\\s+=\\s+local\\.${key}_identity$`, "mu"),
      );
    }
  });

  test("parses porcelain status flags without treating untracked paths as staged", () => {
    expect(parseWorkspaceStatus("?? untracked.txt\0")).toEqual({
      dirty: false,
      staged: false,
      untracked: true,
    });
    expect(parseWorkspaceStatus("?? untracked.txt\0 M worktree.txt\0M  staged.txt\0")).toEqual({
      dirty: true,
      staged: true,
      untracked: true,
    });
    expect(parseWorkspaceStatus("R  renamed.txt\0original.txt\0")).toEqual({
      dirty: false,
      staged: true,
      untracked: false,
    });
  });
});
