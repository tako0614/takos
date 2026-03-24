import { cloudflareWorkerPlugin } from './cloudflare-worker';
import type { WorkloadPlugin } from './types';

const plugins = new Map<string, WorkloadPlugin>();

for (const plugin of [cloudflareWorkerPlugin]) {
  plugins.set(plugin.type, plugin);
}

export function getWorkloadPlugin(type: string): WorkloadPlugin | null {
  const key = String(type || '').trim();
  if (!key) return null;
  return plugins.get(key) || null;
}

export function listWorkloadPlugins(): string[] {
  return Array.from(plugins.keys()).sort();
}

export type { WorkloadPlugin, WorkloadPluginApplyContext, WorkloadPluginApplyResult } from './types';
