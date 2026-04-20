import { assertEquals } from "jsr:@std/assert";

import { compileGroupDesiredState } from "../group-state.ts";
import {
  captureManagedWorkloadDesiredState,
  restoreManagedWorkloadDesiredState,
  syncGroupManagedDesiredState,
} from "../group-managed-desired-state.ts";

Deno.test(
  "syncGroupManagedDesiredState merges linked common env into workload env vars",
  async () => {
    const desiredState = compileGroupDesiredState({
      name: "demo",
      compute: {
        web: {
          kind: "worker",
        },
      },
      routes: [],
      publish: [],
      env: {
        ROOT_ONLY: "root",
      },
    });

    let capturedVariables: Array<
      { name: string; value: string; secret?: boolean }
    > = [];
    const emptyRowsQuery = {
      all: async () => [],
      orderBy: () => emptyRowsQuery,
      then: (
        resolve: (value: unknown[]) => void,
        reject: (reason?: unknown) => void,
      ) => Promise.resolve([]).then(resolve, reject),
    };
    const result = await syncGroupManagedDesiredState(
      {
        DB: {
          select: () => ({
            from: () => ({
              where: () => emptyRowsQuery,
            }),
          }),
          insert: () => ({
            values: () => ({
              run: async () => undefined,
            }),
          }),
          update: () => ({
            set: () => ({
              where: () => ({
                run: async () => undefined,
              }),
            }),
          }),
          delete: () => ({
            where: () => ({
              run: async () => undefined,
            }),
          }),
        } as never,
        ENCRYPTION_KEY: "test-key",
      } as never,
      {
        spaceId: "space-1",
        desiredState,
        observedState: {
          groupId: "group-1",
          groupName: "demo",
          backend: "cloudflare",
          env: "default",
          updatedAt: "2026-04-20T00:00:00.000Z",
          resources: {},
          workloads: {
            web: {
              serviceId: "service-1",
              name: "web",
              category: "worker",
              status: "active",
              updatedAt: "2026-04-20T00:00:00.000Z",
            },
          },
          routes: {},
        },
        resourceRows: [],
      },
      {
        createDesiredStateService: () => ({
          listLocalEnvVars: async () => [],
          replaceLocalEnvVars: async (params) => {
            capturedVariables = params.variables;
          },
        }),
        previewServiceConsumeEnvVars: async () => [],
        replaceManifestPublications: async () => undefined,
        replaceServiceConsumes: async () => [],
        resolveServiceConsumeEnvVars: async () => [],
        resolveLinkedCommonEnvState: async () => ({
          envBindings: [
            { type: "plain_text", name: "SHARED", text: "linked-value" },
          ],
          envVars: { SHARED: "linked-value" },
          commonEnvUpdates: [],
        }),
      },
    );

    assertEquals(result, []);
    assertEquals(
      capturedVariables.some((entry) =>
        entry.name === "SHARED" &&
        entry.value === "linked-value"
      ),
      true,
    );
  },
);

Deno.test(
  "captureManagedWorkloadDesiredState and restoreManagedWorkloadDesiredState round-trip local env vars",
  async () => {
    const serviceEnvVars = new Map<
      string,
      Array<{
        name: string;
        value: string;
        secret: boolean;
      }>
    >();
    serviceEnvVars.set("service-1", [
      { name: "OLD", value: "old-value", secret: false },
    ]);

    const deps = {
      createDesiredStateService: () => ({
        listLocalEnvVars: async (_spaceId: string, serviceId: string) =>
          (serviceEnvVars.get(serviceId) ?? []).map((row) => ({
            ...row,
            updated_at: "2026-04-20T00:00:00.000Z",
          })),
        replaceLocalEnvVars: async (params: {
          serviceId?: string;
          workerId?: string;
          variables: Array<{ name: string; value: string; secret?: boolean }>;
        }) => {
          const serviceId = params.serviceId ?? params.workerId;
          if (!serviceId) {
            throw new Error("missing service identifier");
          }
          serviceEnvVars.set(
            serviceId,
            params.variables.map((variable) => ({
              name: variable.name,
              value: variable.value,
              secret: variable.secret === true,
            })),
          );
        },
      }),
      listServiceConsumes: async () => [],
      replaceServiceConsumes: async () => [],
    };

    const snapshot = await captureManagedWorkloadDesiredState(
      {
        DB: {} as never,
      } as never,
      {
        spaceId: "space-1",
        serviceId: "service-1",
        serviceName: "demo:web",
      },
      deps,
    );

    assertEquals(snapshot.localEnvVars, [
      { name: "OLD", value: "old-value", secret: false },
    ]);

    serviceEnvVars.set("service-1", [
      { name: "NEW", value: "new-value", secret: false },
    ]);

    await restoreManagedWorkloadDesiredState(
      {
        DB: {} as never,
      } as never,
      snapshot,
      deps,
    );

    assertEquals(serviceEnvVars.get("service-1"), [
      { name: "OLD", value: "old-value", secret: false },
    ]);
  },
);
