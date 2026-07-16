import { afterEach, describe, expect, test } from "bun:test";

import {
  materializeTakosumiServiceGrant,
  serviceGrantDeps,
} from "../service-grants.ts";
import type { Env } from "../../../../shared/types/env.ts";

const originalFetch = serviceGrantDeps.fetch;

afterEach(() => {
  serviceGrantDeps.fetch = originalFetch;
});

const serviceBinding = {
  name: "control",
  capability: "control.api" as const,
  target: "web",
  inject: { baseUrlEnv: "CONTROL_URL", tokenEnv: "CONTROL_TOKEN" },
  scopes: ["installations.outputs.read.same-space" as const],
};

const env = {
  TAKOSUMI_ACCOUNTS_INTERNAL_URL: "https://operator.test/control",
  OIDC_CLIENT_ID: "resource-server",
  OIDC_CLIENT_SECRET: "resource-secret",
} as Env;

describe("canonical Interface service grant reuse", () => {
  test("reuses only an exactly scoped Interface OAuth token", async () => {
    let form: URLSearchParams | null = null;
    serviceGrantDeps.fetch = async (input, init) => {
      expect(String(input)).toBe(
        "https://operator.test/control/oauth/introspect",
      );
      form = new URLSearchParams(String(init?.body));
      return Response.json({
        active: true,
        token_use: "interface_oauth",
        aud: "https://operator.test/control/api/v1",
        scope: "installations.outputs.read.same-space",
        takosumi: {
          workspace_id: "ws_1",
          capsule_id: "cap_1",
          interface_id: "if_1",
          interface_binding_id: "ifb_1",
          interface_resolved_revision: 4,
        },
      });
    };

    await expect(
      materializeTakosumiServiceGrant(env, {
        spaceId: "ws_1",
        installationId: "cap_1",
        workloadName: "web",
        serviceBinding,
        previousToken: "taksrv_current",
      }),
    ).resolves.toEqual({
      baseUrl: "https://operator.test/control/api/v1",
      token: "taksrv_current",
    });
    expect(form?.get("client_id")).toBe("resource-server");
    expect(form?.get("client_secret")).toBe("resource-secret");
    expect(form?.get("resource")).toBe("https://operator.test/control/api/v1");
  });

  test("fails closed for a foreign Workspace or stale binding evidence", async () => {
    serviceGrantDeps.fetch = async () =>
      Response.json({
        active: true,
        token_use: "interface_oauth",
        aud: "https://operator.test/control/api/v1",
        scope: "installations.outputs.read.same-space",
        takosumi: {
          workspace_id: "ws_other",
          capsule_id: "cap_1",
          interface_id: "if_1",
          interface_binding_id: "ifb_1",
          interface_resolved_revision: 4,
        },
      });
    await expect(
      materializeTakosumiServiceGrant(env, {
        spaceId: "ws_1",
        installationId: "cap_1",
        workloadName: "web",
        serviceBinding,
        previousToken: "taksrv_foreign",
      }),
    ).rejects.toThrow("cannot mint a canonical Interface token");
  });

  test("never mints when no current token is supplied", async () => {
    serviceGrantDeps.fetch = async () => {
      throw new Error("must not fetch");
    };
    await expect(
      materializeTakosumiServiceGrant(env, {
        spaceId: "ws_1",
        installationId: "cap_1",
        workloadName: "web",
        serviceBinding,
      }),
    ).rejects.toThrow("cannot mint a canonical Interface token");
  });
});
