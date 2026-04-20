import type { ChildProcess } from "node:child_process";

/** Grace period before SIGKILL after sending SIGTERM. */
const GRACEFUL_KILL_TIMEOUT_MS = 5_000;

function killProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) {
    child.kill(signal);
    return;
  }

  if (process.platform === "win32") {
    child.kill(signal);
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

/**
 * Sends SIGTERM to a child process, then SIGKILL after a grace period if still running.
 * Returns the timeout handle so the caller can clear it on normal exit.
 */
export function gracefulKill(
  child: ChildProcess,
): ReturnType<typeof setTimeout> {
  killProcessGroup(child, "SIGTERM");
  return setTimeout(() => {
    const stillRunning = child.exitCode === null && child.signalCode === null;
    if (stillRunning) {
      killProcessGroup(child, "SIGKILL");
    }
  }, GRACEFUL_KILL_TIMEOUT_MS);
}
