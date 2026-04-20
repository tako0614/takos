export interface RunNotifierEmitPayload<TData = unknown> {
  runId: string;
  type: string;
  data: TData;
  event_id?: number;
  dedup_key?: string;
}

export function buildRunNotifierEmitPayload<TData>(
  runId: string,
  type: string,
  data: TData,
  eventId?: number | null,
): RunNotifierEmitPayload<TData> {
  if (eventId) {
    return {
      runId,
      type,
      data,
      event_id: eventId,
    };
  }

  return {
    runId,
    type,
    data,
  };
}
