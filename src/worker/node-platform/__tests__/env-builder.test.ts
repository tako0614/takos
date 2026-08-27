import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

test("self-hosted production fails closed without a durable SessionDO backend", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "takos-node-env-builder-test-"));
  try {
    const moduleUrl = pathToFileURL(
      resolve(import.meta.dir, "../env-builder.ts"),
    ).href;
    const childSource = `
      const { createNodeWebEnv, disposeNodePlatformState } = await import(${JSON.stringify(moduleUrl)});
      try {
        const env = await createNodeWebEnv();
        process.stdout.write(JSON.stringify({
          clientId: env.OIDC_CLIENT_ID,
          hasWorkspaceSelector: Object.prototype.hasOwnProperty.call(env, "TAKOSUMI_WORKSPACE_ID"),
          hasSecret: Boolean(env.OIDC_CLIENT_SECRET),
        }));
      } finally {
        await disposeNodePlatformState({ clearData: true });
      }
    `;
    const childEnv = { ...process.env };
    delete childEnv.OIDC_CLIENT_SECRET;
    Object.assign(childEnv, {
      ADMIN_DOMAIN: "takos.example",
      TENANT_BASE_DOMAIN: "tenant.example",
      ENVIRONMENT: "production",
      OIDC_ISSUER_URL: "https://accounts.example",
      OIDC_CLIENT_ID: "takos-public-client",
      TAKOSUMI_WORKSPACE_ID: "workspace-public-client",
      PLATFORM_PRIVATE_KEY: "production-private-key",
      PLATFORM_PUBLIC_KEY: "production-public-key",
      ENCRYPTION_KEY: "production-encryption-key",
      TAKOS_AGENT_START_TOKEN: "production-agent-start-token",
      TAKOS_LOCAL_DATA_DIR: dataDir,
    });

    const result = Bun.spawnSync(["bun", "-e", childSource], {
      env: childEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = result.stdout.toString();
    const stderr = result.stderr.toString();
    expect(result.exitCode, `${stdout}${stderr}`).not.toBe(0);
    expect(`${stdout}${stderr}`).toContain(
      "Node SessionDO requires a durable backend in production; process-memory state is development-only",
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
