import {
  createCloudflareWorker,
  type CloudflareWorkerEnv,
} from "@takosjp/takosumi-accounts-worker";

// The Takosumi Accounts plane (OIDC issuer / dashboard API / installations / billing)
// runs in-process inside this unified Takos worker, at the ORIGIN ROOT — there is no
// `/accounts` prefix. `app.takosumi.com` IS the issuer (issuer = https://app.takosumi.com),
// so OIDC discovery + endpoints live at root (`/.well-known/openid-configuration`,
// `/oauth/*`), and the account-plane API lives at `/v1/*`, `/start`, `/__takosumi/*`.
// web.ts delegates exactly these root prefixes here; everything else is the Takos product.
const accountsWorker = createCloudflareWorker();

export type { CloudflareWorkerEnv };

export function handleAccountsPlaneRequest(
  request: Request,
  env: CloudflareWorkerEnv,
): Promise<Response> {
  return accountsWorker.fetch(request, env);
}
