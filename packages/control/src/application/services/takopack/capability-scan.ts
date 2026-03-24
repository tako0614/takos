import type { StandardCapabilityId } from '../platform/capabilities';
import { capabilityRegistry } from '../platform/capabilities';
import type { TakopackManifest } from './types';

function uniqueCapabilities(ids: StandardCapabilityId[]): StandardCapabilityId[] {
  return [...new Set(ids)];
}

export function inferRequiredCapabilitiesFromManifest(manifest: TakopackManifest): StandardCapabilityId[] {
  const required: StandardCapabilityId[] = [];

  const hasResourceBindings = !!manifest.workers?.some((w) =>
    (w.bindings?.d1?.length || 0) > 0
    || (w.bindings?.r2?.length || 0) > 0
    || (w.bindings?.kv?.length || 0) > 0
  );

  const hasProvisionedResources = !!manifest.resources
    && (
      (manifest.resources.d1?.length || 0) > 0
      || (manifest.resources.r2?.length || 0) > 0
      || (manifest.resources.kv?.length || 0) > 0
    );

  if (hasResourceBindings || hasProvisionedResources) {
    required.push('storage.write');
  }

  // OAuth exchange is only exposed to workers when autoEnv is enabled.
  if (manifest.oauth?.autoEnv) {
    required.push('oauth.exchange');
  }

  return uniqueCapabilities(required);
}

export type TakopackCapabilityScan = {
  has_explicit_capabilities: boolean;
  declared: StandardCapabilityId[];
  inferred_required: StandardCapabilityId[];
  missing_required: StandardCapabilityId[];
  unknown: string[];
  duplicates: string[];
  effective: StandardCapabilityId[];
  high_risk: StandardCapabilityId[];
};

export function scanTakopackCapabilities(manifest: TakopackManifest): TakopackCapabilityScan {
  const inferredRequired = inferRequiredCapabilitiesFromManifest(manifest);
  const hasExplicitCapabilities = Array.isArray(manifest.capabilities);
  const declaredRaw = hasExplicitCapabilities ? manifest.capabilities : [];
  const { known: declared, unknown, duplicates } = capabilityRegistry.validate(
    (declaredRaw || []).map((v) => String(v).trim()).filter(Boolean)
  );

  const missing = inferredRequired.filter((cap) => !declared.includes(cap));
  const effective = hasExplicitCapabilities ? declared : inferredRequired;

  const highRisk: StandardCapabilityId[] = [];
  for (const cap of effective) {
    if (cap === 'egress.http' || cap === 'storage.write' || cap === 'oauth.exchange') {
      highRisk.push(cap);
    }
  }

  return {
    has_explicit_capabilities: hasExplicitCapabilities,
    declared,
    inferred_required: inferredRequired,
    missing_required: missing,
    unknown,
    duplicates,
    effective,
    high_risk: highRisk,
  };
}
