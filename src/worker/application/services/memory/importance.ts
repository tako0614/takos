export const DEFAULT_MEMORY_IMPORTANCE = 0.5;

/** Enforce the public 0..1 memory-importance contract at the service seam. */
export function assertMemoryImportance(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError("memory importance must be between 0 and 1");
  }
  return value;
}
