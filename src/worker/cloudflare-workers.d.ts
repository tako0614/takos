declare module "cloudflare:workers" {
  /** Minimal host type used by the Cloudflare-only deployment entrypoint. */
  export abstract class WorkerEntrypoint<Env = unknown, Ctx = unknown> {
    protected readonly env: Env;
    protected readonly ctx: Ctx;
    constructor(ctx: Ctx, env: Env);
  }
}
