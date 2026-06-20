import {
  type CloudflareWorkerEnv,
  createInProcessDeployControlSeam as createTakosumiInProcessDeployControlSeam,
} from "@takosjp/takosumi-deploy-worker";
import type { DeployControlOperations } from "@takosjp/takosumi-accounts-service";

// The Takosumi deploy-control plane (Installation / Run / Deployment /
// OutputSnapshot ledger + OpenTofu runner) runs in-process inside
// this unified Takos worker. It owns NO public route: web.ts delegates `/v1/*`
// only to the accounts handler, and the accounts facade reaches the
// deploy-control service through the in-process seam injected below
// (`createInProcessDeployControlSeam`). The two GET `/v1/installation-projections/{id}` and
// `/v1/installation-projections/{id}/deployments` collisions that would arise from mounting
// deploy-control publicly are avoided entirely — deploy-control is a private
// backend reached by the accounts facade by design.
//
// The accounts facade calls the embedded service's typed `operations` facade
// directly (the wired OpenTofu controller), so there is no self-issued Bearer
// handshake and no JSON serialize/parse round-trip inside this single worker.
// The shared takosumi seam still exposes HTTP fetch for internal runner and
// route-level tests; the accounts path uses typed operations only. The
// bearer-gated public routes (`authorizeDeployControl`, enabled when
// `TAKOSUMI_DEPLOY_CONTROL_TOKEN` is set) remain for genuine remote callers.
//
// The per-env service cache + Request normalization live once in the shared
// takosumi seam (`createInProcessDeployControlSeam`); this module only adapts it
// to the accounts handler's provider signatures.

/**
 * Single in-process deploy-control seam for the accounts handler's deploy-control
 * facade. Bundles the typed `operations` facade with the same per-env cached
 * service used by the shared takosumi seam so the WeakMap cache and Request
 * normalization are not re-derived per host.
 */
export function createInProcessDeployControlSeam(env: CloudflareWorkerEnv): {
  fetch: typeof fetch;
  operations: () => Promise<DeployControlOperations>;
} {
  const seam = createTakosumiInProcessDeployControlSeam(env);
  return { fetch: seam.fetch, operations: seam.operations };
}
