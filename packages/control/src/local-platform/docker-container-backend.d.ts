/**
 * DockerContainerBackend — ContainerBackend implementation using the Docker
 * Engine API via Unix socket.
 *
 * This is the original backend extracted from the monolithic OCI orchestrator.
 */
import type { ContainerBackend, ContainerCreateOpts, ContainerCreateResult } from './container-backend.ts';
export declare class DockerContainerBackend implements ContainerBackend {
    pullImage(imageRef: string): Promise<void>;
    createAndStart(opts: ContainerCreateOpts): Promise<ContainerCreateResult>;
    stop(containerId: string): Promise<void>;
    remove(containerId: string): Promise<void>;
    getLogs(containerId: string, tail?: number): Promise<string>;
    getContainerIp(containerId: string): Promise<string | null>;
    /**
     * Inspect a container by name (useful for deduplication before create).
     * Returns the container id if found, or null.
     */
    inspectByName(name: string): Promise<string | null>;
}
//# sourceMappingURL=docker-container-backend.d.ts.map