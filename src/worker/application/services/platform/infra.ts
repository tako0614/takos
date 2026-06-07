import type {
  HttpRoute,
  StoredHttpEndpoint,
} from "../routing/routing-models.ts";

type InfraRuntimeTargetInput = {
  endpointName: string;
  routes: HttpRoute[];
  targetServiceRef: string;
  timeoutMs?: number | null;
  runtime?: string | null;
  serviceRef?: string | null;
};

function isHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function buildStoredEndpointForRuntime(
  input: InfraRuntimeTargetInput,
): StoredHttpEndpoint | null {
  const runtime = input.runtime?.trim() || "takos.worker";
  const targetRef = input.serviceRef?.trim() || input.targetServiceRef.trim();
  if (!targetRef) return null;

  const base = {
    name: input.endpointName,
    routes: input.routes,
    ...(input.timeoutMs !== null && input.timeoutMs !== undefined
      ? { timeoutMs: input.timeoutMs }
      : {}),
  };

  if (isHttpUrl(targetRef)) {
    return {
      ...base,
      target: { kind: "http-url", baseUrl: targetRef },
    };
  }

  if (
    runtime === "takos.worker" ||
    runtime === "runtime-host.worker" ||
    runtime === "workers-compatible"
  ) {
    return {
      ...base,
      target: { kind: "service-ref", ref: targetRef },
    };
  }

  return null;
}
