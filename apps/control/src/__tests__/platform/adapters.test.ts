import {
  buildPlatform,
  createPlatformConfig,
  createPlatformServices,
} from "@/platform/adapters/shared";
import { buildWorkersWebPlatform } from "@/platform/adapters/workers";
import { buildNodeWebPlatform } from "@/platform/adapters/node";

import { assertEquals } from "jsr:@std/assert";

function createBaseBindings(overrides: Record<string, unknown> = {}) {
  return {
    ADMIN_DOMAIN: "admin.example.test",
    TENANT_BASE_DOMAIN: "app.example.test",
    DISPATCHER: {
      get: () => ({
        fetch: async () => new Response("ok"),
      }),
    },
    ...overrides,
  };
}

Deno.test("platform adapters - keeps deploy provider config out of the shared platform builder", () => {
  const bindings = createBaseBindings();
  const platform = buildPlatform(
    "node",
    bindings,
    createPlatformConfig({
      adminDomain: String(bindings.ADMIN_DOMAIN),
      tenantBaseDomain: String(bindings.TENANT_BASE_DOMAIN),
    }),
    createPlatformServices({
      routing: {
        resolveHostname: async () => ({
          target: null,
          tombstone: false,
          source: "store" as const,
        }),
        selectDeploymentTarget: () => null,
        selectRouteRef: () => null,
      },
    }),
  );

  assertEquals(platform.services.deploymentProviders, undefined);
  assertEquals(platform.config.adminDomain, "admin.example.test");
  assertEquals(platform.config.tenantBaseDomain, "app.example.test");
  assertEquals(platform.config.environment, undefined);
  assertEquals(platform.config.googleClientId, undefined);
  assertEquals(platform.config.googleClientSecret, undefined);
  assertEquals(platform.config.platformPrivateKey, undefined);
  assertEquals(platform.config.platformPublicKey, undefined);
  assertEquals(platform.config.encryptionKey, undefined);
  assertEquals(platform.config.serviceInternalJwtIssuer, undefined);
});
Deno.test("platform adapters - attaches a workers-dispatch deploy provider in the workers adapter", () => {
  const platform = buildWorkersWebPlatform(createBaseBindings({
    CF_ACCOUNT_ID: "cf-account",
    CF_API_TOKEN: "cf-token",
    CF_ZONE_ID: "zone-1",
    WFP_DISPATCH_NAMESPACE: "dispatch-ns",
    BROWSER: { connect: ((..._args: any[]) => undefined) as any },
  }) as never);

  assertEquals(platform.services.deploymentProviders?.get("workers-dispatch"), {
    name: "workers-dispatch",
    config: {
      accountId: "cf-account",
      apiToken: "cf-token",
      zoneId: "zone-1",
      dispatchNamespace: "dispatch-ns",
    },
  });
  assertEquals(
    platform.services.deploymentProviders?.defaultName,
    "workers-dispatch",
  );
  assertEquals(typeof platform.services.documents.renderPdf, "function");
});
Deno.test("platform adapters - attaches deploy providers in the node adapter", async () => {
  const platform = await buildNodeWebPlatform(createBaseBindings({
    OCI_ORCHESTRATOR_URL: "http://orchestrator.internal",
    OCI_ORCHESTRATOR_TOKEN: "secret-token",
    AWS_ECS_REGION: "us-east-1",
    AWS_ECS_CLUSTER_ARN: "arn:aws:ecs:us-east-1:123456789012:cluster/takos",
    AWS_ECS_TASK_DEFINITION_FAMILY: "takos-worker",
    AWS_ECS_SERVICE_NAME: "takos-web",
    AWS_ECS_CONTAINER_NAME: "app",
    AWS_ECS_SUBNET_IDS: "subnet-a,subnet-b",
    AWS_ECS_SECURITY_GROUP_IDS: "sg-1",
    AWS_ECS_ASSIGN_PUBLIC_IP: "true",
    AWS_ECS_LAUNCH_TYPE: "FARGATE",
    AWS_ECS_DESIRED_COUNT: "2",
    AWS_ECS_BASE_URL: "https://ecs.example.test",
    AWS_ECS_HEALTH_URL: "https://ecs.example.test/healthz",
    GCP_PROJECT_ID: "takos-project",
    GCP_CLOUD_RUN_REGION: "us-central1",
    GCP_CLOUD_RUN_SERVICE_ID: "takos-worker",
    GCP_CLOUD_RUN_SERVICE_ACCOUNT:
      "takos-runtime@takos-project.iam.gserviceaccount.com",
    GCP_CLOUD_RUN_INGRESS: "internal-and-cloud-load-balancing",
    GCP_CLOUD_RUN_ALLOW_UNAUTHENTICATED: "false",
    GCP_CLOUD_RUN_BASE_URL: "https://run.example.test",
    GCP_CLOUD_RUN_DELETE_ON_REMOVE: "true",
    K8S_NAMESPACE: "takos",
    K8S_DEPLOYMENT_NAME: "takos-worker",
  }) as never);

  assertEquals(platform.services.deploymentProviders?.list(), [
    {
      name: "ecs",
      config: {
        region: "us-east-1",
        clusterArn: "arn:aws:ecs:us-east-1:123456789012:cluster/takos",
        taskDefinitionFamily: "takos-worker",
        serviceName: "takos-web",
        containerName: "app",
        subnetIds: ["subnet-a", "subnet-b"],
        securityGroupIds: ["sg-1"],
        assignPublicIp: true,
        launchType: "FARGATE",
        desiredCount: 2,
        baseUrl: "https://ecs.example.test",
        healthUrl: "https://ecs.example.test/healthz",
      },
    },
    {
      name: "cloud-run",
      config: {
        projectId: "takos-project",
        region: "us-central1",
        serviceId: "takos-worker",
        serviceAccount: "takos-runtime@takos-project.iam.gserviceaccount.com",
        ingress: "internal-and-cloud-load-balancing",
        allowUnauthenticated: false,
        baseUrl: "https://run.example.test",
        deleteOnRemove: true,
      },
    },
    {
      name: "k8s",
      config: {
        namespace: "takos",
        deploymentName: "takos-worker",
      },
    },
    {
      name: "oci",
      config: {
        orchestratorUrl: "http://orchestrator.internal",
        orchestratorToken: "secret-token",
      },
    },
  ]);
  assertEquals(platform.services.deploymentProviders?.defaultName, "ecs");
  assertEquals(platform.services.documents.renderPdf, undefined);
});
