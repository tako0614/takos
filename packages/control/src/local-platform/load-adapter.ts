import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Env } from '../shared/types/index.ts';
import type { DispatchEnv } from '../dispatch.ts';

export interface LocalControlAdapterModule {
  createNodeWebEnv?: () => Promise<Env> | Env;
  createNodeDispatchEnv?: () => Promise<DispatchEnv> | DispatchEnv;
}

function resolveAdapterSpecifier(rawSpecifier: string): string {
  if (rawSpecifier.startsWith('.') || rawSpecifier.startsWith('/')) {
    return pathToFileURL(resolve(process.cwd(), rawSpecifier)).href;
  }
  return rawSpecifier;
}

async function loadLocalAdapterModule(): Promise<LocalControlAdapterModule> {
  const rawSpecifier = Deno.env.get('TAKOS_LOCAL_ADAPTER');
  if (!rawSpecifier) {
    return import(new URL('../node-platform/env-builder.ts', import.meta.url).href) as Promise<LocalControlAdapterModule>;
  }

  const module = await import(resolveAdapterSpecifier(rawSpecifier));
  return module as LocalControlAdapterModule;
}

export async function loadLocalWebEnv(): Promise<Env> {
  const module = await loadLocalAdapterModule();
  if (typeof module.createNodeWebEnv !== 'function') {
    throw new Error('Local adapter must export createNodeWebEnv()');
  }
  return await module.createNodeWebEnv();
}

export async function loadLocalDispatchEnv(): Promise<DispatchEnv> {
  const module = await loadLocalAdapterModule();
  if (typeof module.createNodeDispatchEnv !== 'function') {
    throw new Error('Local adapter must export createNodeDispatchEnv()');
  }
  return await module.createNodeDispatchEnv();
}
