/**
 * Explicit online evidence only. This file is intentionally not part of
 * `bun run check` or `test:product-materializer`: it contacts the public
 * Registry/GitHub release and must be run by the owner on an online cadence.
 */
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";

import {
  assertProviderLockfile,
  buildTofuEnvironment,
  createProviderInstallConfig,
  fetchPublicProviderRelease,
  runBoundedCommand,
  verifyInstalledProviderBinary,
  type CliConfig,
} from "../takoserver-fetch-tracer.ts";

const mutationToken = "online-evidence-mutation-token";

test("online evidence initializes and validates the exact public Provider 4.0.0", async () => {
  const root = await mkdtemp(join(tmpdir(), "fetch-tracer-public-provider-online-"));
  try {
    const fixture = join(root, "fixture");
    await cp(join(import.meta.dir, "../../deploy/opentofu/takoserver-fetch-tracer"), fixture, { recursive: true });
    const cliConfigFile = join(root, "tofu.tfrc");
    await Bun.write(cliConfigFile, createProviderInstallConfig());
    const tfDataDir = join(root, "tfdata");
    const config: CliConfig = {
      host: "https://127.0.0.1:8787",
      space: "space-a",
      endpointOriginTemplate: "https://{project}.invalid/",
      tokenEnv: "TAKOFORM_ONLINE_EVIDENCE_TOKEN",
      token: mutationToken,
      evidenceTokenEnv: "TAKOFORM_ONLINE_EVIDENCE_READ_TOKEN",
      evidenceToken: "online-evidence-read-token",
      tofu: "tofu",
      timeoutMs: 120_000,
      killGraceMs: 2_000,
      configValue: "safe",
      fixtureDir: fixture,
    };
    const environment = buildTofuEnvironment({
      base: { ...process.env, TF_PLUGIN_CACHE_DIR: "/must-not-cross", TF_CLI_ARGS_init: "-upgrade" },
      host: config.host,
      space: config.space,
      token: config.token,
      configValue: config.configValue,
      cliConfigFile,
      tfDataDir,
      projectName: "takos-fetch-tracer-online",
      projectNonce: "a".repeat(64),
      projectUid: `puid-${"a".repeat(64)}`,
    });
    expect(environment.TF_PLUGIN_CACHE_DIR).toBeUndefined();
    expect(environment.TF_CLI_ARGS_init).toBeUndefined();
    const providerRelease = await fetchPublicProviderRelease({ timeoutMs: config.timeoutMs });
    expect(providerRelease.signatureVerified).toBe(true);
    const tokenlessEnvironment = { ...environment, TAKOFORM_TOKEN: undefined };
    const command = {
      command: config.tofu,
      cwd: fixture,
      env: tokenlessEnvironment,
      timeoutMs: config.timeoutMs,
      killGraceMs: config.killGraceMs,
      token: [config.token, config.evidenceToken] as const,
    };
    await runBoundedCommand({
      ...command,
      args: ["init", "-backend=false", "-input=false", "-lockfile=readonly", "-no-color"],
    });
    const providerEvidence = await verifyInstalledProviderBinary(fixture, tfDataDir);
    const archive = providerRelease.archiveChecksums.find((entry) => entry.platform === providerEvidence.platform);
    expect(archive).toBeDefined();
    // The signed release digest covers the downloaded archive; the installed
    // evidence separately hashes the extracted executable. Both are retained
    // and must be canonical, but they are intentionally different byte sets.
    expect(archive?.sha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(providerEvidence.sha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    const lock = assertProviderLockfile(await readFile(join(fixture, ".terraform.lock.hcl"), "utf8"));
    expect(lock.version).toBe("4.0.0");
    await runBoundedCommand({ ...command, args: ["validate", "-no-color"] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 180_000);
