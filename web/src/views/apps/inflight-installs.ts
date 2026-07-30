/**
 * In-flight control-plane Capsules for the AppsPage coherence section.
 *
 * AppsPage reads deployed UI surfaces. This fetches the Takos product facade for
 * the current Space and surfaces Capsules that are not yet finished/active.
 * It is deliberately FAIL-SOFT and self-contained: it never imports the
 * Takosumi dashboard client, so a missing account-plane session or any error
 * just hides the section instead of hijacking the product page.
 */
import { type Accessor, createResource } from "solid-js";

export interface CapsuleServiceSummary {
  readonly id: string;
  readonly capability: string;
  readonly status: string;
  readonly endpoint: string | null;
  readonly secret_configured: boolean;
  readonly token_expires_at: string | null;
}

export interface WorkspaceCapsule {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly freshness: string | null;
  readonly environment: string;
  readonly sourceUrl: string | null;
  readonly sourceRef: string | null;
  readonly sourceCommit: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly services: readonly CapsuleServiceSummary[];
}

export type InflightCapsule = Pick<
  WorkspaceCapsule,
  "id" | "name" | "status" | "environment"
>;

/** Statuses worth surfacing as "in flight / needs attention" (not active). */
const INFLIGHT_STATUSES = new Set([
  "pending",
  "queued",
  "installing",
  "planning",
  "applying",
  "in_progress",
  "stale",
  "error",
  "failed",
]);

const ACTIVE_STATUSES = new Set(["active", "deployed", "ready"]);

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

function readNestedString(
  record: Record<string, unknown>,
  path: readonly string[],
): string | null {
  let current: unknown = record;
  for (const segment of path) {
    const parent = readRecord(current);
    if (!parent) return null;
    current = parent[segment];
  }
  return readString(current);
}

function sourceRepoName(sourceUrl: string | null): string | null {
  if (!sourceUrl) return null;
  try {
    const url = new URL(sourceUrl);
    const parts = url.pathname
      .replace(/\.git$/i, "")
      .split("/")
      .filter(Boolean);
    return parts.at(-1) ?? url.hostname;
  } catch {
    const parts = sourceUrl
      .replace(/\.git$/i, "")
      .split("/")
      .filter(Boolean);
    return parts.at(-1) ?? null;
  }
}

function capsuleName(row: Record<string, unknown>): string | null {
  const sourceUrl = readNestedString(row, ["source", "url"]);
  return (
    readString(row.name) ??
    readString(row.app_id) ??
    sourceRepoName(sourceUrl)
  );
}

function parseService(value: unknown): CapsuleServiceSummary | null {
  const record = readRecord(value);
  if (!record) return null;
  const id = readString(record.id) ?? readString(record.name);
  if (!id) return null;
  return {
    id,
    capability: readString(record.capability) ?? "unknown",
    status: readString(record.status) ?? "unknown",
    endpoint: readString(record.endpoint),
    secret_configured: readBoolean(record.secret_configured),
    token_expires_at: readString(record.token_expires_at),
  };
}

function presentedStatus(status: string, freshness: string | null): string {
  const normalized = status.toLowerCase();
  if (freshness === "stale" && ACTIVE_STATUSES.has(normalized)) return "stale";
  return status;
}

export function parseCapsulesResponse(
  body: unknown,
): readonly WorkspaceCapsule[] {
  const record = readRecord(body);
  const rows = Array.isArray(record?.capsules) ? record.capsules : [];
  const out: WorkspaceCapsule[] = [];
  for (const row of rows) {
    const item = readRecord(row);
    if (!item) continue;
    const id = readString(item.capsule_id);
    const name = capsuleName(item);
    const rawStatus = readString(item.status) ?? "unknown";
    const freshness = readString(item.freshness);
    if (!id || !name || !rawStatus) continue;
    const sourceUrl = readNestedString(item, ["source", "url"]);
    const services = Array.isArray(item.services)
      ? item.services
          .map(parseService)
          .filter(
            (service): service is CapsuleServiceSummary => service !== null,
          )
      : [];
    out.push({
      id,
      name,
      status: presentedStatus(rawStatus, freshness),
      freshness,
      environment: readString(item.environment) ?? "production",
      sourceUrl,
      sourceRef: readNestedString(item, ["source", "ref"]),
      sourceCommit: readString(item.source_commit),
      createdAt: readString(item.created_at),
      updatedAt: readString(item.updated_at),
      services,
    });
  }
  return out;
}

export function isInflightCapsule(
  capsule: Pick<WorkspaceCapsule, "status">,
): boolean {
  return INFLIGHT_STATUSES.has(capsule.status.toLowerCase());
}

async function fetchCapsules(
  spaceId: string,
): Promise<readonly WorkspaceCapsule[]> {
  if (!spaceId) return [];
  let res: Response;
  try {
    res = await fetch(
      `/api/spaces/${encodeURIComponent(spaceId)}/capsules`,
      { headers: { accept: "application/json" }, credentials: "include" },
    );
  } catch {
    return []; // network / offline: hide the section, never throw.
  }
  // No account-plane session (401), no config (503), or any non-2xx: fail soft.
  if (!res.ok) return [];
  return parseCapsulesResponse(
    await res.json().catch(() => undefined),
  );
}

export function useWorkspaceCapsules(spaceId: Accessor<string | null>): {
  readonly capsules: Accessor<readonly WorkspaceCapsule[]>;
  readonly loading: Accessor<boolean>;
  /** Re-fetch Capsules while a Run is in flight. */
  readonly refetch: () => void;
} {
  const [resource, { refetch }] = createResource(
    () => spaceId() ?? "",
    fetchCapsules,
  );
  return {
    capsules: () => resource() ?? [],
    loading: () => resource.loading,
    refetch: () => void refetch(),
  };
}

/** Reactive in-flight Capsules for the AppsPage section. */
export function useInflightCapsules(spaceId: Accessor<string | null>): {
  readonly capsules: Accessor<readonly InflightCapsule[]>;
  readonly loading: Accessor<boolean>;
} {
  const [resource] = createResource(
    () => spaceId() ?? "",
    async (id) =>
      (await fetchCapsules(id))
        .filter(isInflightCapsule)
        .map((capsule) => ({
          id: capsule.id,
          name: capsule.name,
          status: capsule.status,
          environment: capsule.environment,
        })),
  );
  return {
    capsules: () => resource() ?? [],
    loading: () => resource.loading,
  };
}
