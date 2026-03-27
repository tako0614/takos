export interface StartJobRequest {
  space_id?: string;
  repoId: string;
  ref: string;
  sha: string;
  workflowPath: string;
  jobName: string;
  steps: Array<{
    name?: string;
    run?: string;
    uses?: string;
    with?: Record<string, unknown>;
    env?: Record<string, string>;
    if?: string;
    'continue-on-error'?: boolean;
    'timeout-minutes'?: number;
  }>;
  env?: Record<string, string>;
  secrets?: Record<string, string>;
}
