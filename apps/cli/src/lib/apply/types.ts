/**
 * Shared CLI-side type definitions for apply / deployment results.
 *
 * These mirror the API response shapes returned by the backend
 * (`packages/control` / Phase 3) and are used by the CLI commands
 * that POST to `/groups/apply`, `/app-deployments`, `/groups/uninstall`,
 * and `/groups/:id/rollback` endpoints.
 *
 * Defining the types here keeps the CLI free of any dependency on the
 * legacy `lib/state/diff.ts` and `lib/apply/coordinator.ts` modules,
 * which were tied to the pre-Phase 1 envelope manifest schema.
 */

export type DiffAction = "create" | "update" | "delete" | "unchanged";

export interface DiffEntry {
  name: string;
  category: "resource" | "worker" | "container" | "service" | "route";
  action: DiffAction;
  type?: string;
  reason?: string;
}

export interface DiffSummary {
  create: number;
  update: number;
  delete: number;
  unchanged: number;
}

export interface DiffResult {
  entries: DiffEntry[];
  hasChanges: boolean;
  summary: DiffSummary;
}

export interface ApplyEntryResult {
  name: string;
  category: string;
  action: string;
  status: "success" | "failed";
  error?: string;
}

export interface ApplyResult {
  applied: ApplyEntryResult[];
  skipped: string[];
}
