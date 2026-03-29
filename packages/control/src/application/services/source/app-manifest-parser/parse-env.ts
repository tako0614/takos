import type { AppEnvConfig } from '../app-manifest-types';
import { asRecord, asStringArray, asStringMap } from '../app-manifest-utils';

// ============================================================
// Environment config parser
// ============================================================

export function parseEnvConfig(specRecord: Record<string, unknown>): AppEnvConfig | undefined {
  if (specRecord.env == null) return undefined;
  const envRecord = asRecord(specRecord.env);
  const required = asStringArray(envRecord.required, 'spec.env.required');
  const inject = asStringMap(envRecord.inject, 'spec.env.inject');

  // Validate template syntax in inject values
  if (inject) {
    for (const [key, value] of Object.entries(inject)) {
      // Check for unclosed template braces
      const opens = (value.match(/\{\{/g) || []).length;
      const closes = (value.match(/\}\}/g) || []).length;
      if (opens !== closes) {
        throw new Error(`spec.env.inject.${key} has mismatched template braces`);
      }
    }
  }

  if (!required && !inject) return undefined;

  return {
    ...(required ? { required } : {}),
    ...(inject ? { inject } : {}),
  };
}
