/** Validate that a compiler/linter process completed with its normal status. */
export function qualityProcessFailure(
  label: string,
  exitCode: number | null,
  signalCode: NodeJS.Signals | null,
  diagnosticCount: number,
  diagnosticExitCode: number,
  stdout: string,
  stderr: string,
): string | null {
  let reason: string | null = null;
  if (signalCode !== null) {
    reason = `terminated by signal ${signalCode}`;
  } else if (exitCode === 0 && diagnosticCount === 0) {
    reason = null;
  } else if (exitCode === 0) {
    reason = "reported diagnostics but exited successfully";
  } else if (exitCode === diagnosticExitCode && diagnosticCount > 0) {
    // The pinned tsc exits 2 for reported diagnostics; oxlint exits 1.
    // Their exact debt is still decided by the existing ledger below.
    reason = null;
  } else {
    reason = `exited with status ${String(exitCode)}`;
  }

  if (reason === null && stderr.length > 0) {
    reason = "wrote to stderr despite a normal exit";
  }
  if (reason === null) return null;

  return `${label}: child process ${reason}; stdout:\n${stdout}\nstderr:\n${stderr}`;
}
