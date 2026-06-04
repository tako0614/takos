import {
  type CloudflareWorkerEnv,
  createDeployControlService,
} from "@takosjp/takosumi-deploy-worker";
import type { CreatedTakosumiService } from "../../../../../../takosumi/src/service/bootstrap.ts";

// The Takosumi deploy-control plane (Installation / PlanRun / ApplyRun /
// Deployment / DeploymentOutput ledger + OpenTofu runner) runs in-process inside
// this unified Takos worker. It owns NO public route: web.ts delegates `/v1/*`
// only to the accounts handler, and the accounts facade reaches the
// deploy-control service through the in-process fetch seam injected below
// (accounts `deployControl.fetch`). The two GET `/v1/installations/{id}` and
// `/v1/installations/{id}/deployments` collisions that would arise from mounting
// deploy-control publicly are avoided entirely — deploy-control is a private
// backend of the accounts proxy by design.
//
// The deploy-control routes are bearer-gated (`authorizeDeployControl`): the
// embedded service enables them only when `TAKOSUMI_DEPLOY_CONTROL_TOKEN` is set,
// and the accounts proxy sends the same secret as `Authorization: Bearer`. In a
// single worker this is an internal handshake.

const services = new WeakMap<
  CloudflareWorkerEnv,
  Promise<CreatedTakosumiService>
>();

function deployControlService(
  env: CloudflareWorkerEnv,
): Promise<CreatedTakosumiService> {
  let service = services.get(env);
  if (!service) {
    service = createDeployControlService(env);
    services.set(env, service);
  }
  return service;
}

/**
 * In-process deploy-control transport for the accounts handler's deploy-control
 * proxy seam. The accounts proxy calls this as `fetch(new URL(path, baseUrl),
 * init)`; we normalize that into a `Request` and dispatch it straight into the
 * embedded deploy-control service's Hono app (`service.app.fetch`), reusing the
 * exact route / auth / validation surface the proxy was written against. The
 * synthetic base host is never dialed.
 */
export function deployControlFetch(env: CloudflareWorkerEnv): typeof fetch {
  const inProcessFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const service = await deployControlService(env);
    const request = input instanceof Request && init === undefined
      ? input
      : new Request(input as RequestInfo | URL, init);
    return await service.app.fetch(request);
  };
  return inProcessFetch as typeof fetch;
}
