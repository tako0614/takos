/**
 * Shared CLI logging utilities.
 *
 * Warning messages are written to stderr so they remain visible but do not
 * interfere with structured stdout output.
 */

export function logWarning(message: string): void {
  console.error(`[takos-cli warning] ${message}`);
}
