import {
  createCloudflareWorker,
  type CloudflareWorkerEnv,
} from "@takosjp/takosumi-accounts-worker";
import { deployControlFetch } from "../deploy/mount.ts";
import type { CloudflareWorkerEnv as DeployControlWorkerEnv } from "@takosjp/takosumi-deploy-worker";

// The Takosumi Accounts plane (OIDC issuer / dashboard API / installations / billing)
// runs in-process inside this unified Takos worker, at the ORIGIN ROOT — there is no
// `/accounts` prefix. `app.takosumi.com` IS the issuer (issuer = https://app.takosumi.com),
// so OIDC discovery + endpoints live at root (`/.well-known/openid-configuration`,
// `/oauth/*`), and the account-plane API lives at `/v1/*`, `/start`, `/__takosumi/*`.
// web.ts delegates exactly these root prefixes here; everything else is the Takos product.
//
// The Takosumi deploy-control plane runs in-process in this same worker and owns
// no public route. The accounts facade reaches it through the in-process fetch
// seam injected here (`deployControlFetch`): the accounts deploy-control proxy
// (plan-runs / apply-runs / installation reads) dispatches straight into the
// embedded deploy-control Hono app instead of an edge URL. See deploy/mount.ts.
const accountsWorker = createCloudflareWorker({
  deployControlFetch: (env) =>
    deployControlFetch(env as unknown as DeployControlWorkerEnv),
});

export type { CloudflareWorkerEnv };

export function handleAccountsPlaneRequest(
  request: Request,
  env: CloudflareWorkerEnv,
): Promise<Response> {
  return accountsWorker.fetch(request, env);
}
