import {
  WFPService,
  type CloudflareBindingRecord,
  type WfpEnv,
  type WorkerBinding,
  createWfpService,
} from '../../../application/services/wfp/index.ts';

export type {
  WorkerBinding,
  CloudflareBindingRecord,
  WfpEnv,
};
export { WFPService };

export function createOptionalCloudflareWfpProvider(env: WfpEnv): WFPService | null {
  return createWfpService(env);
}
