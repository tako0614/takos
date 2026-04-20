import { type Accessor, createEffect, createSignal, on } from "solid-js";
import { rpcJson } from "../../lib/rpc.ts";

export interface RegisteredApp {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  app_type: "platform" | "custom";
  url: string | null;
  space_id: string | null;
  space_name: string | null;
  service_hostname: string | null;
  service_status: string | null;
}

interface RegisteredAppsResponse {
  apps?: RegisteredApp[];
}

function toTitleCase(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function formatAppTypeLabel(
  appType: RegisteredApp["app_type"] | null | undefined,
): string {
  if (!appType) return "Unknown";
  return appType === "platform" ? "Platform" : "Custom";
}

export function formatAppStatusLabel(
  status: string | null | undefined,
): string {
  if (!status) return "Unknown";
  return toTitleCase(status);
}

export function getAppStatusVariant(
  status: string | null | undefined,
): "default" | "success" | "warning" | "error" | "info" {
  const normalized = status?.toLowerCase();
  if (!normalized) return "default";
  if (normalized === "deployed" || normalized === "active") return "success";
  if (
    normalized === "failed" || normalized === "error" ||
    normalized === "degraded"
  ) {
    return "error";
  }
  if (
    normalized.includes("pending") || normalized.includes("queue") ||
    normalized.includes("progress") || normalized === "paused"
  ) {
    return "warning";
  }
  return "info";
}

export async function loadRegisteredApps(
  spaceId: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<RegisteredApp[]> {
  if (!spaceId) return [];

  const response = await fetchImpl("/api/apps", {
    headers: {
      Accept: "application/json",
      "X-Takos-Space-Id": spaceId,
    },
  });

  const data = await rpcJson<RegisteredAppsResponse>(response);
  return Array.isArray(data.apps) ? data.apps : [];
}

export function useRegisteredApps(spaceId: Accessor<string>) {
  const [apps, setApps] = createSignal<RegisteredApp[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let requestSeq = 0;

  const fetchApps = async () => {
    const currentSpaceId = spaceId();
    if (!currentSpaceId) {
      setApps([]);
      setLoading(false);
      setError(null);
      return;
    }

    const requestId = ++requestSeq;
    setLoading(true);
    setError(null);

    try {
      const items = await loadRegisteredApps(currentSpaceId);
      if (requestId !== requestSeq || spaceId() !== currentSpaceId) return;
      setApps(items);
    } catch (err) {
      if (requestId !== requestSeq || spaceId() !== currentSpaceId) return;
      setApps([]);
      setError(
        err instanceof Error ? err.message : "Failed to load apps",
      );
    } finally {
      if (requestId === requestSeq && spaceId() === currentSpaceId) {
        setLoading(false);
      }
    }
  };

  createEffect(on(() => spaceId(), () => {
    setApps([]);
    void fetchApps();
  }));

  return { apps, loading, error, fetchApps };
}
