/**
 * Local-substrate connector factory.
 *
 * Replaces takosumi/packages/runtime-agent/src/connectors/factory.ts's
 * `buildConnectorRegistry` for the local-substrate test bed. The key
 * difference is **import-time deny** of public-DNS providers:
 *
 *   - `@takos/aws-route53` — NOT imported, NOT registerable
 *   - `@takos/gcp-cloud-dns` — NOT imported, NOT registerable
 *   - `@takos/cloudflare-dns` — NOT imported, NOT registerable
 *
 * Manifests requesting these providers fail with `provider_not_registered`
 * because the connectors literally don't exist in this binary. Set this in
 * concert with Pebble (ACME pinned to local) and CoreDNS NXDOMAIN of
 * Let's Encrypt prod to make public exposure structurally impossible.
 *
 * Real cloud compute (Fargate / Cloud Run / Container Apps / Cloudflare
 * Container) IS allowed when its credentials are present in env. Only the
 * publish-to-internet surface (DNS) is denied.
 */
import { ConnectorRegistry } from '/workspace/packages/runtime-agent/src/connectors/connector.ts';
import { AwsS3Connector } from '/workspace/packages/runtime-agent/src/connectors/aws/s3.ts';
import { AwsFargateConnector } from '/workspace/packages/runtime-agent/src/connectors/aws/fargate.ts';
import { AwsRdsConnector } from '/workspace/packages/runtime-agent/src/connectors/aws/rds.ts';
// Route53Connector intentionally NOT imported — public DNS deny.
import { GcpGcsConnector } from '/workspace/packages/runtime-agent/src/connectors/gcp/gcs.ts';
import { CloudRunConnector } from '/workspace/packages/runtime-agent/src/connectors/gcp/cloud_run.ts';
import { CloudSqlConnector } from '/workspace/packages/runtime-agent/src/connectors/gcp/cloud_sql.ts';
// CloudDnsConnector intentionally NOT imported — public DNS deny.
import { CloudflareR2Connector } from '/workspace/packages/runtime-agent/src/connectors/cloudflare/r2.ts';
import { CloudflareContainerConnector } from '/workspace/packages/runtime-agent/src/connectors/cloudflare/container.ts';
import { CloudflareWorkersConnector } from '/workspace/packages/runtime-agent/src/connectors/cloudflare/workers.ts';
// CloudflareDnsConnector intentionally NOT imported — public DNS deny.
import { DenoDeployWorkersConnector } from '/workspace/packages/runtime-agent/src/connectors/deno_deploy/workers.ts';
import { AzureContainerAppsConnector } from '/workspace/packages/runtime-agent/src/connectors/azure/container_apps.ts';
import { K3sDeploymentConnector } from '/workspace/packages/runtime-agent/src/connectors/kubernetes/k3s_deployment.ts';
import { CorednsLocalConnector } from '/workspace/packages/runtime-agent/src/connectors/selfhost/coredns_local.ts';
import { DockerComposeConnector } from '/workspace/packages/runtime-agent/src/connectors/selfhost/docker_compose.ts';
import { FilesystemConnector } from '/workspace/packages/runtime-agent/src/connectors/selfhost/filesystem.ts';
import { LocalDockerPostgresConnector } from '/workspace/packages/runtime-agent/src/connectors/selfhost/local_docker_postgres.ts';
import { MinioConnector } from '/workspace/packages/runtime-agent/src/connectors/selfhost/minio.ts';
import { SystemdUnitConnector } from '/workspace/packages/runtime-agent/src/connectors/selfhost/systemd_unit.ts';

export function buildLocalSubstrateRegistry(
  env: Record<string, string | undefined>,
): ConnectorRegistry {
  const reg = new ConnectorRegistry();

  // ===== Always-on selfhost connectors =====
  reg.register(
    new FilesystemConnector({
      rootDir: env.TAKOSUMI_SELFHOSTED_OBJECT_STORE_ROOT ??
        '/var/lib/takosumi/objects',
    }),
  );
  reg.register(
    new DockerComposeConnector({
      hostBinding: env.TAKOSUMI_SELFHOSTED_DOCKER_HOST_BINDING,
    }),
  );
  reg.register(
    new SystemdUnitConnector({
      unitDir: env.TAKOSUMI_SELFHOSTED_SYSTEMD_UNIT_DIR,
    }),
  );
  reg.register(
    new MinioConnector({
      endpoint: env.TAKOSUMI_SELFHOSTED_OBJECT_STORE_ENDPOINT ??
        'http://minio:9000',
    }),
  );
  reg.register(
    new CorednsLocalConnector({
      zoneFile: env.TAKOSUMI_SELFHOSTED_COREDNS_FILE ??
        '/etc/coredns/zones/takos.test.zone',
    }),
  );
  reg.register(
    new LocalDockerPostgresConnector({
      hostBinding: env.TAKOSUMI_SELFHOSTED_POSTGRES_HOST,
    }),
  );

  // ===== AWS (storage + compute, NO Route53) =====
  if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
    const region = env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? 'us-east-1';
    const credentials = {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      ...(env.AWS_SESSION_TOKEN ? { sessionToken: env.AWS_SESSION_TOKEN } : {}),
    };
    reg.register(new AwsS3Connector({ region, credentials }));
    reg.register(
      new AwsFargateConnector({
        region,
        credentials,
        clusterName: env.AWS_FARGATE_CLUSTER_NAME ?? 'takos-local',
        subnetIds: parseList(env.AWS_FARGATE_SUBNET_IDS),
        ...(env.AWS_FARGATE_SECURITY_GROUP_IDS
          ? { securityGroupIds: parseList(env.AWS_FARGATE_SECURITY_GROUP_IDS) }
          : {}),
        ...(env.AWS_FARGATE_EXECUTION_ROLE_ARN ? { executionRoleArn: env.AWS_FARGATE_EXECUTION_ROLE_ARN } : {}),
        ...(env.AWS_FARGATE_TASK_ROLE_ARN ? { taskRoleArn: env.AWS_FARGATE_TASK_ROLE_ARN } : {}),
        ...(env.AWS_FARGATE_ASSIGN_PUBLIC_IP === 'true' ? { assignPublicIp: true } : {}),
      }),
    );
    reg.register(
      new AwsRdsConnector({
        region,
        credentials,
        ...(env.AWS_RDS_SUBNET_GROUP ? { subnetGroupName: env.AWS_RDS_SUBNET_GROUP } : {}),
        ...(env.AWS_RDS_SECURITY_GROUP_IDS ? { securityGroupIds: parseList(env.AWS_RDS_SECURITY_GROUP_IDS) } : {}),
      }),
    );
    // Route53 — INTENTIONALLY skipped. Use selfhost coredns-local instead.
  }

  // ===== GCP (storage + compute, NO Cloud DNS) =====
  if (env.GOOGLE_CLOUD_PROJECT && env.GCP_BEARER_TOKEN) {
    const project = env.GOOGLE_CLOUD_PROJECT;
    const region = env.GOOGLE_CLOUD_REGION ?? 'us-central1';
    const bearerToken = env.GCP_BEARER_TOKEN;
    reg.register(
      new GcpGcsConnector({ project, defaultLocation: region, bearerToken }),
    );
    reg.register(new CloudRunConnector({ project, region, bearerToken }));
    reg.register(new CloudSqlConnector({ project, region, bearerToken }));
    // Cloud DNS — INTENTIONALLY skipped.
  }

  // ===== Cloudflare (workers + r2 + container, NO DNS) =====
  if (env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID) {
    const accountId = env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = env.CLOUDFLARE_API_TOKEN;
    reg.register(new CloudflareR2Connector({ accountId, apiToken }));
    reg.register(new CloudflareContainerConnector({ accountId, apiToken }));
    reg.register(new CloudflareWorkersConnector({ accountId, apiToken }));
    // Cloudflare DNS — INTENTIONALLY skipped.
  }

  // ===== Deno Deploy =====
  if (env.DENO_DEPLOY_ACCESS_TOKEN) {
    reg.register(
      new DenoDeployWorkersConnector({
        accessToken: env.DENO_DEPLOY_ACCESS_TOKEN,
        ...(env.DENO_DEPLOY_ORGANIZATION_ID ? { organizationId: env.DENO_DEPLOY_ORGANIZATION_ID } : {}),
      }),
    );
  }

  // ===== Azure (compute only) =====
  if (
    env.AZURE_SUBSCRIPTION_ID &&
    env.AZURE_RESOURCE_GROUP &&
    env.AZURE_BEARER_TOKEN
  ) {
    const region = env.AZURE_LOCATION ?? 'eastus';
    const environmentName = env.AZURE_CONTAINER_APPS_ENV_NAME ?? 'takos-local';
    const environmentResourceId = env.AZURE_CONTAINER_APPS_ENV_RESOURCE_ID ??
      `/subscriptions/${env.AZURE_SUBSCRIPTION_ID}/resourceGroups/${env.AZURE_RESOURCE_GROUP}/providers/Microsoft.App/managedEnvironments/${environmentName}`;
    reg.register(
      new AzureContainerAppsConnector({
        subscriptionId: env.AZURE_SUBSCRIPTION_ID,
        resourceGroup: env.AZURE_RESOURCE_GROUP,
        region,
        environmentName,
        environmentResourceId,
        bearerToken: env.AZURE_BEARER_TOKEN,
      }),
    );
  }

  // ===== Kubernetes (k3d / external cluster) =====
  if (
    env.TAKOSUMI_KUBERNETES_API_SERVER_URL &&
    env.TAKOSUMI_KUBERNETES_BEARER_TOKEN
  ) {
    reg.register(
      new K3sDeploymentConnector({
        apiServerUrl: env.TAKOSUMI_KUBERNETES_API_SERVER_URL,
        bearerToken: env.TAKOSUMI_KUBERNETES_BEARER_TOKEN,
        namespace: env.TAKOSUMI_KUBERNETES_NAMESPACE ?? 'takos-local',
        ...(env.TAKOSUMI_KUBERNETES_CLUSTER_DOMAIN ? { clusterDomain: env.TAKOSUMI_KUBERNETES_CLUSTER_DOMAIN } : {}),
      }),
    );
  }

  return reg;
}

function parseList(raw: string | undefined): readonly string[] {
  if (!raw) return [];
  return raw.split(/[,\s]+/u).map((s) => s.trim()).filter(Boolean);
}
