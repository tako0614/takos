import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appRoot = resolve(import.meta.dirname, '../..');
const prismaSchema = readFileSync(resolve(appRoot, 'db/prisma/schema.prisma'), 'utf8');

function extractServiceModel(source: string): string {
  const match = source.match(/model Service \{([\s\S]*?)\n\}/);
  if (!match) {
    throw new Error('Missing Service model in Prisma schema');
  }
  return match[1];
}

function extractServiceRuntimeModel(source: string): string {
  const match = source.match(/model ServiceRuntime \{([\s\S]*?)\n\}/);
  if (!match) {
    throw new Error('Missing ServiceRuntime model in Prisma schema');
  }
  return match[1];
}

describe('Prisma Service model contract', () => {
  it('uses service-centric logical field names while preserving mapped columns', () => {
    const serviceModel = extractServiceModel(prismaSchema);

    expect(serviceModel).toContain('serviceType  String  @default("app")  @map("service_type")');
    expect(serviceModel).toContain('routeRef  String?  @unique  @map("route_ref")');
    expect(serviceModel).toContain('activeDeploymentId  String?  @map("active_deployment_id")');
    expect(serviceModel).toContain('fallbackDeploymentId  String?  @map("fallback_deployment_id")');
    expect(serviceModel).toContain('activeDeployment  Deployment?  @relation("ServiceActiveDeployment", fields: [activeDeploymentId], references: [id])');
    expect(serviceModel).toContain('serviceBindings  ServiceBinding[]');
    expect(serviceModel).toContain('serviceCommonEnvLinks  ServiceCommonEnvLink[]');
    expect(serviceModel).toContain('serviceEnvVars  ServiceEnvVar[]');
    expect(serviceModel).toContain('serviceRuntimeSettings  ServiceRuntimeSetting?');

    expect(serviceModel).not.toContain('workerName  String?');
    expect(serviceModel).not.toContain('workerType  String');
    expect(serviceModel).not.toContain('currentDeploymentId  String?');
    expect(serviceModel).not.toContain('previousDeploymentId  String?');

    expect(prismaSchema).toContain('@@map("services")');
    expect(prismaSchema).not.toContain('@@map("workers")');
  });
});

describe('Prisma ServiceRuntime model contract', () => {
  it('uses service-centric logical naming with the service_runtimes physical mapping', () => {
    const serviceRuntimeModel = extractServiceRuntimeModel(prismaSchema);

    expect(serviceRuntimeModel).toContain('cloudflareServiceRef  String?  @map("cloudflare_service_ref")');
    expect(serviceRuntimeModel).toContain('bundleDeployment  BundleDeployment?');
    expect(serviceRuntimeModel).toContain('account  Account');

    expect(prismaSchema).toContain('serviceRuntimes  ServiceRuntime[]');
    expect(prismaSchema).toContain('model ServiceRuntime {');
    expect(prismaSchema).toContain('@@map("service_runtimes")');
    expect(prismaSchema).not.toContain('@@map("infra_workers")');
    expect(prismaSchema).not.toContain('model InfraWorker {');
    expect(prismaSchema).not.toContain('infraWorkers  InfraWorker[]');
  });
});
