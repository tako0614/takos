/**
 * Historical tool-catalog policy tiers.
 *
 * These values classify old tool metadata only. They are not Takos Workspace
 * roles, cannot represent membership, and never grant Workspace authority.
 * Production creates an `owner` tier only after the active Principal owner
 * proof succeeds; the other literals remain solely to read existing metadata.
 */
export type LegacyToolPolicyTier =
  | "owner"
  | "admin"
  | "editor"
  | "viewer";

export const ALL_LEGACY_TOOL_POLICY_TIERS: LegacyToolPolicyTier[] = [
  "owner",
  "admin",
  "editor",
  "viewer",
];

export const LEGACY_ADMIN_TOOL_POLICY_TIERS: LegacyToolPolicyTier[] = [
  "owner",
  "admin",
];

export const LEGACY_MUTATING_TOOL_POLICY_TIERS: LegacyToolPolicyTier[] = [
  "owner",
  "admin",
  "editor",
];
