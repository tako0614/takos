import {
  createCloudflareWorker,
  type CloudflareWorkerEnv,
} from "@takosjp/takosumi-accounts-worker";
import { createInProcessDeployControlSeam } from "../deploy/mount.ts";
import type { CloudflareWorkerEnv as DeployControlWorkerEnv } from "@takosjp/takosumi-deploy-worker";

// The Takosumi Accounts plane (OIDC issuer / dashboard API / installations / billing)
// runs in-process inside this unified Takos worker, at the ORIGIN ROOT — there is no
// `/accounts` prefix. The configured worker origin is the issuer: hosted Takosumi
// uses `https://app.takosumi.com`, while self-hosted Takos uses its own origin.
// OIDC discovery + endpoints live at root (`/.well-known/openid-configuration`,
// `/oauth/*`), and the account-plane API lives at `/v1/*`, `/__takosumi/*`, and
// `/api/v1/*`.
// web.ts delegates exactly these root prefixes here; everything else is the Takos product.
//
// The Takosumi deploy-control plane runs in-process in this same worker and owns
// no public route. The accounts facade reaches it through the in-process seam
// injected here (`createInProcessDeployControlSeam`): the accounts deploy-control
// facade (plan/apply Run operations / installation reads) calls the embedded
// service's typed `operations` facade directly (no Bearer handshake, no JSON
// round-trip). See deploy/mount.ts.
const accountsWorker = createCloudflareWorker({
  deployControlOperations: (env) =>
    createInProcessDeployControlSeam(
      env as unknown as DeployControlWorkerEnv,
    ).operations(),
});

export type { CloudflareWorkerEnv };

export function handleAccountsPlaneRequest(
  request: Request,
  env: CloudflareWorkerEnv,
): Promise<Response> {
  return accountsWorker.fetch(request, env);
}
