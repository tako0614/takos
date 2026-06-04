import type {
  PlatformDeployBackendConfig,
  PlatformDeployBackendRegistry,
  WorkersDispatchDeployBackendConfig,
} from "./platform-config.ts";

type EnvRecord = object;

function getEnvString(env: EnvRecord, key: string): string | undefined {
  const value = Reflect.get(env, key);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function createWorkersDispatchConfig(
  env: EnvRecord,
): WorkersDispatchDeployBackendConfig | null {
  const accountId = getEnvString(env, "CF_ACCOUNT_ID");
  const apiToken = getEnvString(env, "CF_API_TOKEN");
  const dispatchNamespace = getEnvString(env, "WFP_DISPATCH_NAMESPACE");
  if (!accountId || !apiToken || !dispatchNamespace) {
    return null;
  }
  const zoneId = getEnvString(env, "CF_ZONE_ID");
  return {
    name: "workers-dispatch",
    config: {
      accountId,
      apiToken,
      dispatchNamespace,
      ...(zoneId ? { zoneId } : {}),
    },
  };
}

const BACKEND_DEFAULT_ORDER: Array<PlatformDeployBackendConfig["name"]> = [
  "workers-dispatch",
];

export function createDeploymentBackendRegistry(
  configs: PlatformDeployBackendConfig[],
  defaultName?: PlatformDeployBackendConfig["name"],
): PlatformDeployBackendRegistry | undefined {
  if (configs.length === 0) return undefined;

  const unique = new Map<
    PlatformDeployBackendConfig["name"],
    PlatformDeployBackendConfig
  >();
  for (const config of configs) {
    unique.set(config.name, config);
  }
  const entries = Array.from(unique.values());
  const firstEntry = entries[0];
  if (!firstEntry) {
    // unique is populated from configs; configs.length > 0 was checked above.
    throw new Error(
      "deployment backend registry has no entries after deduplication",
    );
  }
  const resolvedDefaultName = defaultName ??
    BACKEND_DEFAULT_ORDER.find((name) => unique.has(name)) ??
    firstEntry.name;

  return {
    defaultName: resolvedDefaultName,
    list() {
      return [...entries];
    },
    get(name: string) {
      return entries.find((entry) => entry.name === name);
    },
  };
}

export function resolveDeploymentBackendConfigsFromEnv(
  env: EnvRecord,
): PlatformDeployBackendConfig[] {
  return [
    createWorkersDispatchConfig(env),
  ].filter((config): config is PlatformDeployBackendConfig => config != null);
}
