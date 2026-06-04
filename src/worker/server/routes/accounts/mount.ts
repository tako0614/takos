import {
  createCloudflareWorker,
  type CloudflareWorkerEnv,
} from "@takosjp/takosumi-accounts-worker";
import { createInProcessDeployControlFetch } from "../deploy/mount.ts";
import type { CloudflareWorkerEnv as DeployControlWorkerEnv } from "@takosjp/takosumi-deploy-worker";

// The Takosumi Accounts plane (OIDC issuer / dashboard API / installations / billing)
// runs in-process inside this unified Takos worker, at the ORIGIN ROOT — there is no
// `/accounts` prefix. `app.takosumi.com` IS the issuer (issuer = https://app.takosumi.com),
// so OIDC discovery + endpoints live at root (`/.well-known/openid-configuration`,
// `/oauth/*`), and the account-plane API lives at `/v1/*`, `/start`, `/__takosumi/*`.
// web.ts delegates exactly these root prefixes here; everything else is the Takos product.
//
// The Takosumi deploy-control plane runs in-process in this same worker and owns
// no public route. The accounts facade reaches it through the in-process seam
// injected here (`createInProcessDeployControlFetch`): the accounts deploy-control
// proxy (plan-runs / apply-runs / installation reads) calls the embedded service's
// typed `operations` facade directly (no Bearer handshake, no JSON round-trip),
// with the HTTP `fetch` dispatch kept as a fallback transport. See deploy/mount.ts.
const accountsWorker = createCloudflareWorker({
  deployControlFetch: (env) =>
    createInProcessDeployControlFetch(env as unknown as DeployControlWorkerEnv)
      .fetch,
  deployControlOperations: (env) =>
    createInProcessDeployControlFetch(env as unknown as DeployControlWorkerEnv)
      .operations(),
});

export type { CloudflareWorkerEnv };

export function handleAccountsPlaneRequest(
  request: Request,
  env: CloudflareWorkerEnv,
): Promise<Response> {
  return accountsWorker.fetch(request, env);
}
