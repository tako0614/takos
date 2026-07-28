import { rpcJson } from "../../lib/rpc.ts";

/**
 * Quick-install a store listing's Capsule into a Space via takos's two-phase
 * git-url install (the same endpoints GitUrlInstallModal uses): plan to pin the
 * commit + plan digest, then apply. Throws on failure (the Store UI surfaces it).
 * Capsules needing input/provider config go through the /new flow instead.
 */
interface PlanResponse {
  readonly expected?: {
    readonly workspaceId: string;
    readonly sourceId?: string;
    readonly capsuleId: string;
    readonly runId: string;
  };
}

export async function installFromStore(
  spaceId: string,
  src: { git: string; ref: string },
): Promise<void> {
  const base = `/api/spaces/${encodeURIComponent(spaceId)}/capsules/git-url`;
  const planRes = await fetch(`${base}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ git_url: src.git, ref: src.ref }),
  });
  const plan = await rpcJson<PlanResponse>(planRes);

  if (!plan.expected) {
    throw new Error("Capsule plan response is missing its exact Run reference");
  }

  const applyRes = await fetch(`${base}/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expected: plan.expected }),
  });
  await rpcJson(applyRes);
}
