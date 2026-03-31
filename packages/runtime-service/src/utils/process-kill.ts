import type { ChildProcess } from 'node:child_process';

/** Grace period before SIGKILL after sending SIGTERM. */
const GRACEFUL_KILL_TIMEOUT_MS = 5_000;

/**
 * Sends SIGTERM to a child process, then SIGKILL after a grace period if still running.
 * Returns the timeout handle so the caller can clear it on normal exit.
 */
export function gracefulKill(child: ChildProcess): ReturnType<typeof setTimeout> {
  child.kill('SIGTERM');
  return setTimeout(() => {
    const stillRunning = child.exitCode === null && child.signalCode === null;
    if (stillRunning) {
      child.kill('SIGKILL');
    }
  }, GRACEFUL_KILL_TIMEOUT_MS);
}
