import process from "node:process";

type EnvGetter = (key: string) => string | undefined;

function readTrimmedEnv(getEnv: EnvGetter, key: string): string | undefined {
  const value = getEnv(key);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveCloudflareDispatchNamespace(
  getEnv: EnvGetter = (key) => process.env[key],
): string {
  const wfpDispatchNamespace = readTrimmedEnv(getEnv, "WFP_DISPATCH_NAMESPACE");
  const legacyDispatchNamespace = readTrimmedEnv(
    getEnv,
    "CF_DISPATCH_NAMESPACE",
  );

  if (
    wfpDispatchNamespace && legacyDispatchNamespace &&
    wfpDispatchNamespace !== legacyDispatchNamespace
  ) {
    throw new Error(
      "Conflicting Cloudflare dispatch namespace values: WFP_DISPATCH_NAMESPACE and CF_DISPATCH_NAMESPACE differ. Set WFP_DISPATCH_NAMESPACE only.",
    );
  }

  if (wfpDispatchNamespace) {
    return wfpDispatchNamespace;
  }

  if (legacyDispatchNamespace) {
    console.warn(
      "CF_DISPATCH_NAMESPACE is deprecated. Set WFP_DISPATCH_NAMESPACE instead.",
    );
    return legacyDispatchNamespace;
  }

  throw new Error("WFP_DISPATCH_NAMESPACE is required.");
}
