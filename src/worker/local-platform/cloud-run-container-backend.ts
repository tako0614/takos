import type {
  ContainerBackend,
  ContainerCreateOpts,
  ContainerCreateResult,
} from "./container-backend.ts";
import {
  type CommandRunner,
  type CommandRunnerResult,
  execCommand,
  pickHostCommandEnv,
} from "./command-runner.ts";

function sanitizeCloudRunServiceName(raw: string): string {
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 63);
  return normalized.length > 0 ? normalized : "takos-service";
}

function serializeGcloudEnvVars(envVars: Record<string, string>): string {
  const entries = Object.entries(envVars)
    .filter(([key]) => key.trim().length > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    return "";
  }

  const delimiter = "@";
  return `^${delimiter}^${
    entries.map(([key, value]) => `${key}=${value}`).join(delimiter)
  }`;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function extractCloudRunUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const directCandidates = [
    readString(record.url),
    readString(record.uri),
    readString((record.status as Record<string, unknown> | undefined)?.url),
    readString((record.status as Record<string, unknown> | undefined)?.uri),
  ];
  const direct = directCandidates.find((candidate) => candidate != null);
  if (direct) {
    return direct;
  }

  const status = record.status;
  if (status && typeof status === "object" && !Array.isArray(status)) {
    return extractCloudRunUrl(status);
  }

  return null;
}

export type CloudRunContainerBackendOptions = {
  projectId: string;
  region: string;
  serviceId?: string;
  serviceAccount?: string;
  ingress?: string;
  allowUnauthenticated?: boolean;
  baseUrl?: string;
  deleteOnRemove?: boolean;
  commandRunner?: CommandRunner;
};

export class CloudRunContainerBackend implements ContainerBackend {
  private readonly projectId: string;

  private readonly region: string;

  private readonly serviceId?: string;

  private readonly serviceAccount?: string;

  private readonly ingress?: string;

  private readonly allowUnauthenticated?: boolean;

  private readonly baseUrl?: string;

  private readonly deleteOnRemove: boolean;

  private readonly commandRunner: CommandRunner;

  constructor(options: CloudRunContainerBackendOptions) {
    this.projectId = options.projectId;
    this.region = options.region;
    this.serviceId = options.serviceId;
    this.serviceAccount = options.serviceAccount;
    this.ingress = options.ingress;
    this.allowUnauthenticated = options.allowUnauthenticated;
    this.baseUrl = options.baseUrl;
    this.deleteOnRemove = options.deleteOnRemove ?? true;
    this.commandRunner = options.commandRunner ?? execCommand;
  }

  async pullImage(_imageRef: string): Promise<void> {
    // Cloud Run resolves images on deploy.
  }

  private async gcloud(args: string[]): Promise<CommandRunnerResult> {
    const fullArgs = [...args];
    if (!fullArgs.includes("--project")) {
      fullArgs.push("--project", this.projectId);
    }
    return this.commandRunner("gcloud", fullArgs, {
      env: pickHostCommandEnv([
        "CLOUDSDK_CONFIG",
        "CLOUDSDK_CORE_PROJECT",
        "CLOUDSDK_AUTH_ACCESS_TOKEN",
        "GOOGLE_APPLICATION_CREDENTIALS",
      ]),
    });
  }

  async createAndStart(
    opts: ContainerCreateOpts,
  ): Promise<ContainerCreateResult> {
    const serviceName = sanitizeCloudRunServiceName(
      this.serviceId ?? opts.name,
    );
    const args = [
      "run",
      "deploy",
      serviceName,
      "--image",
      opts.imageRef,
      "--region",
      this.region,
      "--platform",
      "managed",
      "--port",
      String(opts.exposedPort),
      "--quiet",
      "--format=json",
    ];

    if (this.serviceAccount) {
      args.push("--service-account", this.serviceAccount);
    }
    if (this.ingress) {
      args.push("--ingress", this.ingress);
    }
    if (this.allowUnauthenticated === true) {
      args.push("--allow-unauthenticated");
    } else if (this.allowUnauthenticated === false) {
      args.push("--no-allow-unauthenticated");
    }
    if (opts.envVars && Object.keys(opts.envVars).length > 0) {
      args.push("--set-env-vars", serializeGcloudEnvVars(opts.envVars));
    }

    const result = await this.gcloud(args);
    if (result.exitCode !== 0) {
      throw new Error(
        result.stderr ||
          `gcloud run deploy exited with code ${result.exitCode}`,
      );
    }

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      parsed = null;
    }

    const runtimeBaseUrl = this.baseUrl ??
      extractCloudRunUrl(parsed) ??
      (opts.requestedEndpoint?.kind === "http-url"
        ? opts.requestedEndpoint.base_url
        : null);
    if (!runtimeBaseUrl) {
      throw new Error("Cloud Run deployment did not return a service URL");
    }

    const healthUrl = new URL(opts.healthPath ?? "/health", runtimeBaseUrl)
      .toString();

    return {
      containerId: serviceName,
      resolvedEndpoint: {
        kind: "http-url",
        base_url: runtimeBaseUrl,
      },
      healthCheckUrl: healthUrl,
    };
  }

  async stop(containerId: string): Promise<void> {
    await this.remove(containerId);
  }

  async remove(containerId: string): Promise<void> {
    if (!this.deleteOnRemove) {
      return;
    }
    const result = await this.gcloud([
      "run",
      "services",
      "delete",
      sanitizeCloudRunServiceName(containerId),
      "--region",
      this.region,
      "--quiet",
    ]);
    if (result.exitCode !== 0 && !result.stderr.includes("was not found")) {
      throw new Error(
        result.stderr ||
          `gcloud run services delete exited with code ${result.exitCode}`,
      );
    }
  }

  async getLogs(containerId: string, tail = 100): Promise<string> {
    const result = await this.gcloud([
      "logging",
      "read",
      `resource.type="cloud_run_revision" AND resource.labels.service_name="${
        sanitizeCloudRunServiceName(containerId)
      }"`,
      "--limit",
      String(tail),
      "--order=desc",
      "--format=value(textPayload)",
    ]);
    if (result.exitCode !== 0) {
      return "";
    }
    return result.stdout;
  }

  async getContainerIp(_containerId: string): Promise<string | null> {
    return null;
  }
}
