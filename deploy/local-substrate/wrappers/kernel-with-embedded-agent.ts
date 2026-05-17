/**
 * Boots takosumi kernel with an embedded runtime-agent in one process.
 *
 * Differences from `takosumi-cli server`:
 * - Imports kernel from local /workspace source so the running bytes match
 *   the takosumi/ submodule under active development (cli pins JSR).
 * - Uses local-substrate-factories.buildLocalSubstrateRegistry instead of
 *   the upstream auto-detected registry, so public-DNS providers
 *   (route53 / cloud-dns / cloudflare-dns) are import-time denied — see
 *   /local-substrate-factories/local-substrate-factories.ts.
 *
 * Order matters: the embedded agent must be started before the kernel
 * module is imported, so LIFECYCLE_AGENT_URL_ENV is set when the kernel
 * reads its env at boot. Hence dynamic import of the kernel.
 */
import { serveRuntimeAgent } from '/workspace/packages/runtime-agent/src/server.ts';
import {
  LIFECYCLE_AGENT_TOKEN_ENV,
  LIFECYCLE_AGENT_URL_ENV,
} from '/workspace/packages/contract/src/runtime-agent-lifecycle.ts';
import { currentRuntime } from '/workspace/packages/kernel/src/shared/runtime/index.ts';
import { buildLocalSubstrateRegistry } from '/local-substrate-factories/local-substrate-factories.ts';

const agentPort = Number(Deno.env.get('TAKOSUMI_AGENT_PORT') ?? '8789');
const kernelPort = Number(Deno.env.get('PORT') ?? '8788');

const env = Deno.env.toObject();
const registry = buildLocalSubstrateRegistry(env);
const token = env[LIFECYCLE_AGENT_TOKEN_ENV] ?? randomToken();

const agent = serveRuntimeAgent({
  registry,
  token,
  port: agentPort,
  hostname: '127.0.0.1',
});

Deno.env.set(LIFECYCLE_AGENT_URL_ENV, agent.url);
Deno.env.set(LIFECYCLE_AGENT_TOKEN_ENV, token);

console.log(
  `[local-substrate-wrapper] embedded runtime-agent at ${agent.url} ` +
    `(${registry.size()} connectors, public DNS providers denied at import time)`,
);

// Now that LIFECYCLE_AGENT_URL_ENV is set, importing the kernel will
// register providers against the embedded agent.
const kernelModule = await import(
  '/workspace/packages/kernel/src/index.ts'
);
const app = kernelModule.default;

const runtime = currentRuntime();
const server = runtime.serveHttp(app.fetch, { port: kernelPort });
console.log(
  `[local-substrate-wrapper] kernel listening on http://0.0.0.0:${kernelPort}/`,
);

const shutdown = (signal: string) => {
  console.log(`[local-substrate-wrapper] received ${signal}, draining...`);
  Promise.allSettled([agent.shutdown(), server.shutdown()]).finally(() => {
    Deno.exit(0);
  });
};
runtime.onSignal('SIGINT', () => shutdown('SIGINT'));
runtime.onSignal('SIGTERM', () => shutdown('SIGTERM'));

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
