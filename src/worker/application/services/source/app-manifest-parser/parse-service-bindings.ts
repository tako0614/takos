import type {
  AppCompute,
  AppServiceBinding,
  AppServiceBindingInject,
} from "../app-manifest-types.ts";
import {
  TAKOS_APP_SERVICE_BINDING_CAPABILITIES,
  TAKOS_APP_SERVICE_GRANT_SCOPES,
  type TakosAppServiceBindingCapability,
  type TakosAppServiceGrantScope,
} from "../app-interface-contract.ts";
import {
  asRecord,
  asRequiredString,
  asStringArray,
} from "../app-manifest-utils.ts";

const SERVICE_BINDING_FIELDS = new Set([
  "name",
  "capability",
  "target",
  "inject",
  "scopes",
]);
const SERVICE_BINDING_INJECT_FIELDS = new Set(["baseUrlEnv", "tokenEnv"]);

function assertAllowedFields(
  record: Record<string, unknown>,
  prefix: string,
  allowed: ReadonlySet<string>,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new Error(
        `${prefix}.${key} is not supported by the serviceBindings contract`,
      );
    }
  }
}

function parseServiceBindingName(raw: unknown, field: string): string {
  const value = asRequiredString(raw, field);
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(value)) {
    throw new Error(
      `${field} must start with a lowercase letter and contain only lowercase letters, digits, or hyphens`,
    );
  }
  return value;
}

function parseServiceBindingCapability(
  raw: unknown,
  field: string,
): TakosAppServiceBindingCapability {
  const value = asRequiredString(raw, field);
  if (!/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(value)) {
    throw new Error(`${field} must be a runtime projection capability token`);
  }
  if (
    !(TAKOS_APP_SERVICE_BINDING_CAPABILITIES as readonly string[]).includes(
      value,
    )
  ) {
    throw new Error(
      `${field} '${value}' is not supported by the Takos runtime projection profile`,
    );
  }
  return value as TakosAppServiceBindingCapability;
}

function parseEnvName(raw: unknown, field: string): string | undefined {
  if (raw == null) return undefined;
  const value = asRequiredString(raw, field).toUpperCase();
  if (!/^[A-Z_][A-Z0-9_]*$/.test(value)) {
    throw new Error(`${field} must be a valid environment variable name`);
  }
  return value;
}

function parseServiceBindingInject(
  raw: unknown,
  prefix: string,
): AppServiceBindingInject {
  const record = asRecord(raw);
  assertAllowedFields(record, prefix, SERVICE_BINDING_INJECT_FIELDS);
  const baseUrlEnv = parseEnvName(record.baseUrlEnv, `${prefix}.baseUrlEnv`);
  const tokenEnv = parseEnvName(record.tokenEnv, `${prefix}.tokenEnv`);
  const inject = {
    ...(baseUrlEnv ? { baseUrlEnv } : {}),
    ...(tokenEnv ? { tokenEnv } : {}),
  };
  if (!inject.baseUrlEnv || !inject.tokenEnv) {
    throw new Error(`${prefix}.baseUrlEnv and ${prefix}.tokenEnv are required`);
  }
  return inject;
}

function parseScopes(
  raw: unknown,
  field: string,
  capability: TakosAppServiceBindingCapability,
): TakosAppServiceGrantScope[] {
  const scopes = asStringArray(raw, field);
  if (!scopes || scopes.length === 0) {
    throw new Error(`${field} must declare at least one scope`);
  }
  const allowed = new Set(
    TAKOS_APP_SERVICE_GRANT_SCOPES[capability] as readonly string[],
  );
  const normalized = scopes.map((scope, index) => {
    if (!/^[a-z][a-z0-9_.:-]{0,95}$/.test(scope)) {
      throw new Error(`${field}[${index}] must be a runtime authority scope token`);
    }
    if (!allowed.has(scope)) {
      throw new Error(
        `${field}[${index}] '${scope}' is not supported by service binding capability '${capability}'`,
      );
    }
    return scope as TakosAppServiceGrantScope;
  });
  return normalized;
}

export function parseServiceBindings(
  topLevel: Record<string, unknown>,
  compute: Record<string, AppCompute>,
): AppServiceBinding[] {
  const raw = topLevel.serviceBindings;
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new Error("serviceBindings must be an array");
  }

  const seenNames = new Set<string>();
  const seenEnvByTarget = new Map<string, string>();
  return raw.map((entry, index) => {
    const prefix = `serviceBindings[${index}]`;
    const record = asRecord(entry);
    assertAllowedFields(record, prefix, SERVICE_BINDING_FIELDS);
    const name = parseServiceBindingName(record.name, `${prefix}.name`);
    if (seenNames.has(name)) {
      throw new Error(`${prefix}.name duplicates service binding '${name}'`);
    }
    seenNames.add(name);

    const capability = parseServiceBindingCapability(
      record.capability,
      `${prefix}.capability`,
    );
    const target = asRequiredString(record.target, `${prefix}.target`);
    if (!compute[target]) {
      throw new Error(
        `${prefix}.target references unknown top-level compute: ${target}`,
      );
    }
    const inject = parseServiceBindingInject(record.inject, `${prefix}.inject`);
    for (const envName of [inject.baseUrlEnv, inject.tokenEnv]) {
      if (!envName) continue;
      const key = `${target}\0${envName}`;
      const previous = seenEnvByTarget.get(key);
      if (previous) {
        throw new Error(
          `${prefix}.inject env '${envName}' duplicates service binding '${previous}' for compute '${target}'`,
        );
      }
      seenEnvByTarget.set(key, name);
    }
    const scopes = parseScopes(record.scopes, `${prefix}.scopes`, capability);
    return {
      name,
      capability,
      target,
      inject,
      scopes,
    };
  });
}
