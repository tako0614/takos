/**
 * K8sContainerBackend — ContainerBackend implementation using the Kubernetes
 * API to manage Pods.
 *
 * Designed for environments where the Docker socket is not available (e.g. the
 * orchestrator itself runs inside a Kubernetes cluster).
 *
 * Configuration:
 *   K8S_NAMESPACE   — target namespace (default: "default")
 *   K8S_KUBECONFIG  — optional path to a kubeconfig file (for local dev);
 *                     when absent, in-cluster ServiceAccount auth is used.
 */

import type {
  ContainerBackend,
  ContainerCreateOpts,
  ContainerCreateResult,
} from "./container-backend.ts";
import { logError, logInfo } from "../shared/utils/logger.ts";

// ---------------------------------------------------------------------------
// Re-export the types expected by the orchestrator
// ---------------------------------------------------------------------------

const K8S_NAMESPACE = Deno.env.get("K8S_NAMESPACE")?.trim() || "default";
const K8S_KUBECONFIG = Deno.env.get("K8S_KUBECONFIG")?.trim() || undefined;

/** How long to wait for a pod to reach the Running phase. */
const POD_READY_TIMEOUT_MS = 120_000;

/** Polling interval while waiting for pod readiness. */
const POD_POLL_INTERVAL_MS = 2_000;

// ---------------------------------------------------------------------------
// Lazy-loaded @kubernetes/client-node — keeps the import optional at the
// module level so that environments without the package don't blow up on
// import.
// ---------------------------------------------------------------------------

// @kubernetes/client-node is an optional peer dependency — types are only
// available when the package is installed (e.g. in local-platform builds).

// Local type stubs for @kubernetes/client-node (avoids hard dependency)
type K8sPodCondition = {
  type: string;
  status: string;
  reason?: string;
  message?: string;
};
type K8sContainerStatus = {
  ready: boolean;
  state?: { waiting?: { reason?: string; message?: string } };
};
type K8sPodStatus = {
  phase?: string;
  conditions?: K8sPodCondition[];
  containerStatuses?: K8sContainerStatus[];
  podIP?: string;
  message?: string;
  reason?: string;
};

interface K8sCoreV1Api {
  readNamespacedPod(
    params: { name: string; namespace: string },
  ): Promise<{ body: { status?: K8sPodStatus } }>;
  createNamespacedPod(
    params: { namespace: string; body: unknown },
  ): Promise<unknown>;
  deleteNamespacedPod(
    params: { name: string; namespace: string; gracePeriodSeconds?: number },
  ): Promise<unknown>;
  readNamespacedPodLog(
    params: {
      name: string;
      namespace: string;
      container?: string;
      tailLines?: number;
      timestamps?: boolean;
    },
  ): Promise<{ body: string }>;
}

interface K8sKubeConfig {
  loadFromFile(path: string): void;
  loadFromCluster(): void;
  makeApiClient(apiClass: unknown): K8sCoreV1Api;
}

type K8sApi = {
  core: K8sCoreV1Api;
  log: unknown;
  kc: K8sKubeConfig;
};

type K8sClientNodeModule = {
  KubeConfig: new () => K8sKubeConfig;
  CoreV1Api: unknown;
  Log: new (kc: K8sKubeConfig) => unknown;
};

let _k8sApi: K8sApi | null = null;
const K8S_CLIENT_MODULE_SPECIFIER = "@kubernetes/client-node";

function isK8sClientNodeModule(value: unknown): value is K8sClientNodeModule {
  return typeof value === "object" && value !== null &&
    typeof Reflect.get(value, "KubeConfig") === "function" &&
    typeof Reflect.get(value, "Log") === "function" &&
    Reflect.has(value, "CoreV1Api");
}

async function importK8sClientNode(): Promise<K8sClientNodeModule> {
  const module: unknown = await import(K8S_CLIENT_MODULE_SPECIFIER);
  if (!isK8sClientNodeModule(module)) {
    throw new Error("@kubernetes/client-node does not expose the expected API");
  }
  return module;
}

async function getK8sApi(): Promise<K8sApi> {
  if (_k8sApi) return _k8sApi;

  // Dynamic import so the dependency is truly optional at load time.
  const k8s = await importK8sClientNode();
  const kc = new k8s.KubeConfig();

  if (K8S_KUBECONFIG) {
    kc.loadFromFile(K8S_KUBECONFIG);
  } else {
    kc.loadFromCluster();
  }

  const core = kc.makeApiClient(k8s.CoreV1Api);
  const log = new k8s.Log(kc);

  _k8sApi = { core, log, kc };
  return _k8sApi;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sanitize a name into a valid Kubernetes object name:
 *   - lowercase
 *   - only a-z, 0-9, '-'
 *   - must start and end with alphanumeric
 *   - max 63 characters
 */
function sanitizePodName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 63);
}

function qualifyImageRef(imageRegistry: string, imageRef: string): string {
  const normalizedRegistry = imageRegistry.trim().replace(/\/+$/, "");
  const normalizedRef = imageRef.trim().replace(/^\/+/, "");
  if (!normalizedRegistry || !normalizedRef) {
    return imageRef;
  }
  const firstSegment = normalizedRef.split("/")[0] ?? "";
  const [hostCandidate, portCandidate] = firstSegment.split(":");
  if (
    hostCandidate.includes(".") || hostCandidate === "localhost" ||
    (portCandidate ? /^[0-9]+$/.test(portCandidate) : false)
  ) {
    return normalizedRef;
  }
  return `${normalizedRegistry}/${normalizedRef}`;
}

/**
 * Wait until a pod reaches Running phase with all containers ready,
 * or throw on scheduling / pull errors.
 */
async function waitForPodReady(
  podName: string,
  namespace: string,
  timeoutMs: number,
): Promise<string> {
  const { core } = await getK8sApi();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { body: pod } = await core.readNamespacedPod({
      name: podName,
      namespace,
    });

    const phase = pod.status?.phase;
    const conditions = pod.status?.conditions ?? [];
    const containerStatuses = pod.status?.containerStatuses ?? [];

    // Check for terminal failure conditions
    for (const cs of containerStatuses) {
      const waiting = cs.state?.waiting;
      if (waiting) {
        const reason = waiting.reason ?? "";
        // Permanent failures — abort immediately
        if (
          reason === "ErrImagePull" ||
          reason === "ImagePullBackOff" ||
          reason === "InvalidImageName" ||
          reason === "CreateContainerConfigError"
        ) {
          throw new Error(
            `Pod ${podName} failed to start: ${reason} — ${
              waiting.message ?? ""
            }`,
          );
        }
      }

      // CrashLoopBackOff — the container keeps crashing
      if (cs.state?.waiting?.reason === "CrashLoopBackOff") {
        throw new Error(
          `Pod ${podName} is in CrashLoopBackOff: ${
            cs.state.waiting.message ?? "container keeps crashing"
          }`,
        );
      }
    }

    // Pod reached Failed phase
    if (phase === "Failed") {
      const msg = pod.status?.message ?? pod.status?.reason ?? "unknown reason";
      throw new Error(`Pod ${podName} failed: ${msg}`);
    }

    // Unschedulable
    const unschedulable = conditions.find(
      (c) =>
        c.type === "PodScheduled" && c.status === "False" &&
        c.reason === "Unschedulable",
    );
    if (unschedulable) {
      throw new Error(
        `Pod ${podName} is unschedulable: ${
          unschedulable.message ?? "insufficient resources"
        }`,
      );
    }

    // Success: pod is Running and all containers are ready
    if (phase === "Running") {
      const allReady = containerStatuses.length > 0 &&
        containerStatuses.every((cs) => cs.ready);
      if (allReady) {
        const podIp = pod.status?.podIP ?? null;
        if (podIp) return podIp;
      }
    }

    await new Promise((r) => setTimeout(r, POD_POLL_INTERVAL_MS));
  }

  throw new Error(
    `Pod ${podName} did not become ready within ${timeoutMs / 1000}s`,
  );
}

// ---------------------------------------------------------------------------
// Backend
// ---------------------------------------------------------------------------

export class K8sContainerBackend implements ContainerBackend {
  private readonly namespace: string;
  private readonly deploymentName?: string;
  private readonly imageRegistry?: string;

  constructor(options?: {
    namespace?: string;
    deploymentName?: string;
    imageRegistry?: string;
  }) {
    this.namespace = options?.namespace ?? K8S_NAMESPACE;
    this.deploymentName = options?.deploymentName;
    this.imageRegistry = options?.imageRegistry;
  }

  /**
   * No-op for Kubernetes — the kubelet pulls images when creating pods.
   */
  async pullImage(_imageRef: string): Promise<void> {
    // Kubernetes handles image pulling at pod creation time.
    logInfo("k8s pullImage is a no-op; image will be pulled on pod creation", {
      module: "k8s-backend",
      image: _imageRef,
    });
  }

  async createAndStart(
    opts: ContainerCreateOpts,
  ): Promise<ContainerCreateResult> {
    const { core } = await getK8sApi();
    const podName = sanitizePodName(
      this.deploymentName ? `${this.deploymentName}-${opts.name}` : opts.name,
    );
    const imageRef = this.imageRegistry
      ? qualifyImageRef(this.imageRegistry, opts.imageRef)
      : opts.imageRef;

    // Build environment variables
    const envList: Array<{ name: string; value: string }> = [];
    if (opts.envVars) {
      for (const [k, v] of Object.entries(opts.envVars)) {
        envList.push({ name: k, value: v });
      }
    }

    // Merge labels
    const labels: Record<string, string> = {
      "app.kubernetes.io/managed-by": "takos-oci-orchestrator",
      "takos-pod-name": podName,
      ...opts.labels,
    };

    const podManifest = {
      apiVersion: "v1" as const,
      kind: "Pod" as const,
      metadata: {
        name: podName,
        namespace: this.namespace,
        labels,
      },
      spec: {
        restartPolicy: "Never" as const,
        containers: [
          {
            name: "app",
            image: imageRef,
            ports: [
              {
                containerPort: opts.exposedPort,
                protocol: "TCP" as const,
              },
            ],
            env: envList.length > 0 ? envList : undefined,
            // Sensible resource defaults — prevents runaway pods
            resources: {
              requests: {
                cpu: "100m",
                memory: "128Mi",
              },
              limits: {
                cpu: "500m",
                memory: "512Mi",
              },
            },
          },
        ],
      },
    };

    try {
      await core.createNamespacedPod({
        namespace: this.namespace,
        body: podManifest,
      });
    } catch (err: unknown) {
      // If the pod already exists (409 Conflict), attempt to delete and retry once.
      const status = (err as { response?: { statusCode?: number } })?.response
        ?.statusCode;
      if (status === 409) {
        logInfo(`Pod ${podName} already exists — deleting and re-creating`, {
          module: "k8s-backend",
        });
        await this.remove(podName);
        // Brief pause for deletion to propagate
        await new Promise((r) => setTimeout(r, 2_000));
        await core.createNamespacedPod({
          namespace: this.namespace,
          body: podManifest,
        });
      } else {
        throw err;
      }
    }

    logInfo(`Pod ${podName} created in namespace ${this.namespace}`, {
      module: "k8s-backend",
      image: imageRef,
    });

    // Wait for the pod to become Ready and obtain its IP
    const podIp = await waitForPodReady(
      podName,
      this.namespace,
      POD_READY_TIMEOUT_MS,
    );

    logInfo(`Pod ${podName} is running at ${podIp}`, {
      module: "k8s-backend",
    });

    return { containerId: podName };
  }

  async stop(containerId: string): Promise<void> {
    // For bare pods there is no graceful "stop" — we delete the pod.
    await this.remove(containerId);
  }

  async remove(containerId: string): Promise<void> {
    const { core } = await getK8sApi();
    const podName = sanitizePodName(containerId);

    try {
      await core.deleteNamespacedPod({
        name: podName,
        namespace: this.namespace,
        gracePeriodSeconds: 10,
      });
      logInfo(`Pod ${podName} deleted`, { module: "k8s-backend" });
    } catch (err: unknown) {
      const status = (err as { response?: { statusCode?: number } })?.response
        ?.statusCode;
      if (status === 404) {
        // Already gone — treat as success
        return;
      }
      throw err;
    }

    // Wait for the pod to actually disappear so that a subsequent create
    // with the same name does not hit a 409 Conflict.
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try {
        await core.readNamespacedPod({
          name: podName,
          namespace: this.namespace,
        });
        // Still exists — keep waiting
        await new Promise((r) => setTimeout(r, 1_000));
      } catch {
        // 404 — pod is gone
        return;
      }
    }
  }

  async getLogs(containerId: string, tail = 100): Promise<string> {
    const { core } = await getK8sApi();
    const podName = sanitizePodName(containerId);

    try {
      const { body } = await core.readNamespacedPodLog({
        name: podName,
        namespace: this.namespace,
        container: "app",
        tailLines: tail,
        timestamps: true,
      });
      // body is a string when the response is text/plain
      return typeof body === "string" ? body : String(body);
    } catch (err: unknown) {
      const status = (err as { response?: { statusCode?: number } })?.response
        ?.statusCode;
      if (status === 404) return "";
      logError(`Failed to read logs for pod ${podName}`, err, {
        module: "k8s-backend",
      });
      return "";
    }
  }

  async getContainerIp(containerId: string): Promise<string | null> {
    const { core } = await getK8sApi();
    const podName = sanitizePodName(containerId);

    try {
      const { body: pod } = await core.readNamespacedPod({
        name: podName,
        namespace: this.namespace,
      });
      return pod.status?.podIP ?? null;
    } catch {
      return null;
    }
  }
}
