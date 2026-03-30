import fs from 'node:fs/promises';
import { api } from './api.js';

export type ApiServiceType = 'app' | 'service';

export interface ApiServiceRecord {
  id: string;
  slug: string | null;
  group_id?: string | null;
  service_type: ApiServiceType;
  status: string;
  hostname: string | null;
  service_name: string | null;
  workspace_name?: string;
}

export interface ApiResourceRecord {
  id: string;
  name: string;
  group_id?: string | null;
  type: string;
  status: string;
  provider_resource_id?: string | null;
  provider_resource_name?: string | null;
  config?: string | null;
  metadata?: string | null;
}

export interface ApiGroupRecord {
  id: string;
  name: string;
  env?: string | null;
  provider?: string | null;
}

function requireApiData<T>(result: Awaited<ReturnType<typeof api<T>>>): T {
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.data;
}

export function slugifySurfaceName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

export async function readUtf8File(path: string): Promise<string> {
  return fs.readFile(path, 'utf8');
}

export async function listServicesInSpace(spaceId: string): Promise<ApiServiceRecord[]> {
  const data = requireApiData(await api<{ services: ApiServiceRecord[] }>(
    `/api/services/space/${encodeURIComponent(spaceId)}`,
  ));
  return data.services;
}

export async function findServiceInSpace(
  spaceId: string,
  name: string,
  serviceType?: ApiServiceType,
): Promise<ApiServiceRecord | null> {
  const services = await listServicesInSpace(spaceId);
  const slug = slugifySurfaceName(name);
  return services.find((service) => {
    if (serviceType && service.service_type !== serviceType) return false;
    return service.id === name || service.slug === name || service.slug === slug || service.service_name === name;
  }) ?? null;
}

export async function ensureServiceInSpace(input: {
  spaceId: string;
  name: string;
  serviceType: ApiServiceType;
  groupId?: string | null;
  config?: Record<string, unknown>;
}): Promise<ApiServiceRecord> {
  const existing = await findServiceInSpace(input.spaceId, input.name, input.serviceType);
  if (existing) return existing;

  const created = requireApiData(await api<{ service: ApiServiceRecord | null }>(
    '/api/services',
    {
      method: 'POST',
      body: {
        space_id: input.spaceId,
        group_id: input.groupId ?? null,
        service_type: input.serviceType,
        slug: slugifySurfaceName(input.name),
        ...(input.config ? { config: JSON.stringify(input.config) } : {}),
      },
    },
  ));

  if (!created.service) {
    throw new Error('Service creation returned no service record');
  }

  return created.service;
}

export async function createWorkerDeployment(input: {
  serviceId: string;
  bundle: string;
  deployMessage?: string;
}): Promise<{
  deployment: {
    id: string;
    version: number;
    status: string;
    deploy_state: string;
    artifact_kind: string;
    routing_status: string;
    routing_weight: number;
    created_at: string;
  };
}> {
  return requireApiData(await api<{
    deployment: {
      id: string;
      version: number;
      status: string;
      deploy_state: string;
      artifact_kind: string;
      routing_status: string;
      routing_weight: number;
      created_at: string;
    };
  }>(`/api/services/${encodeURIComponent(input.serviceId)}/deployments`, {
    method: 'POST',
    body: {
      bundle: input.bundle,
      ...(input.deployMessage ? { deploy_message: input.deployMessage } : {}),
    },
    timeout: 120_000,
  }));
}

export async function createServiceDeployment(input: {
  serviceId: string;
  imageRef: string;
  port: number;
  provider: 'oci' | 'ecs' | 'cloud-run' | 'k8s';
  healthPath?: string;
  deployMessage?: string;
}): Promise<{
  deployment: {
    id: string;
    version: number;
    status: string;
    deploy_state: string;
    artifact_kind: string;
    routing_status: string;
    routing_weight: number;
    created_at: string;
  };
}> {
  return requireApiData(await api<{
    deployment: {
      id: string;
      version: number;
      status: string;
      deploy_state: string;
      artifact_kind: string;
      routing_status: string;
      routing_weight: number;
      created_at: string;
    };
  }>(`/api/services/${encodeURIComponent(input.serviceId)}/deployments`, {
    method: 'POST',
    body: {
      provider: { name: input.provider },
      target: {
        artifact: {
          kind: 'container-image',
          image_ref: input.imageRef,
          exposed_port: input.port,
          ...(input.healthPath ? { health_path: input.healthPath } : {}),
        },
      },
      ...(input.deployMessage ? { deploy_message: input.deployMessage } : {}),
    },
    timeout: 120_000,
  }));
}

export async function listResourcesInSpace(spaceId: string): Promise<ApiResourceRecord[]> {
  const data = requireApiData(await api<{ resources: ApiResourceRecord[] }>(
    `/api/resources?space_id=${encodeURIComponent(spaceId)}`,
  ));
  return data.resources;
}

export async function findResourceInSpace(
  spaceId: string,
  name: string,
): Promise<ApiResourceRecord | null> {
  const resources = await listResourcesInSpace(spaceId);
  return resources.find((resource) => resource.id === name || resource.name === name) ?? null;
}

export async function listGroupsInSpace(spaceId: string): Promise<ApiGroupRecord[]> {
  const data = requireApiData(await api<{ groups: ApiGroupRecord[] }>(
    `/api/spaces/${encodeURIComponent(spaceId)}/groups`,
  ));
  return data.groups;
}

export async function findGroupInSpace(
  spaceId: string,
  name: string,
): Promise<ApiGroupRecord | null> {
  const groups = await listGroupsInSpace(spaceId);
  return groups.find((group) => group.id === name || group.name === name) ?? null;
}

export async function ensureGroupInSpace(
  spaceId: string,
  name: string,
): Promise<ApiGroupRecord> {
  const existing = await findGroupInSpace(spaceId, name);
  if (existing) return existing;

  const data = requireApiData(await api<{ id: string; name: string }>(
    `/api/spaces/${encodeURIComponent(spaceId)}/groups`,
    {
      method: 'POST',
      body: { name },
    },
  ));
  return { id: data.id, name: data.name };
}

export async function setServiceGroup(serviceId: string, groupId: string | null): Promise<ApiServiceRecord> {
  const data = requireApiData(await api<{ service: ApiServiceRecord }>(
    `/api/services/${encodeURIComponent(serviceId)}/group`,
    {
      method: 'PATCH',
      body: {
        group_id: groupId,
      },
    },
  ));
  return data.service;
}

export async function setResourceGroup(resourceId: string, groupId: string | null): Promise<ApiResourceRecord> {
  const data = requireApiData(await api<{ resource: ApiResourceRecord }>(
    `/api/resources/${encodeURIComponent(resourceId)}/group`,
    {
      method: 'PATCH',
      body: {
        group_id: groupId,
      },
    },
  ));
  return data.resource;
}
