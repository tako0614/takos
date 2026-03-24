import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Env } from '../shared/types/index.ts';
import type { DispatchEnv } from '../dispatch.ts';

export interface LocalControlAdapterModule {
  createTakosWebEnv?: () => Promise<Env> | Env;
  createTakosDispatchEnv?: () => Promise<DispatchEnv> | DispatchEnv;
}

function resolveAdapterSpecifier(rawSpecifier: string): string {
  if (rawSpecifier.startsWith('.') || rawSpecifier.startsWith('/')) {
    return pathToFileURL(resolve(process.cwd(), rawSpecifier)).href;
  }
  return rawSpecifier;
}

async function loadLocalAdapterModule(): Promise<LocalControlAdapterModule> {
  const rawSpecifier = process.env.TAKOS_LOCAL_ADAPTER;
  if (!rawSpecifier) {
    return import(new URL('./adapters/local.ts', import.meta.url).href) as Promise<LocalControlAdapterModule>;
  }

  const module = await import(resolveAdapterSpecifier(rawSpecifier));
  return module as LocalControlAdapterModule;
}

export async function loadLocalWebEnv(): Promise<Env> {
  const module = await loadLocalAdapterModule();
  if (typeof module.createTakosWebEnv !== 'function') {
    throw new Error('Local adapter must export createTakosWebEnv()');
  }
  return await module.createTakosWebEnv();
}

export async function loadLocalDispatchEnv(): Promise<DispatchEnv> {
  const module = await loadLocalAdapterModule();
  if (typeof module.createTakosDispatchEnv !== 'function') {
    throw new Error('Local adapter must export createTakosDispatchEnv()');
  }
  return await module.createTakosDispatchEnv();
}
