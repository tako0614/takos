import type { Env } from "../../../shared/types/env.ts";
import type { AppManifest } from "../source/app-manifest-types.ts";
import { computeDiff, type DiffResult, type GroupState } from "./diff.ts";
import type { GroupDesiredState } from "./group-state.ts";
import type { TranslationReport } from "./translation-report.ts";

export type ApplyEnginePlanGroup = {
  id: string;
  name: string;
  provider: string | null;
  env: string | null;
};

export type ApplyEnginePlannerDeps = {
  compileGroupDesiredState: (
    manifest: AppManifest,
    options: { groupName: string; provider: string; envName: string },
  ) => GroupDesiredState;
  buildTranslationReport: (
    desiredState: GroupDesiredState,
    context: { ociOrchestratorUrl: string | undefined },
  ) => TranslationReport;
  assertTranslationSupported: (
    report: TranslationReport,
    context: { ociOrchestratorUrl: string | undefined },
  ) => void;
};

export type BuildManifestPlanInput<TGroup extends ApplyEnginePlanGroup> = {
  env: Env;
  groupId: string | null;
  group: TGroup | null;
  manifest?: AppManifest;
  opts?: {
    groupName?: string;
    providerName?: string;
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
  const effectiveManifest = input.manifest ??
    (input.group ? input.loadDesiredManifest(input.group) : null);
  if (!effectiveManifest) {
    throw new Error(
      input.groupId
        ? `Group "${input.groupId}" does not have a desired manifest`
        : "manifest is required",
    );
  }

  const desiredState = deps.compileGroupDesiredState(effectiveManifest, {
    groupName: input.opts?.groupName ?? input.group?.name ??
      effectiveManifest.name,
    provider: input.opts?.providerName ?? input.group?.provider ??
      "cloudflare",
    envName: input.opts?.envName ?? input.group?.env ?? "default",
  });
  const currentState = input.groupId
    ? await input.getCurrentState(input.groupId)
    : null;
  const translationContext = {
    ociOrchestratorUrl: input.env.OCI_ORCHESTRATOR_URL,
  };
  const translationReport = deps.buildTranslationReport(
    desiredState,
    translationContext,
  );
  deps.assertTranslationSupported(translationReport, translationContext);

  return {
    effectiveManifest,
    desiredState,
    currentState,
    diff: computeDiff(desiredState, currentState),
    translationReport,
  };
}
