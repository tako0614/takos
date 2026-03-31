// Shared constants and utilities used by both queue and cron handlers.
import { validateRunnerEnv, createEnvGuard } from '../../shared/utils/validate-env.ts';

export const STALE_WORKER_THRESHOLD_MS = 5 * 60 * 1000; // 5 min — matches 60s heartbeat x 5 missed beats

// Cached environment validation guard.
export const envGuard = createEnvGuard(validateRunnerEnv);
