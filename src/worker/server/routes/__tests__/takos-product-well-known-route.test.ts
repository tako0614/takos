import { expect, test } from "bun:test";

import { webApp } from "../../../web.ts";

test("Takos product well-known route serves the canonical mobile host document", async () => {
  const response = await webApp.request(
    "https://takos.test/.well-known/takos",
    {},
    {
      PLATFORM: {
        source: "node",
        bindings: {},
        config: {
          adminDomain: "takos.test",
          environment: "development",
        },
        services: {},
      },
    } as never,
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe(
    "public, max-age=300",
  );
  expect(await response.json()).toEqual({
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
      notificationPushers:
        "https://takos.test/api/notifications/pushers",
    },
  });
});
