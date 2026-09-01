import type { RoutingRecord } from "../application/services/routing/routing-models.ts";

export function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase();
}

export function cloneRecord(record: RoutingRecord | null): RoutingRecord | null {
  return record ? JSON.parse(JSON.stringify(record)) as RoutingRecord : null;
}
