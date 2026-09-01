export interface ExactRunReference {
  workspaceId: string;
  capsuleId: string;
  runId: string;
  sourceId?: string;
}

export interface CapsulePlanResponse {
  source?: {
    id?: string;
    name?: string;
    url?: string;
    defaultRef?: string;
  };
  capsule?: {
    id?: string;
    name?: string;
    status?: string;
  };
  run?: {
    id?: string;
    status?: string;
  };
  expected: ExactRunReference;
}

export type CapsulePlanStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "expired";

export interface CapsulePlanResource {
  address: string;
  type: string;
  actions: string[];
}

export interface CapsulePlanReview {
  id: string;
  workspaceId: string;
  capsuleId: string;
  type: "plan" | "destroy_plan";
  status: CapsulePlanStatus;
  summary: { add: number; change: number; destroy: number };
  planResources: CapsulePlanResource[];
  totalPlanResources: number;
  policyStatus?: "pass" | "warn" | "deny";
  requiresApproval: boolean;
}

export class CapsulePlanTerminalError extends Error {
  constructor(readonly status: "failed" | "cancelled" | "expired") {
    super(`Capsule plan ended with status ${status}`);
    this.name = "CapsulePlanTerminalError";
  }
}

export class CapsulePlanWaitTimeoutError extends Error {
  constructor() {
    super("Capsule plan is still running");
    this.name = "CapsulePlanWaitTimeoutError";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredString(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`Capsule plan response is missing ${field}`);
  }
  return value.trim();
}

function optionalRecord(
  value: unknown,
  field: string,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  const result = record(value);
  if (!result) throw new TypeError(`Capsule plan response has invalid ${field}`);
  return result;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new TypeError(`Capsule plan response has invalid ${field}`);
  }
  return value as number;
}

const PLAN_STATUSES = new Set<CapsulePlanStatus>([
  "queued",
  "running",
  "waiting_approval",
  "succeeded",
  "failed",
  "cancelled",
  "expired",
]);

function parsePlanResource(value: unknown): CapsulePlanResource {
  const resource = record(value);
  if (!resource) {
    throw new TypeError("Capsule plan response has an invalid plan resource");
  }
  if (
    !Array.isArray(resource.actions) ||
    resource.actions.some((action) =>
      typeof action !== "string" || !action.trim()
    )
  ) {
    throw new TypeError("Capsule plan response has invalid resource actions");
  }
  return {
    address: requiredString(resource.address, "planResources.address"),
    type: requiredString(resource.type, "planResources.type"),
    actions: resource.actions.map((action) => (action as string).trim()),
  };
}

export function parseCapsulePlanResponse(
  value: unknown,
  expectedCapsuleId?: string,
): CapsulePlanResponse {
  const candidate = record(value);
  if (!candidate) throw new TypeError("Invalid Capsule plan response");
  const expectedRecord = record(candidate.expected);
  if (!expectedRecord) {
    throw new TypeError(
      "Capsule plan response is missing its exact Run reference",
    );
  }
  const expected: ExactRunReference = {
    workspaceId: requiredString(expectedRecord.workspaceId, "workspaceId"),
    capsuleId: requiredString(expectedRecord.capsuleId, "capsuleId"),
    runId: requiredString(expectedRecord.runId, "runId"),
    ...(typeof expectedRecord.sourceId === "string" &&
        expectedRecord.sourceId.trim()
      ? { sourceId: expectedRecord.sourceId }
      : {}),
  };
  if (expectedCapsuleId && expected.capsuleId !== expectedCapsuleId) {
    throw new TypeError("Capsule plan response targets a different Capsule");
  }

  const source = optionalRecord(candidate.source, "source");
  const capsule = optionalRecord(candidate.capsule, "capsule");
  const run = optionalRecord(candidate.run, "run");
  if (
    capsule?.id !== undefined &&
    requiredString(capsule.id, "capsule.id") !== expected.capsuleId
  ) {
    throw new TypeError("Capsule plan response has conflicting Capsule ids");
  }
  if (
    run?.id !== undefined &&
    requiredString(run.id, "run.id") !== expected.runId
  ) {
    throw new TypeError("Capsule plan response has conflicting Run ids");
  }
  if (
    source?.id !== undefined && expected.sourceId &&
    requiredString(source.id, "source.id") !== expected.sourceId
  ) {
    throw new TypeError("Capsule plan response has conflicting Source ids");
  }

  return {
    ...candidate,
    expected,
  } as unknown as CapsulePlanResponse;
}

export function parseCapsulePlanReviewResponse(
  value: unknown,
  expected: ExactRunReference,
): CapsulePlanReview {
  const candidate = record(value);
  const run = record(candidate?.run);
  if (!run) throw new TypeError("Capsule plan status response is missing run");
  const id = requiredString(run.id, "run.id");
  const workspaceId = requiredString(run.workspaceId, "run.workspaceId");
  const capsuleId = requiredString(run.capsuleId, "run.capsuleId");
  if (id !== expected.runId) {
    throw new TypeError("Capsule plan status returned a different Run");
  }
  if (workspaceId !== expected.workspaceId) {
    throw new TypeError("Capsule plan status targets a different Workspace");
  }
  if (capsuleId !== expected.capsuleId) {
    throw new TypeError("Capsule plan status targets a different Capsule");
  }
  const type = requiredString(run.type, "run.type");
  if (type !== "plan" && type !== "destroy_plan") {
    throw new TypeError("Capsule plan status returned a non-plan Run");
  }
  const status = requiredString(run.status, "run.status") as CapsulePlanStatus;
  if (!PLAN_STATUSES.has(status)) {
    throw new TypeError("Capsule plan status is unknown");
  }
  const summaryRecord = optionalRecord(run.summary, "run.summary");
  const summary = {
    add: summaryRecord?.add === undefined
      ? 0
      : nonNegativeInteger(summaryRecord.add, "run.summary.add"),
    change: summaryRecord?.change === undefined
      ? 0
      : nonNegativeInteger(summaryRecord.change, "run.summary.change"),
    destroy: summaryRecord?.destroy === undefined
      ? 0
      : nonNegativeInteger(summaryRecord.destroy, "run.summary.destroy"),
  };
  const rawResources = run.planResources;
  if (rawResources !== undefined && !Array.isArray(rawResources)) {
    throw new TypeError("Capsule plan response has invalid planResources");
  }
  const resources = (rawResources ?? []) as unknown[];
  const planResources = resources.slice(0, 50).map(parsePlanResource);
  const rawPolicyStatus = run.policyStatus;
  const policyStatus = rawPolicyStatus === undefined
    ? undefined
    : requiredString(rawPolicyStatus, "run.policyStatus");
  if (
    policyStatus !== undefined &&
    policyStatus !== "pass" &&
    policyStatus !== "warn" &&
    policyStatus !== "deny"
  ) {
    throw new TypeError("Capsule plan response has invalid policyStatus");
  }
  return {
    id,
    workspaceId,
    capsuleId,
    type,
    status,
    summary,
    planResources,
    totalPlanResources: resources.length,
    ...(policyStatus ? { policyStatus } : {}),
    requiresApproval:
      status === "waiting_approval" || run.requiresApproval === true,
  };
}

export async function waitForCapsulePlanReview(
  load: () => Promise<unknown>,
  expected: ExactRunReference,
  options: {
    maxAttempts?: number;
    pollIntervalMs?: number;
    sleep?: (milliseconds: number) => Promise<void>;
    shouldContinue?: () => boolean;
  } = {},
): Promise<CapsulePlanReview> {
  const maxAttempts = options.maxAttempts ?? 120;
  const pollIntervalMs = options.pollIntervalMs ?? 1_500;
  const sleep = options.sleep ?? ((milliseconds: number) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)));
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (options.shouldContinue?.() === false) {
      throw new DOMException("Capsule plan wait cancelled", "AbortError");
    }
    const review = parseCapsulePlanReviewResponse(await load(), expected);
    if (options.shouldContinue?.() === false) {
      throw new DOMException("Capsule plan wait cancelled", "AbortError");
    }
    if (review.status === "succeeded" || review.status === "waiting_approval") {
      return review;
    }
    if (
      review.status === "failed" ||
      review.status === "cancelled" ||
      review.status === "expired"
    ) {
      throw new CapsulePlanTerminalError(review.status);
    }
    if (attempt + 1 < maxAttempts) await sleep(pollIntervalMs);
  }
  throw new CapsulePlanWaitTimeoutError();
}

export function parseCapsuleApplyResponse(
  value: unknown,
  expected: ExactRunReference,
): { runId: string; status: CapsulePlanStatus } {
  const candidate = record(value);
  const run = record(candidate?.run);
  if (!run) throw new TypeError("Capsule apply response is missing run");
  const runId = requiredString(run.id, "run.id");
  const workspaceId = requiredString(run.workspaceId, "run.workspaceId");
  if (workspaceId !== expected.workspaceId) {
    throw new TypeError("Capsule apply response targets a different Workspace");
  }
  const type = requiredString(run.type, "run.type");
  if (type !== "apply" && type !== "destroy_apply") {
    throw new TypeError("Capsule apply response returned a non-apply Run");
  }
  const status = requiredString(run.status, "run.status") as CapsulePlanStatus;
  if (!PLAN_STATUSES.has(status)) {
    throw new TypeError("Capsule apply response has unknown status");
  }
  const capsule = optionalRecord(candidate?.capsule, "capsule");
  if (
    capsule?.id !== undefined &&
    requiredString(capsule.id, "capsule.id") !== expected.capsuleId
  ) {
    throw new TypeError("Capsule apply response targets a different Capsule");
  }
  return { runId, status };
}

export async function completeCapsuleApply(
  onApplied: ((spaceId: string) => void | Promise<void>) | undefined,
  finishClose: () => void,
  spaceId: string,
): Promise<unknown | null> {
  let refreshError: unknown | null = null;
  try {
    await onApplied?.(spaceId);
  } catch (error) {
    refreshError = error;
  }
  finishClose();
  return refreshError;
}
