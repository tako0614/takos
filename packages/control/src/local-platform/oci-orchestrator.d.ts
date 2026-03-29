import { Hono } from 'hono';
import type { ContainerBackend } from './container-backend.ts';
export interface OciOrchestratorAppOptions {
    /** Container backend to use.  Defaults to DockerContainerBackend. */
    backend?: ContainerBackend;
}
export declare function createLocalOciOrchestratorApp(options?: OciOrchestratorAppOptions): Hono;
export declare function createLocalOciOrchestratorFetchForTests(options?: OciOrchestratorAppOptions): Promise<(request: Request) => Promise<Response>>;
export declare function startLocalOciOrchestratorServer(options?: OciOrchestratorAppOptions): Promise<void>;
//# sourceMappingURL=oci-orchestrator.d.ts.map