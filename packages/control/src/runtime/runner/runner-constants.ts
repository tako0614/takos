// Shared constants and utilities used by both queue and cron handlers.
import { validateRunnerEnv, createEnvGuard } from '../../shared/utils/validate-env.ts';

// 5 min stale threshold. The rust-agent emits a heartbeat every 15 s
// (apps/rust-agent/src/main.rs), so this allows ~20 missed beats before a run
// is reclaimed. Don't drop below the actual heartbeat interval × 5.
export const STALE_WORKER_THRESHOLD_MS = 5 * 60 * 1000;

// Cached environment validation guard.
export const envGuard = createEnvGuard(validateRunnerEnv);
