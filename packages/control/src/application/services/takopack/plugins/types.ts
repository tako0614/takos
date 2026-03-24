import type {
  ManifestWorkerConfig,
  TakopackApplyReportEntry,
  TakopackWorkloadObject,
} from '../types';

export interface ResolvedWorkloadBindings {
  d1: string[];
  r2: string[];
  kv: string[];
  vectorize: string[];
}

export interface WorkloadPluginValidationContext {
  files: Map<string, ArrayBuffer>;
  checksums: Map<string, string>;
}

export interface WorkloadPluginApplyContext {
  files: Map<string, ArrayBuffer>;
  checksums: Map<string, string>;
  bindings: ResolvedWorkloadBindings;
}

export interface WorkloadHttpTarget {
  baseUrl: string;
}

export interface WorkloadPluginApplyResult {
  runtime: string;
  worker?: ManifestWorkerConfig;
  httpTarget?: WorkloadHttpTarget;
  report?: TakopackApplyReportEntry;
}

export interface WorkloadPlugin {
  type: string;
  validate(workload: TakopackWorkloadObject, context: WorkloadPluginValidationContext): void;
  apply(workload: TakopackWorkloadObject, context: WorkloadPluginApplyContext): WorkloadPluginApplyResult;
}
