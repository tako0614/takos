import type { ObjectStoreBinding } from "../../../shared/types/bindings.ts";
import { parseWorkflow, type Workflow } from "takos-actions-engine";
import * as gitStore from "../takos-git/index.ts";

export interface WorkflowCandidate {
  path: string;
  workflow: Workflow;
}

export async function parseWorkflowFiles(
  bucket: ObjectStoreBinding,
  commitSha: string,
): Promise<WorkflowCandidate[]> {
  const commit = await gitStore.getCommitData(bucket, commitSha);
  if (!commit) return [];
  const entries = await gitStore.listDirectory(
    bucket,
    commit.tree,
    ".takos/workflows",
  );
  if (!entries) return [];
  const candidates: WorkflowCandidate[] = [];
  for (const entry of entries) {
    if (entry.mode === gitStore.FILE_MODES.DIRECTORY) continue;
    const lowerName = entry.name.toLowerCase();
    if (!lowerName.endsWith(".yml") && !lowerName.endsWith(".yaml")) continue;
    const path = `.takos/workflows/${entry.name}`;
    const blob = await gitStore.getBlobAtPath(bucket, commit.tree, path);
    if (!blob) continue;
    const content = new TextDecoder().decode(blob);
    const { workflow, diagnostics } = parseWorkflow(content);
    if (diagnostics.some((d) => d.severity === "error")) continue;
    candidates.push({ path, workflow });
  }
  return candidates;
}
