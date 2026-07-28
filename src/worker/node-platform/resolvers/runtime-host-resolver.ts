import { createForwardingFetcher } from "../../local-platform/url-registry.ts";
import type { PlatformServiceBinding } from "../../platform/platform-config.ts";
import { optionalEnv } from "./env-utils.ts";

const RUNTIME_HOST_URL_ENV_KEYS = [
  "TAKOS_RUNTIME_HOST_URL",
  "TAKOS_LOCAL_RUNTIME_HOST_URL",
  "TAKOS_LOCAL_RUNTIME_URL",
] as const;

/**
 * Resolve the Node/self-host runtime backend into the same fetch binding the
 * session routes consume on Workers.
 *
 * `TAKOS_RUNTIME_HOST_URL` is the canonical backend-neutral setting. The two
 * local aliases remain accepted because the worker loop and dispatch resolver
 * historically used different names.
 */
export function resolveRuntimeHostBinding():
  | PlatformServiceBinding
  | undefined {
  const baseUrl = RUNTIME_HOST_URL_ENV_KEYS
    .map((key) => optionalEnv(key))
    .find((value): value is string => value !== undefined);
  if (!baseUrl) return undefined;

  const forwarding = createForwardingFetcher(baseUrl);
  return {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const request = input instanceof Request
        ? input
        : new Request(input, init);
      return forwarding.fetch(request);
    },
  };
}
