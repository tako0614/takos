import { rpcJson } from "../../lib/rpc.ts";

/**
 * Quick-install a store listing's Capsule into a Space via takos's two-phase
 * git-url install (the same endpoints GitUrlInstallModal uses): plan to pin the
 * commit + plan digest, then apply. Throws on failure (the Store UI surfaces it).
 * Capsules needing input/provider config go through the /new flow instead.
 */
interface PlanResponse {
  readonly source?: { readonly commit?: string };
  readonly expected?: {
    readonly commit?: string;
    readonly planDigest?: string;
    readonly currentDeploymentId?: string | null;
  };
  readonly planDigest?: string;
  readonly runtime?: { readonly modes?: readonly string[] };
}

export async function installFromStore(
  spaceId: string,
  src: { git: string; ref: string },
): Promise<void> {
  const base = `/api/spaces/${encodeURIComponent(spaceId)}/app-installations/git-url`;
  const planRes = await fetch(`${base}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ git_url: src.git, ref: src.ref }),
  });
  const plan = await rpcJson<PlanResponse>(planRes);

  const sourceCommit = plan.source?.commit;
  const expectedCommit = plan.expected?.commit ?? sourceCommit;
  const planDigest = plan.planDigest ?? plan.expected?.planDigest;
  const mode = plan.runtime?.modes?.[0] ?? "";

  const applyRes = await fetch(`${base}/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      git_url: src.git,
      ref: src.ref,
      ...(mode ? { mode } : {}),
      expected_commit: expectedCommit,
      expected_plan_digest: planDigest,
      cost_ack: true,
    }),
  });
  await rpcJson(applyRes);
}
