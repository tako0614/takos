/**
 * Routing Phase Configuration
 *
 * Determines the routing phase from environment bindings.
 * Phase controls which data sources (KV, DO, L1 cache) are primary.
 */

import type { RoutingBindings } from './routing-models.ts';

const DEFAULT_PHASE = 1;
const MIN_PHASE = 1;
const MAX_PHASE = 4;

export function getRoutingPhase(env: RoutingBindings): number {
  const raw = env.ROUTING_DO_PHASE;
  if (!raw) return DEFAULT_PHASE;
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_PHASE;
  return Math.min(MAX_PHASE, Math.max(MIN_PHASE, parsed));
}
