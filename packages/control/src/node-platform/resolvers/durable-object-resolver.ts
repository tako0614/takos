/**
 * Durable Object resolver — selects Redis/persistent/in-memory.
 */
import path from "node:path";
import { createSyncResolverWithRedis } from "./resolver-factory.ts";
import {
  createInMemoryDurableObjectNamespace,
} from "../../local-platform/in-memory-bindings.ts";
import {
  createPersistentDurableObjectNamespace,
} from "../../local-platform/persistent-bindings.ts";
import { createRedisDurableObjectNamespace } from "../../worker-emulation/redis-durable-object.ts";

export function resolveDurableObject(
  name: string,
  redisUrl: string | null,
  dataDir: string | null,
) {
  if (Deno.env.get("TAKOS_DISABLE_REDIS_EXTERNALS") === "1") {
    return createInMemoryDurableObjectNamespace();
  }
  return createSyncResolverWithRedis({
    createRedis: (url) => createRedisDurableObjectNamespace(url, name),
    createPersistent: (dir) =>
      createPersistentDurableObjectNamespace(
        path.join(dir, "durable-objects", `${name}.json`),
      ),
    createInMemory: () => createInMemoryDurableObjectNamespace(),
  })(redisUrl, dataDir);
}
