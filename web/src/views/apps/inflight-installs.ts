/**
 * In-flight control-plane Capsules for the AppsPage coherence section.
 *
 * AppsPage reads deployed UI surfaces. This fetches the Takos product facade for
 * the current Space and surfaces Capsules that are not yet finished/active.
 * It is self-contained and never imports the Takosumi dashboard client. Load
 * failures stay non-blocking, but are returned to the Apps page so it does not
 * misrepresent an unknown inventory as an empty Workspace.
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
  "uninstalling",
]);

const PENDING_STATUSES = new Set([
  "pending",
  "queued",
  "installing",
  "planning",
  "applying",
  "in_progress",
  "uninstalling",
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
  if (!record || !Array.isArray(record.capsules)) {
    throw new TypeError("Invalid Capsule inventory response");
  }
  const rows = record.capsules;
  const out: WorkspaceCapsule[] = [];
  for (const row of rows) {
    const item = readRecord(row);
    if (!item) throw new TypeError("Invalid Capsule inventory record");
    const id = readString(item.capsule_id);
    const name = capsuleName(item);
    const rawStatus = readString(item.status) ?? "unknown";
    const freshness = readString(item.freshness);
    if (!id || !name || !rawStatus) {
      throw new TypeError("Invalid Capsule inventory record");
    }
    const sourceUrl = readNestedString(item, ["source", "url"]);
    if (item.services !== undefined && !Array.isArray(item.services)) {
      throw new TypeError("Invalid Capsule services response");
    }
    const services = Array.isArray(item.services)
      ? item.services.map((service) => {
          const parsed = parseService(service);
          if (!parsed) throw new TypeError("Invalid Capsule service record");
          return parsed;
        })
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

export function isPendingCapsule(
  capsule: Pick<WorkspaceCapsule, "status">,
): boolean {
  return PENDING_STATUSES.has(capsule.status.toLowerCase());
}

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export async function loadWorkspaceCapsules(
  spaceId: string,
  fetchImpl: FetchLike = fetch,
): Promise<readonly WorkspaceCapsule[]> {
  if (!spaceId) return [];
  const res = await fetchImpl(
    `/api/spaces/${encodeURIComponent(spaceId)}/capsules`,
    { headers: { accept: "application/json" }, credentials: "include" },
  );
  const body = await res.json().catch(() => undefined);
  if (!res.ok) {
    const record = readRecord(body);
    const error = readRecord(record?.error);
    throw new Error(
      readString(error?.message) ??
        readString(record?.error) ??
        `Capsule inventory request failed (${res.status})`,
    );
  }
  return parseCapsulesResponse(body);
}

export function useWorkspaceCapsules(spaceId: Accessor<string | null>): {
  readonly capsules: Accessor<readonly WorkspaceCapsule[]>;
  readonly loading: Accessor<boolean>;
  readonly error: Accessor<string | null>;
  /** Re-fetch Capsules while a Run is in flight. */
  readonly refetch: () => void;
} {
  const [resource, { refetch }] = createResource(
    () => spaceId() ?? "",
    async (id) => {
      try {
        return {
          capsules: await loadWorkspaceCapsules(id),
          error: null,
        };
      } catch (error) {
        return {
          capsules: [] as readonly WorkspaceCapsule[],
          error: error instanceof Error
            ? error.message
            : "Failed to load Capsule inventory",
        };
      }
    },
  );
  return {
    capsules: () => resource()?.capsules ?? [],
    loading: () => resource.loading,
    error: () => resource()?.error ?? null,
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
    async (id) => {
      try {
        return (await loadWorkspaceCapsules(id))
          .filter(isInflightCapsule)
          .map((capsule) => ({
            id: capsule.id,
            name: capsule.name,
            status: capsule.status,
            environment: capsule.environment,
          }));
      } catch {
        return [];
      }
    },
  );
  return {
    capsules: () => resource() ?? [],
    loading: () => resource.loading,
  };
}
