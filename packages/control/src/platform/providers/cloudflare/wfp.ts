import {
  WFPService,
  type CloudflareBindingRecord,
  type WfpEnv,
  type WorkerBinding,
  createWfpService,
} from '../../../application/services/wfp';

export type {
  WorkerBinding,
  CloudflareBindingRecord,
  WfpEnv,
};
export { WFPService };

export function createCloudflareWfpProvider(env: WfpEnv): WFPService {
  return new WFPService(env);
}

export function createOptionalCloudflareWfpProvider(env: WfpEnv): WFPService | null {
  return createWfpService(env);
}
