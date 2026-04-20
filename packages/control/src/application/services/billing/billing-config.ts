/**
 * Billing configuration resolved from environment variables.
 * Single source of truth for "is billing active?" and configurable defaults.
 *
 * When BILLING_ENABLED is not "true", all billing gates become no-ops
 * and no billing-related DB calls are made. This is the default for
 * OSS / self-hosted deployments.
 */

import {
  WEEKLY_RUNTIME_LIMIT_SECONDS,
  WEEKLY_RUNTIME_WINDOW_DAYS,
} from "./billing-types.ts";
import type { MeterType } from "./billing-types.ts";

// ---------------------------------------------------------------------------
// Core toggle
// ---------------------------------------------------------------------------

export function isBillingEnabled(env: { BILLING_ENABLED?: string }): boolean {
  return env.BILLING_ENABLED === "true";
}

// ---------------------------------------------------------------------------
// Runtime config
// ---------------------------------------------------------------------------

export interface BillingConfig {
  enabled: boolean;
  weeklyRuntimeLimitSeconds: number;
  weeklyRuntimeWindowDays: number;
}

export function resolveBillingConfig(env: {
  BILLING_ENABLED?: string;
  BILLING_WEEKLY_RUNTIME_LIMIT_SECONDS?: string;
  BILLING_WEEKLY_RUNTIME_WINDOW_DAYS?: string;
}): BillingConfig {
  return {
    enabled: isBillingEnabled(env),
    weeklyRuntimeLimitSeconds:
      parsePositiveInt(env.BILLING_WEEKLY_RUNTIME_LIMIT_SECONDS) ??
        WEEKLY_RUNTIME_LIMIT_SECONDS,
    weeklyRuntimeWindowDays:
      parsePositiveInt(env.BILLING_WEEKLY_RUNTIME_WINDOW_DAYS) ??
        WEEKLY_RUNTIME_WINDOW_DAYS,
  };
}

// ---------------------------------------------------------------------------
// Custom plan catalog (BILLING_PLANS_JSON)
// ---------------------------------------------------------------------------

export interface BillingPlanConfig {
  plans: Array<{
    id: string;
    name: string;
    displayName: string;
    description: string;
    isDefault: boolean;
  }>;
  quotas: Record<string, Partial<Record<MeterType, number>>>;
  rates: Record<string, Partial<Record<MeterType, number>>>;
}

/**
 * Parse BILLING_PLANS_JSON into a validated plan catalog.
 * Returns null when the env var is unset (use the default catalog).
 * Throws on malformed JSON so misconfigurations surface early.
 */
export function resolveCustomBillingPlans(env: {
  BILLING_PLANS_JSON?: string;
}): BillingPlanConfig | null {
  const raw = env.BILLING_PLANS_JSON?.trim();
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("BILLING_PLANS_JSON is invalid JSON");
  }

  if (!isRecord(parsed)) {
    throw new Error(
      "BILLING_PLANS_JSON must be an object with plans, quotas, and rates",
    );
  }

  const { plans, quotas, rates } = parsed as Record<string, unknown>;

  if (!Array.isArray(plans) || plans.length === 0) {
    throw new Error("BILLING_PLANS_JSON.plans must be a non-empty array");
  }

  for (const [i, plan] of plans.entries()) {
    if (!isRecord(plan)) {
      throw new Error(`BILLING_PLANS_JSON.plans[${i}] must be an object`);
    }
    if (typeof plan.id !== "string" || !plan.id) {
      throw new Error(`BILLING_PLANS_JSON.plans[${i}].id is required`);
    }
    if (typeof plan.name !== "string" || !plan.name) {
      throw new Error(`BILLING_PLANS_JSON.plans[${i}].name is required`);
    }
  }

  if (!isRecord(quotas)) {
    throw new Error("BILLING_PLANS_JSON.quotas must be an object");
  }

  if (!isRecord(rates)) {
    throw new Error("BILLING_PLANS_JSON.rates must be an object");
  }

  return {
    plans: plans.map((p: Record<string, unknown>) => ({
      id: p.id as string,
      name: p.name as string,
      displayName: (p.displayName as string) || (p.name as string),
      description: (p.description as string) || "",
      isDefault: Boolean(p.isDefault),
    })),
    quotas: quotas as Record<string, Partial<Record<MeterType, number>>>,
    rates: rates as Record<string, Partial<Record<MeterType, number>>>,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
