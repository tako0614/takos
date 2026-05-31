import {
  InstallerClient,
  InstallerHttpError,
} from "@takos/takosumi-installer/deploy-client";
import type { Source } from "takosumi-contract/installer-api";
import type { Env } from "../../../shared/types/index.ts";
import { logWarn } from "../../../shared/utils/logger.ts";

export interface TakosumiInstallationResult {
  installationId: string;
  deploymentId?: string;
  status: string;
}

function resolveInstallerClient(env: Env): InstallerClient | null {
  const installerUrl = env.TAKOSUMI_INSTALLER_URL;
  const installerToken = env.TAKOSUMI_INSTALLER_TOKEN;
  if (!installerUrl || !installerToken) {
    return null;
  }
  return new InstallerClient({
    endpoint: installerUrl,
    token: installerToken,
  });
}

function installerErrorDetails(
  error: unknown,
): { status?: number; message: string } {
  if (error instanceof InstallerHttpError) {
    return {
      status: error.status,
      message: error.envelope?.error?.message ?? error.message,
    };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}

export async function createTakosumiInstallation(
  env: Env,
  spaceId: string,
  _spaceName: string,
): Promise<TakosumiInstallationResult | null> {
  const client = resolveInstallerClient(env);
  if (!client) {
    return null;
  }

  // The Takos space root is materialized from a kernel-local source root; the
  // Installer API has no `metadata` field, so the prior `metadata: { name }`
  // body was contract drift and is intentionally dropped.
  const source: Source = { kind: "local", url: "." };

  try {
    const result = await client.install({ spaceId, source });
    return {
      installationId: result.installation.id,
      deploymentId: result.deployment.id,
      status: result.installation.status,
    };
  } catch (error) {
    const { status, message } = installerErrorDetails(error);
    logWarn("Takosumi installation creation failed", {
      module: "takosumi-integration",
      spaceId,
      ...(status === undefined ? {} : { status }),
      error: message,
    });
    return null;
  }
}

export interface TakosumiDeploymentResult {
  deploymentId: string;
  status: string;
}

export async function createTakosumiDeployment(
  env: Env,
  installationId: string,
  source: { kind: string; url: string; digest?: string },
): Promise<TakosumiDeploymentResult | null> {
  const client = resolveInstallerClient(env);
  if (!client || !installationId) {
    return null;
  }

  const deploySource = toDeploymentSource(source);
  if (!deploySource) {
    logWarn("Takosumi deployment creation failed", {
      module: "takosumi-integration",
      installationId,
      error: `unsupported source kind: ${source.kind}`,
    });
    return null;
  }

  try {
    const result = await client.deploy(installationId, {
      source: deploySource,
    });
    return {
      deploymentId: result.deployment.id,
      status: result.deployment.status,
    };
  } catch (error) {
    const { status, message } = installerErrorDetails(error);
    logWarn("Takosumi deployment creation failed", {
      module: "takosumi-integration",
      installationId,
      ...(status === undefined ? {} : { status }),
      error: message,
    });
    return null;
  }
}

function toDeploymentSource(
  source: { kind: string; url: string; digest?: string },
): Source | null {
  switch (source.kind) {
    case "local":
      return { kind: "local", url: source.url };
    case "prepared":
      return source.digest
        ? { kind: "prepared", url: source.url, digest: source.digest }
        : null;
    default:
      // `git` requires a `ref`, which this caller shape cannot supply, so it
      // is not representable here.
      return null;
  }
}

export async function deleteTakosumiInstallation(
  env: Env,
  installationId: string,
): Promise<boolean> {
  // NOTE: uninstall is not part of the 5-endpoint Takosumi Installer API
  // (dry-run / apply for installations + deployments, rollback). The
  // published InstallerClient therefore has no delete method, so this stays a
  // direct DELETE against the installer-managed installation resource.
  const installerUrl = env.TAKOSUMI_INSTALLER_URL;
  const installerToken = env.TAKOSUMI_INSTALLER_TOKEN;
  if (!installerUrl || !installerToken || !installationId) {
    return false;
  }

  try {
    const response = await fetch(
      `${installerUrl.replace(/\/+$/, "")}/v1/installations/${
        encodeURIComponent(installationId)
      }`,
      {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${installerToken}` },
      },
    );
    return response.ok;
  } catch (error) {
    logWarn("Takosumi installation deletion error", {
      module: "takosumi-integration",
      installationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
