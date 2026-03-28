/**
 * Durable Object resolver — selects Redis/persistent/in-memory.
 */
import path from 'node:path';
import {
  createInMemoryDurableObjectNamespace,
} from '../../local-platform/in-memory-bindings.ts';
import {
  createPersistentDurableObjectNamespace,
} from '../../local-platform/persistent-bindings.ts';
import { createRedisDurableObjectNamespace } from '../../worker-emulation/redis-durable-object.ts';

export function resolveDurableObject(name: string, redisUrl: string | null, dataDir: string | null) {
  if (redisUrl) return createRedisDurableObjectNamespace(redisUrl, name);
  if (dataDir) return createPersistentDurableObjectNamespace(path.join(dataDir, 'durable-objects', `${name}.json`));
  return createInMemoryDurableObjectNamespace();
}
