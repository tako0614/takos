import type { StateAccessOptions } from '../../lib/state/state-file.ts';
import type { TakosState } from '../../lib/state/state-types.ts';

export type StateCategory = 'resources' | 'workers' | 'containers' | 'services' | 'routes';

/**
 * Resolve a dotted key like "resources.db" or "services.web" against
 * the TakosState structure. Returns { category, name, entry } or null.
 */
export function resolveStateKey(state: TakosState, key: string): {
  category: StateCategory;
  name: string;
  entry: Record<string, unknown>;
} | null {
  const categories: StateCategory[] = ['resources', 'workers', 'containers', 'services', 'routes'];
  const parts = key.split('.');
  if (parts.length === 2) {
    const [category, name] = parts;
    if (categories.includes(category as StateCategory)) {
      const bucket = state[category as StateCategory];
      if (bucket && name in bucket) {
        return { category: category as StateCategory, name, entry: bucket[name] as unknown as Record<string, unknown> };
      }
    }
    return null;
  }
  // Try bare name in all categories
  for (const cat of categories) {
    const bucket = state[cat];
    if (bucket && key in bucket) {
      return { category: cat, name: key, entry: bucket[key] as unknown as Record<string, unknown> };
    }
  }
  return null;
}

export function toAccessOpts(options: { offline?: boolean }): StateAccessOptions {
  return options.offline ? { offline: true } : {};
}
