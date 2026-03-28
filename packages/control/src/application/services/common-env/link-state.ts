import { BadRequestError } from '@takoserver/common/errors';
import { normalizeEnvName } from './crypto';
import { isReservedSpaceCommonEnvKey } from './crypto';
import type { LinkSource, ServiceLinkRow, SyncState } from './repository';

export interface EffectiveLink {
  envName: string;
  source: LinkSource;
  syncState: SyncState;
  syncReason: string | null;
}

/**
 * Group link rows by normalized env name, picking the effective row per key
 * (manual wins over required). Returns the grouped map of selected rows.
 */
export function groupLinkRowsByEnvName(rows: ServiceLinkRow[]): Map<string, ServiceLinkRow> {
  const grouped = new Map<string, { manual?: ServiceLinkRow; required?: ServiceLinkRow }>();
  for (const row of rows) {
    const key = normalizeEnvName(row.env_name);
    const bucket = grouped.get(key) || {};
    if (row.source === 'manual') bucket.manual = row;
    if (row.source === 'required') bucket.required = row;
    grouped.set(key, bucket);
  }

  const out = new Map<string, ServiceLinkRow>();
  for (const [envName, bucket] of grouped.entries()) {
    const selected = bucket.manual || bucket.required;
    if (selected) out.set(envName, selected);
  }
  return out;
}

export function buildLinkStateByName(rows: ServiceLinkRow[]): Map<string, { syncState: SyncState; syncReason: string | null }> {
  const grouped = groupLinkRowsByEnvName(rows);
  const out = new Map<string, { syncState: SyncState; syncReason: string | null }>();
  for (const [envName, row] of grouped.entries()) {
    out.set(envName, {
      syncState: row.sync_state,
      syncReason: row.sync_reason,
    });
  }
  return out;
}

export function assertSpaceCommonEnvKeyAllowed(name: string): void {
  if (isReservedSpaceCommonEnvKey(name)) {
    throw new BadRequestError(`${name} is reserved as a managed Takos built-in env key`);
  }
}

/** Extract D1 meta.changes from a Drizzle run result */
export function getChanges(result: unknown): number {
  return Number((result as { meta?: { changes?: number } }).meta?.changes || 0);
}

export function getEffectiveLinks(rows: ServiceLinkRow[]): Map<string, EffectiveLink> {
  const grouped = groupLinkRowsByEnvName(rows);
  const out = new Map<string, EffectiveLink>();
  for (const [envName, row] of grouped.entries()) {
    out.set(envName, {
      envName,
      source: row.source,
      syncState: row.sync_state,
      syncReason: row.sync_reason,
    });
  }
  return out;
}
