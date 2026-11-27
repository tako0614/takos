export interface OrderableFeedItem {
  type: "message" | "run-activity";
  key: string;
  createdAt: number;
  sequence?: number;
}

export function compareFeedItems(
  a: OrderableFeedItem,
  b: OrderableFeedItem,
): number {
  const aTime = Number.isFinite(a.createdAt) ? a.createdAt : 0;
  const bTime = Number.isFinite(b.createdAt) ? b.createdAt : 0;
  if (aTime !== bTime) return aTime - bTime;
  if (a.type === "message" && b.type === "message") {
    const aSeq = typeof a.sequence === "number" && Number.isFinite(a.sequence)
      ? a.sequence
      : null;
    const bSeq = typeof b.sequence === "number" && Number.isFinite(b.sequence)
      ? b.sequence
      : null;
    if (aSeq !== null && bSeq !== null) {
      if (aSeq !== bSeq) return aSeq - bSeq;
    } else if (aSeq !== null) {
      return -1;
    } else if (bSeq !== null) {
      return 1;
    }
  }
  if (a.type === b.type) return a.key.localeCompare(b.key);
  return a.type === "message" ? -1 : 1;
}
