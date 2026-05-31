import type { WorkerBinding } from "../../../platform/backends/cloudflare/wfp.ts";
import type { ReconcileUpdate } from "../common-env/repository.ts";

export type ServiceBindingSpec = WorkerBinding;

export type DesiredStateEnv = Pick<
  import("../../../shared/types/index.ts").Env,
  "DB" | "ENCRYPTION_KEY" | "ADMIN_DOMAIN"
>;

export type ServiceRuntimeLimits = {
  cpu_ms?: number;
  subrequests?: number;
};

export type ServiceRuntimeConfigState = {
  compatibility_date?: string;
  compatibility_flags: string[];
  limits: ServiceRuntimeLimits;
  updated_at: string | null;
};

export type ServiceLocalEnvVarState = {
  name: string;
  value: string;
  secret: boolean;
  updated_at: string;
};

export type ServiceLocalEnvVarSummary = {
  name: string;
  type: "plain_text" | "secret_text";
  value: string;
  updated_at: string;
};

export type ServiceDesiredStateSnapshot = {
  envVars: Record<string, string>;
  envBindings: WorkerBinding[];
  resourceBindings: WorkerBinding[];
  bindings: WorkerBinding[];
  runtimeConfig: ServiceRuntimeConfigState;
  commonEnvUpdates: ReconcileUpdate[];
};

export type ServiceEnvRow = {
  id: string;
  serviceId: string;
  accountId: string;
  name: string;
  valueEncrypted: string;
  isSecret: boolean;
  updatedAt: string;
};

export type ServiceRuntimeRow = {
  compatibilityDate: string | null;
  updatedAt: string;
};

export type ServiceRuntimeFlagRow = {
  flag: string;
};

export type ServiceRuntimeLimitRow = {
  cpuMs: number | null;
  memoryMb: number | null;
  subrequestLimit: number | null;
};

export type ServiceBindingRow = {
  id: string;
  bindingName: string;
  bindingType: string;
  config: string;
  resourceId: string;
  resourceName: string | null;
  resourceType: string;
  resourceStatus: string;
  backendName: string | null;
  backingResourceId: string | null;
  backingResourceName: string | null;
  resourceConfig: string;
};

export type RoutingRow = {
  id: string;
  artifactRef: string | null;
  routingStatus: string;
  routingWeight: number | string;
};

export type CommonEnvValue = {
  value: string;
  isSecret: boolean;
};

export const MASKED_SECRET_VALUE = "********";
