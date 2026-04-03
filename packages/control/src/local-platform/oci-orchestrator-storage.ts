import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type OciServiceEndpoint =
  | {
    kind: "service-ref";
    ref: string;
  }
  | {
    kind: "http-url";
    base_url: string;
  };

export type OciServiceStatus = "deployed" | "removed" | "routing-only";
export type OciProviderName = "oci" | "ecs" | "cloud-run" | "k8s";

export type OciServiceRecord = {
  space_id: string;
  route_ref: string;
  deployment_id: string;
  artifact_ref: string;
  provider_name: OciProviderName;
  provider_config: Record<string, unknown> | null;
  endpoint: OciServiceEndpoint;
  image_ref: string | null;
  exposed_port: number | null;
  health_path: string | null;
  container_id: string | null;
  resolved_endpoint: { kind: "http-url"; base_url: string } | null;
  compatibility_date: string | null;
  compatibility_flags: string[];
  limits: {
    cpu_ms?: number;
    subrequests?: number;
  } | null;
  status: OciServiceStatus;
  health_status: "unknown" | "healthy" | "unhealthy";
  last_health_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type OciOrchestratorState = {
  services: Record<string, OciServiceRecord>;
};

export function resolveDataDir(): string {
  const explicit = Deno.env.get("OCI_ORCHESTRATOR_DATA_DIR")?.trim();
  if (explicit) {
    return path.resolve(explicit);
  }
  const localDir = Deno.env.get("TAKOS_LOCAL_DATA_DIR")?.trim();
  if (localDir) {
    return path.resolve(localDir, "oci-orchestrator");
  }
  return path.resolve(process.cwd(), ".takos-local-oci-orchestrator");
}

export function resolvePort(): number {
  const parsed = Number.parseInt(
    Deno.env.get("PORT") ?? Deno.env.get("OCI_ORCHESTRATOR_PORT") ?? "",
    10,
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 9002;
}

export function serviceKey(spaceId: string, routeRef: string): string {
  return `${spaceId}::${routeRef}`;
}

export function containerName(spaceId: string, routeRef: string): string {
  return `takos-${spaceId}-${routeRef}`.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(
    0,
    128,
  );
}

export function logPathFor(spaceId: string, routeRef: string): string {
  return path.join(resolveDataDir(), "logs", `${spaceId}-${routeRef}.log`);
}

function statePath(): string {
  return path.join(resolveDataDir(), "state.json");
}

async function ensureStorageDirs(): Promise<void> {
  await mkdir(path.join(resolveDataDir(), "logs"), { recursive: true });
}

export async function loadState(): Promise<OciOrchestratorState> {
  try {
    const raw = await readFile(statePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<OciOrchestratorState>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { services: {} };
    }
    return {
      services: parsed.services && typeof parsed.services === "object"
        ? parsed.services as Record<string, OciServiceRecord>
        : {},
    };
  } catch {
    return { services: {} };
  }
}

export async function saveState(state: OciOrchestratorState): Promise<void> {
  await ensureStorageDirs();
  await writeFile(statePath(), `${JSON.stringify(state, null, 2)}\n`);
}

export async function appendServiceLog(
  spaceId: string,
  routeRef: string,
  line: string,
): Promise<void> {
  await ensureStorageDirs();
  await appendFile(
    logPathFor(spaceId, routeRef),
    `${new Date().toISOString()} ${line}\n`,
  );
}

export function tailLines(text: string, tail: number): string {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  return `${lines.slice(Math.max(0, lines.length - tail)).join("\n")}${
    lines.length > 0 ? "\n" : ""
  }`;
}

export async function readServiceLogTail(
  spaceId: string,
  routeRef: string,
  tail: number,
): Promise<string> {
  try {
    const body = await readFile(logPathFor(spaceId, routeRef), "utf8");
    return tailLines(body, tail);
  } catch {
    return "";
  }
}
