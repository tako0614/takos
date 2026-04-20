import type { AppCompute } from "../source/app-manifest-types.ts";
import type { Env } from "../../../shared/types/index.ts";
import type {
  GroupDesiredState,
  GroupWorkloadCategory,
} from "./group-state.ts";

/**
 * Subset of the flat `AppCompute` type accessed by the translation
 * reporter. The only field we read is `image`; the previous envelope
 * shape exposed an `artifact` / `backend` block which the flat schema
 * retired.
 */
type WorkloadRuntimeSpec = Partial<Pick<AppCompute, "image">>;
export type TranslationStatus = "compatible" | "unsupported";

export interface WorkloadTranslationEntry {
  name: string;
  category: GroupWorkloadCategory;
  runtime: "workers" | "container-service";
  runtimeProfile: "workers" | "container-service";
  status: TranslationStatus;
  requirements: string[];
  notes?: string[];
}

export interface RouteTranslationEntry {
  name: string;
  target: string;
  status: TranslationStatus;
  requirements: string[];
  notes?: string[];
}

export interface TranslationIssue {
  category: "workload" | "route";
  name: string;
  message: string;
}

export interface TranslationReport {
  supported: boolean;
  requirements: string[];
  workloads: WorkloadTranslationEntry[];
  routes: RouteTranslationEntry[];
  unsupported: TranslationIssue[];
}

export type TranslationContext = {
  ociOrchestratorUrl?: string;
  awsRegion?: string;
  awsEcsRegion?: string;
  awsEcsClusterArn?: string;
  awsEcsTaskDefinitionFamily?: string;
  gcpProjectId?: string;
  gcpRegion?: string;
  gcpCloudRunRegion?: string;
  k8sNamespace?: string;
};

export function buildTranslationContextFromEnv(env: Env): TranslationContext {
  return {
    ociOrchestratorUrl: env.OCI_ORCHESTRATOR_URL,
    awsRegion: env.AWS_REGION,
    awsEcsRegion: env.AWS_ECS_REGION,
    awsEcsClusterArn: env.AWS_ECS_CLUSTER_ARN,
    awsEcsTaskDefinitionFamily: env.AWS_ECS_TASK_DEFINITION_FAMILY,
    gcpProjectId: env.GCP_PROJECT_ID,
    gcpRegion: env.GCP_REGION,
    gcpCloudRunRegion: env.GCP_CLOUD_RUN_REGION,
    k8sNamespace: env.K8S_NAMESPACE,
  };
}

function uniqueRequirements(
  entries: Array<{ requirements: string[] }>,
): string[] {
  return Array.from(new Set(entries.flatMap((entry) => entry.requirements)))
    .sort();
}

function trimString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function getContainerImageRef(spec: WorkloadRuntimeSpec): string | undefined {
  return trimString(spec.image);
}

function imageBackedWorkloadRequirements(backend: string): string[] {
  const common = ["OCI_ORCHESTRATOR_URL"];
  switch (backend) {
    case "aws":
      return [
        ...common,
        "AWS_ECS_REGION or AWS_REGION",
        "AWS_ECS_CLUSTER_ARN",
        "AWS_ECS_TASK_DEFINITION_FAMILY",
      ];
    case "gcp":
      return [
        ...common,
        "GCP_PROJECT_ID",
        "GCP_CLOUD_RUN_REGION or GCP_REGION",
      ];
    case "k8s":
      return [...common, "K8S_NAMESPACE"];
    case "cloudflare":
    case "local":
    default:
      return common;
  }
}

function translateWorkload(
  name: string,
  category: GroupWorkloadCategory,
  backend: string,
  spec: WorkloadRuntimeSpec = {},
): WorkloadTranslationEntry {
  if (category === "worker") {
    return {
      name,
      category,
      runtime: "workers",
      runtimeProfile: "workers",
      status: "compatible",
      requirements: [],
      notes: [
        "tenant runtime realizes worker workloads through the worker runtime.",
      ],
    };
  }

  const imageRef = getContainerImageRef(spec);
  const requirements = imageRef ? imageBackedWorkloadRequirements(backend) : [];

  return {
    name,
    category,
    runtime: "container-service",
    runtimeProfile: "container-service",
    status: "compatible",
    requirements,
    notes: [
      "tenant runtime realizes service and container workloads through the container runtime.",
    ],
  };
}

function hasConfiguredValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isRequirementMet(
  requirement: string,
  context: TranslationContext,
): boolean {
  switch (requirement) {
    case "OCI_ORCHESTRATOR_URL":
      return hasConfiguredValue(context.ociOrchestratorUrl);
    case "AWS_ECS_REGION or AWS_REGION":
      return hasConfiguredValue(context.awsEcsRegion) ||
        hasConfiguredValue(context.awsRegion);
    case "AWS_ECS_CLUSTER_ARN":
      return hasConfiguredValue(context.awsEcsClusterArn);
    case "AWS_ECS_TASK_DEFINITION_FAMILY":
      return hasConfiguredValue(context.awsEcsTaskDefinitionFamily);
    case "GCP_PROJECT_ID":
      return hasConfiguredValue(context.gcpProjectId);
    case "GCP_CLOUD_RUN_REGION or GCP_REGION":
      return hasConfiguredValue(context.gcpCloudRunRegion) ||
        hasConfiguredValue(context.gcpRegion);
    case "K8S_NAMESPACE":
      return hasConfiguredValue(context.k8sNamespace);
    default:
      return true;
  }
}

function missingTranslationRequirements(
  requirements: string[],
  context: TranslationContext,
): string[] {
  return requirements.filter((requirement) =>
    !isRequirementMet(requirement, context)
  );
}

function translateRoute(
  name: string,
  target: string,
): RouteTranslationEntry {
  return {
    name,
    target,
    status: "compatible",
    requirements: [],
    notes: [
      "tenant runtime materializes routes through the routing runtime.",
    ],
  };
}

export function buildTranslationReport(
  desiredState: GroupDesiredState,
  context: TranslationContext = {},
): TranslationReport {
  const workloads = Object.entries(desiredState.workloads).map((
    [name, workload],
  ) =>
    translateWorkload(
      name,
      workload.category,
      desiredState.backend,
      workload.spec,
    )
  );
  const routes = Object.entries(desiredState.routes).map(([name, route]) =>
    translateRoute(name, route.target)
  );

  const unsupported: TranslationIssue[] = [
    ...workloads
      .filter((entry) => entry.status === "unsupported")
      .map((entry) => ({
        category: "workload" as const,
        name: entry.name,
        message:
          `${entry.category} is unsupported by the tenant runtime contract`,
      })),
    ...routes
      .filter((entry) => entry.status === "unsupported")
      .map((entry) => ({
        category: "route" as const,
        name: entry.name,
        message:
          `${entry.target} route is unsupported by the Takos routing contract`,
      })),
  ];

  const requirements = uniqueRequirements([
    ...workloads,
    ...routes,
  ]);
  const missingRequirements = missingTranslationRequirements(
    requirements,
    context,
  );

  return {
    supported: unsupported.length === 0 && missingRequirements.length === 0,
    requirements: requirements,
    workloads,
    routes,
    unsupported,
  };
}

export function assertTranslationSupported(
  report: TranslationReport,
  context: TranslationContext = {},
): void {
  const missingRequirements = missingTranslationRequirements(
    report.requirements,
    context,
  );
  if (report.unsupported.length === 0 && missingRequirements.length === 0) {
    return;
  }

  const details = [
    ...missingRequirements.map((entry) => `${entry} is required`),
    ...report.unsupported
      .map((issue) => `${issue.category}:${issue.name}: ${issue.message}`),
  ].join("; ");

  throw new Error(
    `Tenant runtime translation is not supported: ${details}`,
  );
}
