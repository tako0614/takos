import {
  type CloudflareBindingRecord,
  createWfpService,
  type WfpEnv,
  WFPService,
  type WorkerBinding,
} from "../../../application/services/wfp/index.ts";

export type { CloudflareBindingRecord, WfpEnv, WorkerBinding };
export { WFPService };

export function createOptionalCloudflareWfpBackend(
  env: WfpEnv,
): WFPService | null {
  return createWfpService(env);
}
