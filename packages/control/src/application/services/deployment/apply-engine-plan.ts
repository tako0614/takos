import type { Env } from "../../../shared/types/env.ts";
import type { AppManifest } from "../source/app-manifest-types.ts";
import { computeDiff, type DiffResult, type GroupState } from "./diff.ts";
import {
  applyManifestOverrides,
  type GroupDesiredState,
} from "./group-state.ts";
import type {
  TranslationContext,
  TranslationReport,
} from "./translation-report.ts";

export type ApplyEnginePlanGroup = {
  id: string;
  name: string;
  backend: string | null;
  env: string | null;
};

export type ApplyEnginePlannerDeps = {
  compileGroupDesiredState: (
    manifest: AppManifest,
    options: { groupName: string; backend: string; envName: string },
  ) => GroupDesiredState;
  buildTranslationReport: (
    desiredState: GroupDesiredState,
    context: TranslationContext,
  ) => TranslationReport;
  buildTranslationContextFromEnv: (env: Env) => TranslationContext;
};

export type BuildManifestPlanInput<TGroup extends ApplyEnginePlanGroup> = {
  env: Env;
  groupId: string | null;
  group: TGroup | null;
  manifest?: AppManifest;
  opts?: {
    groupName?: string;
    backendName?: string;
    envName?: string;
  };
  loadDesiredManifest: (group: TGroup) => AppManifest | null;
  getCurrentState: (groupId: string) => Promise<GroupState | null>;
};

export type ManifestPlan = {
  effectiveManifest: AppManifest;
  desiredState: GroupDesiredState;
  currentState: GroupState | null;
  diff: DiffResult;
  translationReport: TranslationReport;
};

export async function buildManifestPlan<TGroup extends ApplyEnginePlanGroup>(
  deps: ApplyEnginePlannerDeps,
  input: BuildManifestPlanInput<TGroup>,
): Promise<ManifestPlan> {
  const baseManifest = input.manifest ??
    (input.group ? input.loadDesiredManifest(input.group) : null);
  if (!baseManifest) {
    throw new Error(
      input.groupId
        ? `Group "${input.groupId}" does not have a desired manifest`
        : "manifest is required",
    );
  }

  const envName = input.opts?.envName ?? input.group?.env ?? "default";
  const effectiveManifest = applyManifestOverrides(baseManifest, envName);
  const desiredState = deps.compileGroupDesiredState(effectiveManifest, {
    groupName: input.opts?.groupName ?? input.group?.name ??
      effectiveManifest.name,
    backend: input.opts?.backendName ?? input.group?.backend ??
      "cloudflare",
    envName,
  });
  const currentState = input.groupId
    ? await input.getCurrentState(input.groupId)
    : null;
  const translationContext = deps.buildTranslationContextFromEnv(input.env);
  const translationReport = deps.buildTranslationReport(
    desiredState,
    translationContext,
  );

  return {
    effectiveManifest,
    desiredState,
    currentState,
    diff: computeDiff(desiredState, currentState),
    translationReport,
  };
}
