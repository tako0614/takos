import type { Env } from "../../../shared/types/index.ts";
import {
  type CloudflareDeletableResourceType,
  type CloudflareManagedResourceType,
  CloudflareResourceService,
} from "../../../application/services/cloudflare/resources.ts";
import type { WfpEnv } from "../../../application/services/wfp/index.ts";

export type { CloudflareDeletableResourceType, CloudflareManagedResourceType };
export { CloudflareResourceService };

export function createCloudflareResourceBackend(
  env:
    | Pick<Env, "CF_ACCOUNT_ID" | "CF_API_TOKEN" | "WFP_DISPATCH_NAMESPACE">
    | WfpEnv,
): CloudflareResourceService {
  return new CloudflareResourceService(env);
}
