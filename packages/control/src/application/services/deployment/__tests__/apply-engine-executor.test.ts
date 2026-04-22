import { assertEquals, assertRejects } from "jsr:@std/assert";

import { compileGroupDesiredState } from "../group-state.ts";
import {
  executeApplyEntry,
  prepareWorkloadApplyEntries,
} from "../apply-engine-executor.ts";

Deno.test(
  "executeApplyEntry restores workload desired state when deployment fails after sync",
  async () => {
    const serviceEnvVars = new Map<
      string,
      Array<{
        name: string;
        value: string;
        secret: boolean;
      }>
    >();
    serviceEnvVars.set("service-web", [
      { name: "OLD", value: "old-value", secret: false },
    ]);

    const managedServices = new Map<string, {
      row: {
        id: string;
        accountId: string;
        groupId: string;
        serviceType: string;
        status: string;
        config: string;
        hostname: string | null;
        routeRef: string | null;
        slug: string;
        workloadKind: string;
        createdAt: string;
        updatedAt: string;
      };
      config: {
        managedBy: "group";
        envName: string;
        manifestName: string;
        componentKind: "worker";
        specFingerprint: string;
        desiredSpec: Record<string, unknown>;
      };
    }>();

    const deps = {
      ...{
        createDesiredStateService: () => ({
          listLocalEnvVars: async (_spaceId: string, serviceId: string) =>
            serviceEnvVars.get(serviceId) ?? [],
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
      },
      captureManagedWorkloadDesiredState: async (
        _env: never,
        params: {
          spaceId: string;
          serviceId: string;
          serviceName: string;
        },
      ) => ({
        spaceId: params.spaceId,
        serviceId: params.serviceId,
        serviceName: params.serviceName,
        consumes: [],
        resourceBindings: [],
        localEnvVars: serviceEnvVars.get(params.serviceId) ?? [],
      }),
      restoreManagedWorkloadDesiredState: async (
        _env: never,
        snapshot: {
          spaceId: string;
          serviceId: string;
          serviceName: string;
          consumes: Array<{ publication: string }>;
          resourceBindings: Array<{
            name: string;
            type: string;
            resourceId: string;
          }>;
          localEnvVars: Array<{
            name: string;
            value: string;
            secret: boolean;
          }>;
        },
      ) => {
        serviceEnvVars.set(snapshot.serviceId, snapshot.localEnvVars);
      },
      listResources: async () => [],
      createResource: async () => undefined,
      deleteResource: async () => undefined,
      updateManagedResource: async () => undefined,
      createServiceBinding: async () => undefined,
      deleteServiceBinding: async () => undefined,
      deleteWorker: async () => undefined,
      deleteContainer: async () => undefined,
      deleteService: async () => undefined,
      upsertGroupManagedService: async (
        _env: never,
        input: {
          groupId: string;
          spaceId: string;
          envName: string;
          componentKind: "worker";
          manifestName: string;
          status: string;
          serviceType: "app" | "service";
          workloadKind: string;
          specFingerprint: string;
          desiredSpec: Record<string, unknown>;
          routeNames?: string[];
          dependsOn?: string[];
          deployedAt?: string;
          codeHash?: string;
          imageHash?: string;
          imageRef?: string;
          port?: number;
          ipv4?: string;
          dispatchNamespace?: string;
          resolvedBaseUrl?: string;
        },
      ) => {
        const row = {
          id: `service-${input.manifestName}`,
          accountId: input.spaceId,
          groupId: input.groupId,
          serviceType: input.serviceType,
          status: input.status,
          config: JSON.stringify({
            managedBy: "group",
            envName: input.envName,
            manifestName: input.manifestName,
            componentKind: input.componentKind,
            specFingerprint: input.specFingerprint,
            desiredSpec: input.desiredSpec,
          }),
          hostname: null,
          routeRef: `route-${input.manifestName}`,
          slug: `slug-${input.manifestName}`,
          workloadKind: input.workloadKind,
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-20T00:00:00.000Z",
        };
        const record = {
          row,
          config: {
            managedBy: "group" as const,
            envName: input.envName,
            manifestName: input.manifestName,
            componentKind: input.componentKind,
            specFingerprint: input.specFingerprint,
            desiredSpec: input.desiredSpec,
          },
        };
        managedServices.set(input.manifestName, record);
        return record;
      },
      DeploymentService: class {
        constructor(_env: never) {}
        async createDeployment(params: { serviceId: string }) {
          return {
            id: params.serviceId,
          };
        }
        async executeDeployment(_deploymentId: string) {
          throw new Error("deployment failed");
        }
      },
      syncGroupManagedDesiredState: async (
        _env: never,
        input: {
          desiredState: ReturnType<typeof compileGroupDesiredState>;
          observedState: {
            workloads: Record<string, { serviceId: string }>;
          };
          targetWorkloadNames?: string[];
        },
      ) => {
        for (
          const workloadName of input.targetWorkloadNames ?? Object.keys(
            input.desiredState.workloads,
          )
        ) {
          const workload = input.desiredState.workloads[workloadName];
          const observedWorkload = input.observedState.workloads[workloadName];
          if (!workload || !observedWorkload) continue;
          const spec = workload.spec as { env?: Record<string, string> };
          serviceEnvVars.set(observedWorkload.serviceId, [
            ...Object.entries(input.desiredState.manifest.env ?? {}).map((
              [name, value],
            ) => ({
              name,
              value,
              secret: false,
            })),
            ...Object.entries(spec.env ?? {}).map(([name, value]) => ({
              name,
              value,
              secret: false,
            })),
          ]);
        }
        return [];
      },
      reconcileGroupRouting: async () => ({
        appliedRoutes: [],
        failedRoutes: [],
      }),
      previewServiceConsumeEnvVars: async () => [],
      replaceManifestPublications: async () => undefined,
      replaceServiceConsumes: async () => [],
      resolveServiceConsumeEnvVars: async () => [],
      resolveLinkedCommonEnvState: async () => ({
        envBindings: [],
        envVars: {},
        commonEnvUpdates: [],
      }),
    } satisfies Record<string, unknown>;

    const desiredState = compileGroupDesiredState({
      name: "demo",
      compute: {
        web: {
          kind: "worker",
          env: {
            APP_ONLY: "from-spec",
          },
        },
      },
      routes: [],
      publish: [],
      env: {
        ROOT_ONLY: "root-value",
      },
    });

    const group = {
      id: "group-1",
      spaceId: "space-1",
      name: "demo",
      backend: "cloudflare",
      env: "default",
    };

    const getGroupState = async () => ({
      groupId: group.id,
      groupName: group.name,
      backend: group.backend,
      env: group.env,
      updatedAt: "2026-04-20T00:00:00.000Z",
      resources: {},
      workloads: Object.fromEntries(
        Array.from(managedServices.values()).map((record) => [
          record.config.manifestName,
          {
            serviceId: record.row.id,
            name: record.config.manifestName,
            category: record.config.componentKind,
            status: record.row.status,
            routeRef: record.row.routeRef ?? undefined,
            updatedAt: record.row.updatedAt,
          },
        ]),
      ),
      routes: {},
    });

    await assertRejects(
      () =>
        executeApplyEntry(
          deps as never,
          getGroupState,
          {
            DB: {} as never,
          } as never,
          {
            entry: {
              name: "web",
              category: "worker",
              action: "create",
            },
            desiredState,
            groupId: group.id,
            group,
            opts: {
              artifacts: {
                web: {
                  kind: "worker_bundle",
                  bundleContent: "export default {};",
                },
              },
            },
          },
        ),
      Error,
      "deployment failed",
    );

    assertEquals(serviceEnvVars.get("service-web"), [
      { name: "OLD", value: "old-value", secret: false },
    ]);
  },
);

Deno.test(
  "prepareWorkloadApplyEntries upserts all changed workloads before publication sync",
  async () => {
    const prepared: string[] = [];
    const deps = {
      upsertGroupManagedService: async (
        _env: never,
        input: {
          manifestName: string;
          componentKind: string;
          status: string;
        },
      ) => {
        prepared.push(
          `${input.manifestName}:${input.componentKind}:${input.status}`,
        );
        return {
          row: {
            id: `svc_${input.manifestName}`,
          },
          config: {
            manifestName: input.manifestName,
            componentKind: input.componentKind,
          },
        };
      },
    };
    const desiredState = compileGroupDesiredState({
      name: "demo",
      compute: {
        web: { kind: "worker" },
        api: {
          kind: "service",
          image:
            "ghcr.io/example/api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        },
      },
      routes: [{ target: "api", path: "/api" }],
      publish: [{
        name: "api-url",
        publisher: "api",
        type: "UiSurface",
        outputs: { url: { route: "/api" } },
      }],
      env: {},
    });

    const failures = await prepareWorkloadApplyEntries(
      deps as never,
      {} as never,
      {
        entries: [
          { name: "web", category: "worker", action: "create" },
          { name: "api", category: "service", action: "create" },
          { name: "route.api./api", category: "route", action: "create" },
        ],
        desiredState,
        groupId: "group_1",
        group: {
          id: "group_1",
          spaceId: "space_1",
          name: "demo",
          backend: "cloudflare",
          env: "default",
        },
        envName: "default",
      },
    );

    assertEquals(failures, []);
    assertEquals(prepared, [
      "web:worker:pending",
      "api:service:pending",
    ]);
  },
);
