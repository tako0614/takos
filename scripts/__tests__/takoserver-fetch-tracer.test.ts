import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import {
  assertExactAbsence,
  assertExactIdentitySet,
  assertExactProbeBody,
  assertProviderVersion,
  assertReadbackEnvelope,
  assertAuthoritativeAbsence,
  buildTofuEnvironment,
  canonicalDigest,
  cleanupRunRoot,
  cleanupAfterApply,
  createProviderOverrideConfig,
  installProviderOverride,
  knownResourceAddresses,
  PROVIDER4_FORM_REFS,
  parseArgs,
  parseWorkspaceStatus,
  parseTofuOutputs,
  projectResourceName,
  redactOutput,
  resourceURL,
  runBoundedCommand,
  unwrapTofuOutput,
  validateBareOrigin,
  validateSpace,
  validateV1Discovery,
  verifyProviderBinary,
  type ResourceIdentity,
  type SpawnedChild,
} from "../takoserver-fetch-tracer.ts";

const token = "test-token-value";

function identity(key: "module_worker" | "worker_bundle" | "worker_version" | "worker_deployment" | "worker_endpoint"): ResourceIdentity {
  const form = PROVIDER4_FORM_REFS[key];
  return {
    name: projectResourceName(key),
    space: "space-a",
    uid: `uid-${key}`,
    generation: "1",
    revision: "1",
    ready: true,
    form_api_version: form.apiVersion,
    form_kind: form.kind,
    form_definition_version: form.definitionVersion,
    form_schema_digest: form.schemaDigest,
    hostname: key === "worker_endpoint" ? "worker.invalid" : null,
    url: key === "worker_endpoint" ? "https://worker.invalid/" : null,
  };
}

function identities(): Record<string, ResourceIdentity> {
  return {
    module_worker: identity("module_worker"),
    worker_bundle: identity("worker_bundle"),
    worker_version: identity("worker_version"),
    worker_deployment: identity("worker_deployment"),
    worker_endpoint: identity("worker_endpoint"),
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
  test("requires an explicit opt-in and keeps the token in the environment", () => {
    expect(() => parseArgs(["--host", "https://host.example", "--space", "space-a", "--provider-binary", "/tmp/provider", "--provider-sha256", "a".repeat(64)], { TAKOFORM_TOKEN: token })).toThrow(/refusing to mutate/u);
    expect(() => parseArgs(["--run", "--host", "https://host.example", "--space", "space-a", "--provider-binary", "/tmp/provider", "--provider-sha256", "a".repeat(64), "--token", token], { TAKOFORM_TOKEN: token })).toThrow(/never argv/u);
    const config = parseArgs(["--run", "--host", "https://host.example", "--space", "space-a", "--provider-binary", "/tmp/provider", "--provider-sha256", "a".repeat(64)], { TAKOFORM_TOKEN: token });
    expect(config.token).toBe(token);
    expect(() => parseArgs([
      "--run",
      "--host", "https://host.example",
      "--space", "space-a",
      "--provider-binary", "/tmp/provider",
      "--provider-sha256", "a".repeat(64),
      "--config-value", `prefix-${token}-suffix`,
    ], { TAKOFORM_TOKEN: token })).toThrow(/must not contain the Host token/u);
    const environment = buildTofuEnvironment({ host: config.host, space: config.space, token, configValue: "safe-config", cliConfigFile: "/tmp/tofu.tfrc", tfDataDir: "/tmp/tofu-data" });
    expect(environment.TAKOFORM_TOKEN).toBe(token);
    expect(environment.TF_VAR_config_value).toBe("safe-config");
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
    expect(collision.TF_VAR_project_name).toBe("takos-fetch-tracer-abc");
    expect(collision.TF_WORKSPACE).toBeUndefined();
    expect(collision.TF_CLI_ARGS_apply).toBeUndefined();
    expect(collision.TF_LOG).toBeUndefined();
    expect(collision.TF_PLUGIN_CACHE_DIR).toBeUndefined();
    expect(collision.TF_REATTACH_PROVIDERS).toBeUndefined();
    expect(collision.TF_REGISTRY_CLIENT_CERT).toBeUndefined();
    expect(collision.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(collision.CALLER_TOKEN).toBeUndefined();
    expect(collision.TF_CLI_CONFIG_FILE).not.toBe(token);
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

  test("redacts exact secrets from diagnostics and rejects argv leakage", async () => {
    expect(redactOutput(`stdout ${token} stderr`, token)).toBe("stdout <redacted> stderr");
    const spawn = () => {
      throw new Error("spawn must not be reached");
    };
    await expect(runBoundedCommand({ command: "tofu", args: [token], cwd: "/tmp", env: {}, timeoutMs: 10, killGraceMs: 10, token, spawn })).rejects.toThrow(/argv/u);
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

  test("accepts only Provider 4.0.0 source-build versions", () => {
    expect(assertProviderVersion("terraform-provider-takoform v4.0.0-dev")).toBe("4.0.0-dev");
    expect(assertProviderVersion("terraform-provider-takoform v4.0.0")).toBe("4.0.0");
    expect(() => assertProviderVersion("terraform-provider-takoform v4.0.1")).toThrow();
    expect(() => assertProviderVersion("terraform-provider-takoform v4.0.0-dev+build")).toThrow();
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
    expect(checked.worker_endpoint.url).toBe("https://worker.invalid/");
    expect(() => assertExactIdentitySet({ ...identities(), extra: identity("module_worker") }, "space-a")).toThrow();
    const endpoint = checked.worker_endpoint;
    expect(resourceURL(discovery.apiRoot, endpoint).searchParams.get("schemaDigest")).toBe(endpoint.form_schema_digest);
  });

  test("requires exact readback and exact absence envelopes", () => {
    const current = identity("worker_endpoint");
    const wire = {
      resource: {
        apiVersion: current.form_api_version,
        kind: current.form_kind,
        form: { formRef: { apiVersion: current.form_api_version, kind: current.form_kind, definitionVersion: current.form_definition_version, schemaDigest: current.form_schema_digest } },
        metadata: { name: current.name, space: current.space, uid: current.uid, generation: current.generation, revision: current.revision },
        spec: {},
        status: { observedGeneration: "1", conditions: [{ type: "Ready", status: "True", reason: "Available", lastTransitionTime: "2026-01-01T00:00:00Z" }], outputs: { hostname: current.hostname, url: current.url } },
      },
    };
    expect(() => assertReadbackEnvelope(wire, current)).not.toThrow();
    const absent = { error: { code: "resource_not_found", message: "gone", requestId: "request-1", retryable: false } };
    expect(() => assertExactAbsence(404, absent)).not.toThrow();
    expect(() => assertExactAbsence(404, { error: { ...absent.error, code: "permission_denied" } })).toThrow();
    expect(() => assertExactProbeBody({ buildIdentity: "wrong", configValue: "safe" }, "safe")).toThrow();
    expect(() => assertExactProbeBody({ buildIdentity: "takos-fetch-tracer@experimental-source-build-dev-override", configValue: "safe", extra: true }, "safe")).toThrow();
  });

  test("checks all five static project addresses for exact absence", async () => {
    const requests: string[] = [];
    await assertAuthoritativeAbsence({
      apiRoot: "https://host.example/apis/forms.takoform.com/v1",
      addresses: knownResourceAddresses("space-a"),
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
    expect(requests.some((request) => request.includes("ModuleWorker/takos-fetch-tracer"))).toBe(true);
    expect(requests.some((request) => request.includes("WorkerBundle/takos-fetch-tracer-bundle"))).toBe(true);
    expect(requests.some((request) => request.includes("WorkerVersion/takos-fetch-tracer-version"))).toBe(true);
    expect(requests.some((request) => request.includes("WorkerDeployment/takos-fetch-tracer-deployment"))).toBe(true);
    expect(requests.some((request) => request.includes("WorkerEndpoint/takos-fetch-tracer-endpoint"))).toBe(true);
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
      endpoint_url: { sensitive: false, type: "string", value: "https://worker.invalid/" },
      endpoint_hostname: { sensitive: false, type: "string", value: "worker.invalid" },
    }, "space-a");
    expect(checked.identities.worker_endpoint.name).toBe("takos-fetch-tracer-endpoint");
    expect(checked.configValue).toBe("safe-config");
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

  test("renders a token-free OpenTofu provider dev override", () => {
    const config = createProviderOverrideConfig("/tmp/provider-override");
    expect(config).toContain("registry.terraform.io/tako0614/takoform");
    expect(config).not.toContain(token);
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

const providerBinary = process.env.TAKOFORM_PROVIDER4_BINARY;
const validateTest = providerBinary ? test : test.skip;

validateTest("tofu validate passes with an explicit local Provider 4 binary when supplied", async () => {
  const root = await mkdtemp(join(tmpdir(), "fetch-tracer-validate-"));
  try {
    const fixture = join(root, "fixture");
    await cp(join(import.meta.dir, "../../deploy/opentofu/takoserver-fetch-tracer"), fixture, { recursive: true });
    const verified = await verifyProviderBinary({ path: providerBinary!, digest: `sha256:${createHash("sha256").update(await readFile(providerBinary!)).digest("hex")}` });
    const override = await installProviderOverride({ root, providerPath: verified.path });
    const cliConfigFile = join(root, "tofu.tfrc");
    await Bun.write(cliConfigFile, createProviderOverrideConfig(override.replace(/\/terraform-provider-takoform$/u, "")));
    const environment = buildTofuEnvironment({ host: "https://127.0.0.1:8787", space: "space-a", token, configValue: "safe", cliConfigFile, tfDataDir: join(root, "tfdata") });
    const command = { command: "tofu", cwd: fixture, env: environment, timeoutMs: 60_000, killGraceMs: 2_000, token };
    await runBoundedCommand({ ...command, args: ["validate", "-no-color"] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
