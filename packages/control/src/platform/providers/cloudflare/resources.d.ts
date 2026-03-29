import type { Env } from '../../../shared/types';
import { CloudflareResourceService, type CloudflareDeletableResourceType, type CloudflareManagedResourceType } from '../../../application/services/cloudflare/resources.ts';
import type { WfpEnv } from '../../../application/services/wfp/index.ts';
export type { CloudflareManagedResourceType, CloudflareDeletableResourceType, };
export { CloudflareResourceService };
export declare function createCloudflareResourceProvider(env: Pick<Env, 'CF_ACCOUNT_ID' | 'CF_API_TOKEN' | 'WFP_DISPATCH_NAMESPACE'> | WfpEnv): CloudflareResourceService;
//# sourceMappingURL=resources.d.ts.map