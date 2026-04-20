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

type EcsTaskDefinitionRecord = Record<string, unknown>;
type EcsServiceRecord = Record<string, unknown>;

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function sanitizeEcsServiceName(raw: string): string {
  const normalized = raw.replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 255);
  return normalized.length > 0 ? normalized : "takos-service";
}

function parseArnTerminalName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  const slash = trimmed.split("/").pop();
  return slash && slash.length > 0 ? slash : undefined;
}

function readObjectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function tailLines(text: string, tail: number): string {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  return `${lines.slice(Math.max(0, lines.length - tail)).join("\n")}${
    lines.length > 0 ? "\n" : ""
  }`;
}

function buildEnvironment(
  existing: unknown,
  envVars: Record<string, string> | undefined,
): Array<{ name: string; value: string }> | undefined {
  const merged = new Map<string, string>();
  if (Array.isArray(existing)) {
    for (const entry of existing) {
      const record = readObjectRecord(entry);
      const name = readString(record?.name);
      const value = readString(record?.value);
      if (name && value != null) {
        merged.set(name, value);
      }
    }
  }
  if (envVars) {
    for (const [key, value] of Object.entries(envVars)) {
      merged.set(key, value);
    }
  }
  return merged.size > 0
    ? Array.from(merged.entries()).map(([name, value]) => ({ name, value }))
    : undefined;
}

function buildPortMappings(
  existing: unknown,
  exposedPort: number,
): Array<Record<string, unknown>> {
  if (Array.isArray(existing) && existing.length > 0) {
    return existing.map((entry, index) => {
      const record = readObjectRecord(entry) ?? {};
      if (index > 0) {
        return record;
      }
      return {
        ...record,
        containerPort: exposedPort,
        ...(record.hostPort !== undefined ? { hostPort: exposedPort } : {}),
      };
    });
  }

  return [{
    containerPort: exposedPort,
    hostPort: exposedPort,
    protocol: "tcp",
  }];
}

function cloneTaskDefinitionForRegister(
  taskDefinition: EcsTaskDefinitionRecord,
): EcsTaskDefinitionRecord {
  const registerInput: EcsTaskDefinitionRecord = {};
  for (
    const key of [
      "family",
      "taskRoleArn",
      "executionRoleArn",
      "networkMode",
      "containerDefinitions",
      "volumes",
      "placementConstraints",
      "requiresCompatibilities",
      "cpu",
      "memory",
      "tags",
      "pidMode",
      "ipcMode",
      "proxyConfiguration",
      "inferenceAccelerators",
      "ephemeralStorage",
      "runtimePlatform",
    ]
  ) {
    if (taskDefinition[key] !== undefined) {
      registerInput[key] = taskDefinition[key];
    }
  }
  return registerInput;
}

function serviceExists(service: EcsServiceRecord | null): boolean {
  return !!service && readString(service.status) !== "INACTIVE";
}

export type EcsContainerBackendOptions = {
  region: string;
  clusterArn: string;
  taskDefinitionFamily: string;
  serviceArn?: string;
  serviceName?: string;
  containerName?: string;
  subnetIds?: string[];
  securityGroupIds?: string[];
  assignPublicIp?: boolean;
  launchType?: string;
  desiredCount?: number;
  baseUrl?: string;
  healthUrl?: string;
  commandRunner?: CommandRunner;
};

export class EcsContainerBackend implements ContainerBackend {
  private readonly region: string;

  private readonly clusterArn: string;

  private readonly taskDefinitionFamily: string;

  private readonly serviceArn?: string;

  private readonly serviceName?: string;

  private readonly containerName?: string;

  private readonly subnetIds: string[];

  private readonly securityGroupIds: string[];

  private readonly assignPublicIp: boolean;

  private readonly launchType: string;

  private readonly desiredCount: number;

  private readonly baseUrl?: string;

  private readonly healthUrl?: string;

  private readonly commandRunner: CommandRunner;

  constructor(options: EcsContainerBackendOptions) {
    this.region = options.region;
    this.clusterArn = options.clusterArn;
    this.taskDefinitionFamily = options.taskDefinitionFamily;
    this.serviceArn = options.serviceArn;
    this.serviceName = options.serviceName;
    this.containerName = options.containerName;
    this.subnetIds = options.subnetIds ?? [];
    this.securityGroupIds = options.securityGroupIds ?? [];
    this.assignPublicIp = options.assignPublicIp ?? true;
    this.launchType = options.launchType ?? "FARGATE";
    this.desiredCount = options.desiredCount ?? 1;
    this.baseUrl = options.baseUrl;
    this.healthUrl = options.healthUrl;
    this.commandRunner = options.commandRunner ?? execCommand;
  }

  async pullImage(_imageRef: string): Promise<void> {
    // ECS pulls images on task startup.
  }

  private async aws(args: string[]): Promise<CommandRunnerResult> {
    return this.commandRunner("aws", args, {
      env: {
        ...pickHostCommandEnv([
          "AWS_ACCESS_KEY_ID",
          "AWS_SECRET_ACCESS_KEY",
          "AWS_SESSION_TOKEN",
          "AWS_SECURITY_TOKEN",
          "AWS_PROFILE",
          "AWS_CONFIG_FILE",
          "AWS_SHARED_CREDENTIALS_FILE",
          "AWS_CA_BUNDLE",
          "AWS_ENDPOINT_URL",
        ]),
        AWS_DEFAULT_REGION: this.region,
      },
    });
  }

  private async awsJson<T>(args: string[]): Promise<T> {
    const result = await this.aws([...args, "--output", "json"]);
    if (result.exitCode !== 0) {
      throw new Error(
        result.stderr ||
          `aws ${args.join(" ")} exited with code ${result.exitCode}`,
      );
    }
    try {
      return JSON.parse(result.stdout) as T;
    } catch (error) {
      throw new Error(
        `Failed to parse aws JSON response: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private resolveServiceName(fallbackName: string): string {
    return sanitizeEcsServiceName(
      this.serviceName ??
        parseArnTerminalName(this.serviceArn) ??
        fallbackName,
    );
  }

  private async describeTaskDefinition(): Promise<EcsTaskDefinitionRecord> {
    const response = await this.awsJson<
      { taskDefinition?: Record<string, unknown> }
    >([
      "ecs",
      "describe-task-definition",
      "--task-definition",
      this.taskDefinitionFamily,
    ]);
    if (!response.taskDefinition) {
      throw new Error(
        `ECS task definition "${this.taskDefinitionFamily}" was not found`,
      );
    }
    return response.taskDefinition;
  }

  private async describeService(
    serviceName: string,
  ): Promise<EcsServiceRecord | null> {
    const response = await this.awsJson<
      { services?: Array<Record<string, unknown>> }
    >([
      "ecs",
      "describe-services",
      "--cluster",
      this.clusterArn,
      "--services",
      serviceName,
    ]);
    const service = Array.isArray(response.services)
      ? response.services[0]
      : undefined;
    return service ?? null;
  }

  private pickContainerDefinition(
    taskDefinition: EcsTaskDefinitionRecord,
  ): { containerDefinitions: Array<Record<string, unknown>>; index: number } {
    const containerDefinitions =
      Array.isArray(taskDefinition.containerDefinitions)
        ? taskDefinition.containerDefinitions
          .map((entry) => readObjectRecord(entry))
          .filter((entry): entry is Record<string, unknown> => entry != null)
        : [];
    if (containerDefinitions.length === 0) {
      throw new Error(
        `ECS task definition "${this.taskDefinitionFamily}" has no container definitions`,
      );
    }

    const index = this.containerName
      ? containerDefinitions.findIndex((entry) =>
        readString(entry.name) === this.containerName
      )
      : 0;
    if (index < 0) {
      throw new Error(
        `ECS container "${this.containerName}" was not found in task definition "${this.taskDefinitionFamily}"`,
      );
    }
    return { containerDefinitions, index };
  }

  private async registerTaskDefinition(
    opts: ContainerCreateOpts,
  ): Promise<string> {
    const taskDefinition = await this.describeTaskDefinition();
    const registerInput = cloneTaskDefinitionForRegister(taskDefinition);
    const { containerDefinitions, index } = this.pickContainerDefinition(
      taskDefinition,
    );
    const target = { ...containerDefinitions[index]! };
    target.image = opts.imageRef;
    target.environment = buildEnvironment(target.environment, opts.envVars);
    target.portMappings = buildPortMappings(
      target.portMappings,
      opts.exposedPort,
    );
    target.dockerLabels = {
      ...(readObjectRecord(target.dockerLabels) ?? {}),
      ...(opts.labels ?? {}),
    };
    containerDefinitions[index] = target;
    registerInput.containerDefinitions = containerDefinitions;

    const response = await this.awsJson<{
      taskDefinition?: {
        taskDefinitionArn?: string;
      };
    }>([
      "ecs",
      "register-task-definition",
      "--cli-input-json",
      JSON.stringify(registerInput),
    ]);
    const taskDefinitionArn = readString(
      response.taskDefinition?.taskDefinitionArn,
    );
    if (!taskDefinitionArn) {
      throw new Error(
        "ECS task definition registration did not return a taskDefinitionArn",
      );
    }
    return taskDefinitionArn;
  }

  private async createService(
    serviceName: string,
    taskDefinitionArn: string,
  ): Promise<void> {
    if (this.subnetIds.length === 0) {
      throw new Error(
        "ECS service creation requires subnetIds when the service does not already exist",
      );
    }

    const awsvpcParts = [
      `subnets=[${this.subnetIds.join(",")}]`,
      ...(this.securityGroupIds.length > 0
        ? [`securityGroups=[${this.securityGroupIds.join(",")}]`]
        : []),
      `assignPublicIp=${this.assignPublicIp ? "ENABLED" : "DISABLED"}`,
    ];

    const result = await this.aws([
      "ecs",
      "create-service",
      "--cluster",
      this.clusterArn,
      "--service-name",
      serviceName,
      "--task-definition",
      taskDefinitionArn,
      "--desired-count",
      String(this.desiredCount),
      "--launch-type",
      this.launchType,
      "--network-configuration",
      `awsvpcConfiguration={${awsvpcParts.join(",")}}`,
    ]);
    if (result.exitCode !== 0) {
      throw new Error(
        result.stderr ||
          `aws ecs create-service exited with code ${result.exitCode}`,
      );
    }
  }

  private async updateService(
    serviceName: string,
    taskDefinitionArn: string,
  ): Promise<void> {
    const result = await this.aws([
      "ecs",
      "update-service",
      "--cluster",
      this.clusterArn,
      "--service",
      serviceName,
      "--task-definition",
      taskDefinitionArn,
      "--desired-count",
      String(this.desiredCount),
      "--force-new-deployment",
    ]);
    if (result.exitCode !== 0) {
      throw new Error(
        result.stderr ||
          `aws ecs update-service exited with code ${result.exitCode}`,
      );
    }
  }

  async createAndStart(
    opts: ContainerCreateOpts,
  ): Promise<ContainerCreateResult> {
    const serviceName = this.resolveServiceName(opts.name);
    const taskDefinitionArn = await this.registerTaskDefinition(opts);
    const existingService = await this.describeService(serviceName);

    if (serviceExists(existingService)) {
      await this.updateService(serviceName, taskDefinitionArn);
    } else {
      await this.createService(serviceName, taskDefinitionArn);
    }

    const waitResult = await this.aws([
      "ecs",
      "wait",
      "services-stable",
      "--cluster",
      this.clusterArn,
      "--services",
      serviceName,
    ]);
    if (waitResult.exitCode !== 0) {
      throw new Error(
        waitResult.stderr ||
          `aws ecs wait services-stable exited with code ${waitResult.exitCode}`,
      );
    }

    const baseUrl = this.baseUrl ??
      (opts.requestedEndpoint?.kind === "http-url"
        ? opts.requestedEndpoint.base_url
        : undefined);
    if (!baseUrl) {
      throw new Error(
        "ECS deployment requires backend config baseUrl or a target http-url endpoint",
      );
    }

    const healthCheckUrl = this.healthUrl ??
      new URL(opts.healthPath ?? "/health", baseUrl).toString();

    return {
      containerId: serviceName,
      resolvedEndpoint: {
        kind: "http-url",
        base_url: baseUrl,
      },
      healthCheckUrl,
    };
  }

  async stop(containerId: string): Promise<void> {
    await this.remove(containerId);
  }

  async remove(containerId: string): Promise<void> {
    const result = await this.aws([
      "ecs",
      "delete-service",
      "--cluster",
      this.clusterArn,
      "--service",
      sanitizeEcsServiceName(containerId),
      "--force",
    ]);
    const notFound = result.stderr.includes("ServiceNotFoundException") ||
      result.stderr.includes("ClusterNotFoundException") ||
      result.stderr.includes("not found");
    if (result.exitCode !== 0 && !notFound) {
      throw new Error(
        result.stderr ||
          `aws ecs delete-service exited with code ${result.exitCode}`,
      );
    }
  }

  async getLogs(_containerId: string, tail = 100): Promise<string> {
    try {
      const taskDefinition = await this.describeTaskDefinition();
      const { containerDefinitions, index } = this.pickContainerDefinition(
        taskDefinition,
      );
      const selected = containerDefinitions[index]!;
      const logOptions = readObjectRecord(
        readObjectRecord(selected.logConfiguration)?.options,
      );
      const logGroup = readString(logOptions?.["awslogs-group"]);
      if (!logGroup) {
        return "";
      }

      const result = await this.aws([
        "logs",
        "tail",
        logGroup,
        "--since",
        "1h",
        "--format",
        "short",
      ]);
      if (result.exitCode !== 0) {
        return "";
      }
      return tailLines(result.stdout, tail);
    } catch {
      return "";
    }
  }

  async getContainerIp(_containerId: string): Promise<string | null> {
    return null;
  }
}
