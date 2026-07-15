import { expect, test } from "bun:test";
import {
  createTakosDistributionProductCapabilities,
  createTakosDistributionWellKnown,
  createTakosProductWellKnown,
} from "../takosumi-discovery.ts";

test("Takos distribution discovery avoids Takosumi control-plane claims", () => {
  const discovery = createTakosDistributionWellKnown("https://takos.test");
  expect(discovery.endpoints.capabilities).toBe(
    "https://takos.test/v1/capabilities",
  );
  expect(discovery.features.oidc).toBe(false);
  expect(discovery.features.stacks).toBe(false);
  expect(discovery.features.opentofu_runner).toBe(false);
  expect(discovery.features.resource_shapes).toBe(false);

  const capabilities =
    createTakosDistributionProductCapabilities("https://takos.test");
  expect(capabilities.identity.oidc_issuer).toBe(false);
  expect(capabilities.resources.Stack).toBe(false);
  expect(capabilities.adapters.opentofu).toBe(false);
  expect(capabilities.resources.EdgeWorker).toBe(false);
});

test("Takos product well-known exposes mobile host discovery endpoints", () => {
  const discovery = createTakosProductWellKnown("https://takos.test/");
  expect(discovery).toEqual({
    product: "takos",
    name: "Takos",
    issuer: "https://takos.test",
    apiBaseUrl: "https://takos.test",
    endpoints: {
      api: "https://takos.test/api",
      currentUser: "https://takos.test/api/auth/me",
      spaces: "https://takos.test/api/spaces",
      apps: "https://takos.test/api/apps",
      notifications: "https://takos.test/api/notifications",
      notificationPushers: "https://takos.test/api/notifications/pushers",
    },
  });
});
