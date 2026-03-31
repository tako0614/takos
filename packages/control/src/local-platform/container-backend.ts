/**
 * ContainerBackend — abstraction over container runtimes (Docker, Kubernetes, etc.)
 *
 * The OCI orchestrator delegates all container lifecycle operations to an
 * implementation of this interface. The active backend may be fixed for the
 * whole process or resolved per deployment provider.
 */

export interface ContainerCreateOpts {
  /** Fully-qualified image reference, e.g. "ghcr.io/org/app:v1". */
  imageRef: string;

  /** Desired container / pod name.  Must be DNS-safe. */
  name: string;

  /** The port the containerised process listens on. */
  exposedPort: number;

  /** Optional environment variables to inject. */
  envVars?: Record<string, string>;

  /** Optional network to attach to (Docker-specific, ignored by k8s). */
  network?: string;

  /** Optional labels / annotations for the container / pod. */
  labels?: Record<string, string>;

  /** Optional health path used by provider-native runtimes. */
  healthPath?: string;

  /** Original endpoint request from the deployment target, when available. */
  requestedEndpoint?:
    | {
        kind: 'service-ref';
        ref: string;
      }
    | {
        kind: 'http-url';
        base_url: string;
      };
}

export interface ContainerCreateResult {
  /** An opaque identifier for the container (Docker container id / k8s pod name). */
  containerId: string;

  /**
   * If applicable, the host-side port that was mapped.
   * May be `undefined` when the backend uses internal DNS (e.g. k8s pod IP).
   */
  hostPort?: number;

  /** Resolved runtime endpoint when the provider exposes a stable URL. */
  resolvedEndpoint?: { kind: 'http-url'; base_url: string };

  /** Explicit health-check URL for providers without direct pod/container IP access. */
  healthCheckUrl?: string;
}

export interface ContainerBackend {
  /**
   * Ensure the image is available locally.
   * For backends that pull on-demand (e.g. Kubernetes) this may be a no-op.
   */
  pullImage(imageRef: string): Promise<void>;

  /** Create and start a container / pod.  Returns an identifier and optional host port. */
  createAndStart(opts: ContainerCreateOpts): Promise<ContainerCreateResult>;

  /** Gracefully stop a running container / pod. */
  stop(containerId: string): Promise<void>;

  /** Remove a stopped (or running) container / pod. */
  remove(containerId: string): Promise<void>;

  /** Retrieve recent log output from the container / pod. */
  getLogs(containerId: string, tail?: number): Promise<string>;

  /**
   * Return the IP address at which the container is reachable
   * (Docker container IP on the shared network, or k8s pod IP).
   * Returns `null` when the IP is not (yet) available.
   */
  getContainerIp(containerId: string): Promise<string | null>;
}
