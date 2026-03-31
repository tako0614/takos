import { toApiResource, toApiResourceAccess, toApiServiceBinding } from '@/services/resources/format';


import { assertEquals } from 'jsr:@std/assert';

  Deno.test('toApiResource - maps internal resource to API format', () => {
  const result = toApiResource({
      id: 'res-1',
      ownerId: 'user-1',
      spaceId: 'space-1',
      name: 'my-database',
      type: 'd1',
      status: 'active',
      providerResourceId: 'cf-123',
      providerResourceName: 'my-db',
      config: '{"key":"value"}',
      metadata: '{"meta":"data"}',
      sizeBytes: 1024,
      itemCount: 50,
      lastUsedAt: '2026-01-01T12:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T06:00:00.000Z',
    });

    assertEquals(result.id, 'res-1');
    assertEquals(result.owner_id, 'user-1');
    assertEquals(result.space_id, 'space-1');
    assertEquals(result.name, 'my-database');
    assertEquals(result.type, 'd1');
    assertEquals(result.capability, 'sql');
    assertEquals(result.implementation, 'd1');
    assertEquals(result.status, 'active');
    assertEquals(result.provider_resource_id, 'cf-123');
    assertEquals(result.provider_resource_name, 'my-db');
    assertEquals(result.config, '{"key":"value"}');
    assertEquals(result.metadata, '{"meta":"data"}');
    assertEquals(result.size_bytes, 1024);
    assertEquals(result.item_count, 50);
})
  Deno.test('toApiResource - handles null fields', () => {
  const result = toApiResource({
      id: 'res-1',
      ownerId: 'user-1',
      spaceId: null,
      name: 'my-bucket',
      type: 'r2',
      status: 'active',
      providerResourceId: null,
      providerResourceName: null,
      config: '{}',
      metadata: '{}',
      sizeBytes: null,
      itemCount: null,
      lastUsedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    assertEquals(result.space_id, null);
    assertEquals(result.type, 'r2');
    assertEquals(result.capability, 'object_store');
    assertEquals(result.implementation, 'r2');
    assertEquals(result.provider_resource_id, null);
    assertEquals(result.provider_resource_name, null);
    assertEquals(result.size_bytes, null);
    assertEquals(result.item_count, null);
    assertEquals(result.last_used_at, null);
})
  Deno.test('toApiResource - handles Date objects for timestamps', () => {
  const result = toApiResource({
      id: 'res-1',
      ownerId: 'user-1',
      spaceId: null,
      name: 'test',
      type: 'd1',
      status: 'active',
      providerResourceId: null,
      providerResourceName: null,
      config: '{}',
      metadata: '{}',
      sizeBytes: null,
      itemCount: null,
      lastUsedAt: new Date('2026-06-15T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-01T00:00:00.000Z'),
    });

    assertEquals(result.last_used_at, '2026-06-15T00:00:00.000Z');
    assertEquals(result.created_at, '2026-01-01T00:00:00.000Z');
    assertEquals(result.updated_at, '2026-03-01T00:00:00.000Z');
})

  Deno.test('toApiResourceAccess - maps internal resource access to API format', () => {
  const result = toApiResourceAccess({
      id: 'ra-1',
      resourceId: 'res-1',
      accountId: 'space-1',
      permission: 'read',
      grantedByAccountId: 'user-1',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    assertEquals(result.id, 'ra-1');
    assertEquals(result.resource_id, 'res-1');
    assertEquals(result.space_id, 'space-1');
    assertEquals(result.permission, 'read');
    assertEquals(result.granted_by, 'user-1');
})
  Deno.test('toApiResourceAccess - handles null granted_by', () => {
  const result = toApiResourceAccess({
      id: 'ra-1',
      resourceId: 'res-1',
      accountId: 'space-1',
      permission: 'admin',
      grantedByAccountId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    assertEquals(result.granted_by, null);
})

  Deno.test('toApiServiceBinding - maps internal service binding to API format', () => {
  const result = toApiServiceBinding({
      id: 'wb-1',
      serviceId: 'w-1',
      resourceId: 'res-1',
      bindingName: 'MY_DB',
      bindingType: 'd1',
      config: '{"database_id":"abc"}',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    assertEquals(result.id, 'wb-1');
    assertEquals(result.service_id, 'w-1');
    assertEquals(result.resource_id, 'res-1');
    assertEquals(result.binding_name, 'MY_DB');
    assertEquals(result.binding_type, 'd1');
    assertEquals(result.config, '{"database_id":"abc"}');
})
  Deno.test('toApiServiceBinding - handles Date createdAt', () => {
  const result = toApiServiceBinding({
      id: 'wb-1',
      serviceId: 'w-1',
      resourceId: 'res-1',
      bindingName: 'MY_KV',
      bindingType: 'kv',
      config: '{}',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    assertEquals(result.created_at, '2026-01-01T00:00:00.000Z');
})