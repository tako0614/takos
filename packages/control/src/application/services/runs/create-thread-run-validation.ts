import type { D1Database } from "../../../shared/types/bindings.ts";
import { DEFAULT_MODEL_ID, normalizeModelId } from "../agent/index.ts";
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
  db: D1Database,
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
  db: D1Database,
  spaceId: string,
  requestedModel: string | undefined,
): Promise<string> {
  const spaceModel = await createThreadRunValidationDeps.getSpaceModel(
    db,
    spaceId,
  );
  const resolvedModel = requestedModel || spaceModel?.aiModel ||
    createThreadRunValidationDeps.defaultModelId;
  return validateModel(resolvedModel);
}
