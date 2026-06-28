/**
 * In-flight control-plane installs for the AppsPage coherence section.
 *
 * AppsPage reads `publications` (deployed UI surfaces). But the rebuilt admin
 * `/new` flow installs into the takosumi CONTROL plane (a separate
 * Installation/Run ledger), so a just-started Git-URL / catalog install does
 * not appear here — "what did I just install?" was unanswerable on one surface.
 *
 * This fetches the control-plane Installations for the dashboard's currently
 * selected Space (the `tg_apps_space_id` the admin `/new` writes, via
 * `@takosumi/dashboard`'s shared space-state) and surfaces the ones that are
 * NOT yet a finished/active deployment — pending / setting-up / error / stale.
 * It is deliberately FAIL-SOFT and self-contained: it never imports the
 * dashboard control-api client (whose 401 handler hard-redirects to /sign-in),
 * so a missing account-plane session or any error just hides the section
 * instead of hijacking the product page.
 */
import { type Accessor, createResource } from "solid-js";
import { currentWorkspaceId } from "@takosumi/dashboard/lib/workspace-state.ts";

export interface InflightInstall {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly environment: string;
}

/** Statuses worth surfacing as "in flight / needs attention" (not active). */
const INFLIGHT_STATUSES = new Set([
  "pending",
  "installing",
  "stale",
  "error",
]);

async function fetchInflightInstalls(
  spaceId: string,
): Promise<readonly InflightInstall[]> {
  if (!spaceId) return [];
  let res: Response;
  try {
    res = await fetch(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/installations`,
      { headers: { accept: "application/json" }, credentials: "include" },
    );
  } catch {
    return []; // network / offline — hide the section, never throw.
  }
  // No account-plane session (401) or any non-2xx: fail soft, do NOT redirect.
  if (!res.ok) return [];
  const body = (await res.json().catch(() => undefined)) as
    | { installations?: ReadonlyArray<Record<string, unknown>> }
    | undefined;
  const rows = body?.installations ?? [];
  const out: InflightInstall[] = [];
  for (const row of rows) {
    const id = typeof row.id === "string" ? row.id : undefined;
    const name = typeof row.name === "string" ? row.name : undefined;
    const status = typeof row.status === "string" ? row.status : undefined;
    const freshness =
      typeof row.freshness === "string" ? row.freshness : undefined;
    if (!id || !name || !status) continue;
    // Fold read-time freshness into the presented status (matches the dashboard).
    const presented =
      freshness === "stale" && status === "active" ? "stale" : status;
    if (!INFLIGHT_STATUSES.has(presented)) continue;
    out.push({
      id,
      name,
      status: presented,
      environment:
        typeof row.environment === "string" ? row.environment : "production",
    });
  }
  return out;
}

/**
 * Reactive in-flight installs for the AppsPage section. Keyed on the shared
 * dashboard workspace-state so it tracks the Workspace the admin `/new` installs into.
 */
export function useInflightInstalls(): {
  readonly installs: Accessor<readonly InflightInstall[]>;
  readonly loading: Accessor<boolean>;
} {
  const [resource] = createResource(
    () => currentWorkspaceId(),
    fetchInflightInstalls,
  );
  return {
    installs: () => resource() ?? [],
    loading: () => resource.loading,
  };
}
