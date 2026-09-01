export interface MemoryImportanceStars {
  filled: number;
  empty: number;
}

/**
 * Render defensively around legacy or corrupt rows while the write boundary
 * rejects all new values outside the public 0..1 contract.
 */
export function getMemoryImportanceStars(
  importance: number,
): MemoryImportanceStars {
  const finite = Number.isFinite(importance) ? importance : 0;
  const normalized = Math.min(1, Math.max(0, finite));
  const filled = Math.round(normalized * 5);
  return { filled, empty: 5 - filled };
}
