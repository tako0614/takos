import http from "node:http";
import type {
  ContainerBackend,
  ContainerCreateResult,
} from "./container-backend.ts";

export const HEALTH_TIMEOUT_MS = 30_000;
const HEALTH_POLL_INTERVAL_MS = 1_000;

export type OciHealthCheckResult =
  | {
    healthy: true;
    resolvedEndpoint: { kind: "http-url"; base_url: string };
  }
  | {
    healthy: false;
    details: string;
  };

export type OciHealthCheckOptions = {
  backend: ContainerBackend;
  createResult: ContainerCreateResult;
  containerId: string;
  containerName: string;
  exposedPort: number;
  healthPath: string;
  timeoutMs?: number;
  onProgress?: (line: string) => Promise<void> | void;
};

async function pollHealthCheck(
  host: string,
  port: number,
  healthPath: string,
  timeoutMs: number,
): Promise<boolean> {
  if (Deno.env.get("TAKOS_SKIP_OCI_HEALTH_CHECK") === "1") {
    return true;
  }

  const normalizedPath = healthPath.startsWith("/")
    ? healthPath
    : `/${healthPath}`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const result = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          {
            hostname: host,
            port,
            path: normalizedPath,
            method: "GET",
            timeout: 5000,
          },
          (res) => {
            res.on("data", (chunk) => {
              void chunk;
            });
            res.on("end", () => resolve(res.statusCode ?? 0));
          },
        );
        req.on("error", reject);
        req.on("timeout", () => {
          req.destroy();
          reject(new Error("timeout"));
        });
        req.end();
      });
      if (result >= 200 && result < 400) {
        return true;
      }
    } catch {
      // Not ready yet
    }
    await new Promise((resolve) =>
      setTimeout(resolve, HEALTH_POLL_INTERVAL_MS)
    );
  }
  return false;
}

async function pollHealthCheckUrl(
  url: string,
  timeoutMs: number,
): Promise<boolean> {
  if (Deno.env.get("TAKOS_SKIP_OCI_HEALTH_CHECK") === "1") {
    return true;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(5_000),
      });
      if (response.status >= 200 && response.status < 400) {
        return true;
      }
    } catch {
      // Not ready yet
    }
    await new Promise((resolve) =>
      setTimeout(resolve, HEALTH_POLL_INTERVAL_MS)
    );
  }
  return false;
}

function healthTimeoutDetails(healthPath: string, timeoutMs: number): string {
  return `Health check at ${healthPath} did not pass within ${
    timeoutMs / 1000
  }s`;
}

async function emitProgress(
  onProgress: OciHealthCheckOptions["onProgress"],
  line: string,
): Promise<void> {
  if (onProgress) {
    await onProgress(line);
  }
}

export async function performHealthCheckAndResolveEndpoint(
  options: OciHealthCheckOptions,
): Promise<OciHealthCheckResult> {
  const timeoutMs = options.timeoutMs ?? HEALTH_TIMEOUT_MS;

  if (options.createResult.healthCheckUrl) {
    await emitProgress(
      options.onProgress,
      `HEALTH_CHECK polling ${options.createResult.healthCheckUrl}`,
    );
    const healthy = await pollHealthCheckUrl(
      options.createResult.healthCheckUrl,
      timeoutMs,
    );
    if (!healthy) {
      return {
        healthy: false,
        details: healthTimeoutDetails(options.healthPath, timeoutMs),
      };
    }
    if (!options.createResult.resolvedEndpoint) {
      throw new Error("Container backend did not provide a resolved endpoint");
    }
    return {
      healthy: true,
      resolvedEndpoint: options.createResult.resolvedEndpoint,
    };
  }

  const containerIp = await options.backend.getContainerIp(options.containerId);
  const healthHost = containerIp ?? options.containerName;
  await emitProgress(
    options.onProgress,
    `HEALTH_CHECK polling ${healthHost}:${options.exposedPort}${options.healthPath}`,
  );
  const healthy = await pollHealthCheck(
    healthHost,
    options.exposedPort,
    options.healthPath,
    timeoutMs,
  );
  if (!healthy) {
    return {
      healthy: false,
      details: healthTimeoutDetails(options.healthPath, timeoutMs),
    };
  }

  return {
    healthy: true,
    resolvedEndpoint: options.createResult.resolvedEndpoint ?? {
      kind: "http-url",
      base_url: `http://${healthHost}:${options.exposedPort}`,
    },
  };
}
