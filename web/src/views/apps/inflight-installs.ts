/**
 * In-flight control-plane installs for the AppsPage coherence section.
 *
 * AppsPage reads deployed UI surfaces. This fetches the Takos product facade for
 * the current Space and surfaces installs that are not yet finished/active.
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

export interface CapsuleInstallation {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly freshness: string | null;
  readonly environment: string;
  readonly mode: string | null;
  readonly sourceUrl: string | null;
  readonly sourceRef: string | null;
  readonly sourceCommit: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly services: readonly CapsuleServiceSummary[];
}

export type InflightInstall = Pick<
  CapsuleInstallation,
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
  ...paths: readonly (readonly string[])[]
): string | null {
  for (const path of paths) {
    let current: unknown = record;
    for (const segment of path) {
      const parent = readRecord(current);
      if (!parent) {
        current = null;
        break;
      }
      current = parent[segment];
    }
    const value = readString(current);
    if (value) return value;
  }
  return null;
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

function installationName(row: Record<string, unknown>): string | null {
  const sourceUrl = readNestedString(
    row,
    ["source", "url"],
    ["source", "git", "url"],
    ["source", "git"],
    ["git_url"],
  );
  return (
    readString(row.name) ??
    readString(row.title) ??
    readString(row.app_name) ??
    readString(row.app_id) ??
    readString(row.appId) ??
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
    capability: readString(record.capability) ?? "deployment.outputs",
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

export function parseCapsuleInstallationsResponse(
  body: unknown,
): readonly CapsuleInstallation[] {
  const record = readRecord(body);
  const rows = Array.isArray(record?.installations) ? record.installations : [];
  const out: CapsuleInstallation[] = [];
  for (const row of rows) {
    const item = readRecord(row);
    if (!item) continue;
    const id =
      readString(item.id) ??
      readString(item.installation_id) ??
      readString(item.installationId);
    const name = installationName(item);
    const rawStatus = readString(item.status) ?? "unknown";
    const freshness = readString(item.freshness);
    if (!id || !name || !rawStatus) continue;
    const sourceUrl = readNestedString(
      item,
      ["source", "url"],
      ["source", "git", "url"],
      ["source", "git"],
      ["git_url"],
    );
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
      mode: readString(item.mode) ?? readString(item.runtime_mode),
      sourceUrl,
      sourceRef: readNestedString(
        item,
        ["source", "ref"],
        ["source", "git", "ref"],
        ["source", "git_ref"],
        ["ref"],
      ),
      sourceCommit: readNestedString(
        item,
        ["source", "commit"],
        ["source", "git", "commit"],
        ["source_commit"],
        ["installed_commit"],
      ),
      createdAt: readString(item.created_at) ?? readString(item.createdAt),
      updatedAt: readString(item.updated_at) ?? readString(item.updatedAt),
      services,
    });
  }
  return out;
}

export function isInflightInstallation(
  installation: Pick<CapsuleInstallation, "status">,
): boolean {
  return INFLIGHT_STATUSES.has(installation.status.toLowerCase());
}

async function fetchCapsuleInstallations(
  spaceId: string,
): Promise<readonly CapsuleInstallation[]> {
  if (!spaceId) return [];
  let res: Response;
  try {
    res = await fetch(
      `/api/spaces/${encodeURIComponent(spaceId)}/app-installations`,
      { headers: { accept: "application/json" }, credentials: "include" },
    );
  } catch {
    return []; // network / offline: hide the section, never throw.
  }
  // No account-plane session (401), no config (503), or any non-2xx: fail soft.
  if (!res.ok) return [];
  return parseCapsuleInstallationsResponse(
    await res.json().catch(() => undefined),
  );
}

export function useCapsuleInstallations(spaceId: Accessor<string | null>): {
  readonly installations: Accessor<readonly CapsuleInstallation[]>;
  readonly loading: Accessor<boolean>;
} {
  const [resource] = createResource(
    () => spaceId() ?? "",
    fetchCapsuleInstallations,
  );
  return {
    installations: () => resource() ?? [],
    loading: () => resource.loading,
  };
}

/**
 * Reactive in-flight installs for the AppsPage section.
 */
export function useInflightInstalls(spaceId: Accessor<string | null>): {
  readonly installs: Accessor<readonly InflightInstall[]>;
  readonly loading: Accessor<boolean>;
} {
  const [resource] = createResource(
    () => spaceId() ?? "",
    async (id) =>
      (await fetchCapsuleInstallations(id))
        .filter(isInflightInstallation)
        .map((installation) => ({
          id: installation.id,
          name: installation.name,
          status: installation.status,
          environment: installation.environment,
        })),
  );
  return {
    installs: () => resource() ?? [],
    loading: () => resource.loading,
  };
}
