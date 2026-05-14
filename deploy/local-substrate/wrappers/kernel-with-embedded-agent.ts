/**
 * Boots takosumi kernel with an embedded runtime-agent in one process.
 *
 * Order matters: the embedded agent must be started before the kernel
 * module is imported, so that LIFECYCLE_AGENT_URL_ENV is set when the
 * kernel reads its env at boot. Hence dynamic import of the kernel.
 *
 * Mounted into the local-substrate kernel container at /wrappers/.
 */
import { startEmbeddedAgent } from "/workspace/packages/runtime-agent/src/embed.ts";
import { currentRuntime } from "/workspace/packages/kernel/src/shared/runtime/index.ts";

const agentPort = Number(Deno.env.get("TAKOSUMI_AGENT_PORT") ?? "8789");
const kernelPort = Number(Deno.env.get("PORT") ?? "8788");

const handle = startEmbeddedAgent({ port: agentPort });
console.log(
  `[local-substrate-wrapper] embedded runtime-agent at ${handle.url}`,
);

// Now that LIFECYCLE_AGENT_URL_ENV is set, importing the kernel will
// register providers against the embedded agent.
const kernelModule = await import(
  "/workspace/packages/kernel/src/index.ts"
);
const app = kernelModule.default;

const runtime = currentRuntime();
const server = runtime.serveHttp(app.fetch, { port: kernelPort });
console.log(
  `[local-substrate-wrapper] kernel listening on http://0.0.0.0:${kernelPort}/`,
);

const shutdown = (signal: string) => {
  console.log(`[local-substrate-wrapper] received ${signal}, draining...`);
  Promise.allSettled([handle.shutdown(), server.shutdown()]).finally(() => {
    Deno.exit(0);
  });
};
runtime.onSignal("SIGINT", () => shutdown("SIGINT"));
runtime.onSignal("SIGTERM", () => shutdown("SIGTERM"));
