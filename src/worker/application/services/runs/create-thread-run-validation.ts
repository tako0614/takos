import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import {
  DEFAULT_MODEL_ID,
  normalizeModelId,
  resolveExecutionModel,
} from "../agent/index.ts";
import type { AiEnv } from "../../../shared/types/env.ts";
const MAX_RUN_NESTING_DEPTH = 5;
import { isValidOpaqueId } from "../../../shared/utils/db-guards.ts";
import {
  getRunHierarchyNode,
  getSpaceModel,
} from "./create-thread-run-store.ts";
import { logWarn } from "../../../shared/utils/logger.ts";

export const createThreadRunValidationDeps = {
  getRunHierarchyNode,
  getSpaceModel,
  isValidOpaqueId,
  logWarn,
  normalizeModelId,
  get defaultModelId() {
    return DEFAULT_MODEL_ID;
  },
};

export async function validateParentRunId(
  db: SqlDatabaseBinding,
  spaceId: string,
  parentRunId: string,
): Promise<string | null> {
  const parent = await createThreadRunValidationDeps.getRunHierarchyNode(
    db,
    parentRunId,
  );

  if (!parent) {
    return "Invalid parent_run_id: run not found";
  }

  if (parent.accountId !== spaceId) {
    return "Invalid parent_run_id: parent run must be in the same workspace";
  }

  const seen = new Set<string>();
  seen.add(parent.id);

  let parentDepth = 1;
  let cursor = parent;
  while (cursor.parentRunId) {
    parentDepth++;
    if (parentDepth > MAX_RUN_NESTING_DEPTH) {
      break;
    }

    if (!createThreadRunValidationDeps.isValidOpaqueId(cursor.parentRunId)) {
      return "Invalid parent_run_id: run hierarchy is broken";
    }

    if (seen.has(cursor.parentRunId)) {
      return "Invalid parent_run_id: run hierarchy cycle detected";
    }
    seen.add(cursor.parentRunId);

    const next = await createThreadRunValidationDeps.getRunHierarchyNode(
      db,
      cursor.parentRunId,
    );

    if (!next) {
      return "Invalid parent_run_id: run hierarchy is broken";
    }
    if (next.accountId !== spaceId) {
      return "Invalid parent_run_id: run hierarchy crosses workspaces";
    }

    cursor = next;
  }

  const newDepth = parentDepth + 1;
  if (newDepth > MAX_RUN_NESTING_DEPTH) {
    return `Run nesting depth exceeded (max: ${MAX_RUN_NESTING_DEPTH})`;
  }

  return null;
}

function validateModel(model: string | undefined): string {
  if (!model) {
    return createThreadRunValidationDeps.defaultModelId;
  }

  const normalized = createThreadRunValidationDeps.normalizeModelId(model);
  // `local-smoke` is an in-process test affordance in the Rust wrapper, not a
  // provider model. Never let a public run request or saved Workspace setting
  // select it; the wrapper also fails closed unless an explicit test-only env
  // switch is present, but the Worker is the model-selection authority.
  if (normalized === "local-smoke") {
    createThreadRunValidationDeps.logWarn(
      "Test-only local-smoke model rejected for a product run",
      { module: "security" },
    );
    return createThreadRunValidationDeps.defaultModelId;
  }
  if (normalized) {
    return normalized;
  }

  if (model.length > 50 || /[<>'";&|]/.test(model)) {
    createThreadRunValidationDeps.logWarn(
      `Suspicious model parameter rejected: ${model.slice(0, 100)}`,
      { module: "security" },
    );
  }

  return createThreadRunValidationDeps.defaultModelId;
}

export async function resolveRunModel(
  db: SqlDatabaseBinding,
  spaceId: string,
  requestedModel: string | undefined,
  env: AiEnv & {
    OIDC_ISSUER_URL?: string;
    OIDC_CLIENT_ID?: string;
    ENCRYPTION_KEY?: string;
    TAKOSUMI_ACCOUNTS_URL?: string;
    TAKOSUMI_ACCOUNTS_INTERNAL_URL?: string;
  } = {},
): Promise<string> {
  const spaceModel = await createThreadRunValidationDeps.getSpaceModel(
    db,
    spaceId,
  );
  const resolvedModel =
    requestedModel ||
    spaceModel?.aiModel ||
    createThreadRunValidationDeps.defaultModelId;
  return resolveExecutionModel(env, validateModel(resolvedModel));
}
