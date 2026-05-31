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

  if (wfpDispatchNamespace) {
    return wfpDispatchNamespace;
  }

  throw new Error("WFP_DISPATCH_NAMESPACE is required.");
}
