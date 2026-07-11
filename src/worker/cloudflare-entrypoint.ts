import { WorkerEntrypoint } from "cloudflare:workers";

import { createTakosWorker } from "./index.ts";
import { createWorkerRuntime } from "./runtime/worker/runtime-factory.ts";
import type { WorkerEnv } from "./runtime/worker/env.ts";

export * from "./index.ts";

/**
 * Binding-only HTTP entrypoint for outbound Web/MCP requests.
 *
 * `TAKOS_EGRESS` self-binds specifically to this class. The public/default
 * entrypoint remains the Takos Web/API router, so outbound requests cannot
 * accidentally recurse through or escape via that surface.
 */
export class TakosEgressEntrypoint extends WorkerEntrypoint<WorkerEnv> {
  async fetch(request: Request): Promise<Response> {
    return await createWorkerRuntime().fetch(request, this.env);
  }
}

export default createTakosWorker();
