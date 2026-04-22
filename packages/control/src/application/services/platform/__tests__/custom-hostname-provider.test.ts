import { assertEquals, assertThrows } from "jsr:@std/assert";

import type { Env } from "../../../../shared/types/index.ts";
import {
  createManagedCustomHostname,
  resolveCustomHostnameProviderName,
} from "../custom-domains/custom-hostname-provider.ts";

Deno.test("custom hostname provider defaults to none unless Cloudflare zone is configured", () => {
  assertEquals(resolveCustomHostnameProviderName({}), "none");
  assertEquals(
    resolveCustomHostnameProviderName({ CF_ZONE_ID: " zone-id " }),
    "cloudflare",
  );
});

Deno.test("custom hostname provider explicit none disables Cloudflare hostname provisioning", async () => {
  const env = {
    CF_ZONE_ID: "zone-id",
    TAKOS_CUSTOM_DOMAIN_TLS_PROVIDER: "none",
  } as Env;

  assertEquals(resolveCustomHostnameProviderName(env), "none");
  assertEquals(await createManagedCustomHostname(env, "docs.example.com"), {
    success: true,
    provider: "none",
  });
});

Deno.test("custom hostname provider explicit Cloudflare requires Cloudflare credentials", async () => {
  const env = {
    CF_ZONE_ID: "zone-id",
    TAKOS_CUSTOM_DOMAIN_TLS_PROVIDER: "cloudflare",
  } as Env;

  assertEquals(resolveCustomHostnameProviderName(env), "cloudflare");
  assertEquals(await createManagedCustomHostname(env, "docs.example.com"), {
    success: false,
    provider: "cloudflare",
    error:
      "Cloudflare custom hostname provider requires CF_ACCOUNT_ID, CF_API_TOKEN, and CF_ZONE_ID",
  });
});

Deno.test("custom hostname provider rejects unknown explicit provider", () => {
  assertThrows(
    () =>
      resolveCustomHostnameProviderName({
        TAKOS_CUSTOM_DOMAIN_TLS_PROVIDER: "route53",
      }),
    Error,
    'TAKOS_CUSTOM_DOMAIN_TLS_PROVIDER must be "cloudflare" or "none"',
  );
});
