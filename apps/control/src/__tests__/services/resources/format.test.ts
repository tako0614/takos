import { describe, it, expect } from 'vitest';
import { toApiResource, toApiResourceAccess, toApiServiceBinding } from '@/services/resources/format';

describe('toApiResource', () => {
  it('maps internal resource to API format', () => {
    const result = toApiResource({
      id: 'res-1',
      ownerId: 'user-1',
      spaceId: 'space-1',
      name: 'my-database',
      type: 'd1',
      status: 'active',
      cfId: 'cf-123',
      cfName: 'my-db',
      config: '{"key":"value"}',
      metadata: '{"meta":"data"}',
      sizeBytes: 1024,
      itemCount: 50,
      lastUsedAt: '2026-01-01T12:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T06:00:00.000Z',
    });

    expect(result.id).toBe('res-1');
    expect(result.owner_id).toBe('user-1');
    expect(result.space_id).toBe('space-1');
    expect(result.name).toBe('my-database');
    expect(result.type).toBe('d1');
    expect(result.status).toBe('active');
    expect(result.cf_id).toBe('cf-123');
    expect(result.cf_name).toBe('my-db');
    expect(result.config).toBe('{"key":"value"}');
    expect(result.metadata).toBe('{"meta":"data"}');
    expect(result.size_bytes).toBe(1024);
    expect(result.item_count).toBe(50);
  });

  it('handles null fields', () => {
    const result = toApiResource({
      id: 'res-1',
      ownerId: 'user-1',
      spaceId: null,
      name: 'my-bucket',
      type: 'r2',
      status: 'active',
      cfId: null,
      cfName: null,
      config: '{}',
      metadata: '{}',
      sizeBytes: null,
      itemCount: null,
      lastUsedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(result.space_id).toBeNull();
    expect(result.cf_id).toBeNull();
    expect(result.cf_name).toBeNull();
    expect(result.size_bytes).toBeNull();
    expect(result.item_count).toBeNull();
    expect(result.last_used_at).toBeNull();
  });

  it('handles Date objects for timestamps', () => {
    const result = toApiResource({
      id: 'res-1',
      ownerId: 'user-1',
      spaceId: null,
      name: 'test',
      type: 'd1',
      status: 'active',
      cfId: null,
      cfName: null,
      config: '{}',
      metadata: '{}',
      sizeBytes: null,
      itemCount: null,
      lastUsedAt: new Date('2026-06-15T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-01T00:00:00.000Z'),
    });

    expect(result.last_used_at).toBe('2026-06-15T00:00:00.000Z');
    expect(result.created_at).toBe('2026-01-01T00:00:00.000Z');
    expect(result.updated_at).toBe('2026-03-01T00:00:00.000Z');
  });
});

describe('toApiResourceAccess', () => {
  it('maps internal resource access to API format', () => {
    const result = toApiResourceAccess({
      id: 'ra-1',
      resourceId: 'res-1',
      accountId: 'space-1',
      permission: 'read',
      grantedByAccountId: 'user-1',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(result.id).toBe('ra-1');
    expect(result.resource_id).toBe('res-1');
    expect(result.space_id).toBe('space-1');
    expect(result.permission).toBe('read');
    expect(result.granted_by).toBe('user-1');
  });

  it('handles null granted_by', () => {
    const result = toApiResourceAccess({
      id: 'ra-1',
      resourceId: 'res-1',
      accountId: 'space-1',
      permission: 'admin',
      grantedByAccountId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(result.granted_by).toBeNull();
  });
});

describe('toApiServiceBinding', () => {
  it('maps internal service binding to API format', () => {
    const result = toApiServiceBinding({
      id: 'wb-1',
      serviceId: 'w-1',
      resourceId: 'res-1',
      bindingName: 'MY_DB',
      bindingType: 'd1',
      config: '{"database_id":"abc"}',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(result.id).toBe('wb-1');
    expect(result.service_id).toBe('w-1');
    expect(result.resource_id).toBe('res-1');
    expect(result.binding_name).toBe('MY_DB');
    expect(result.binding_type).toBe('d1');
    expect(result.config).toBe('{"database_id":"abc"}');
  });

  it('handles Date createdAt', () => {
    const result = toApiServiceBinding({
      id: 'wb-1',
      serviceId: 'w-1',
      resourceId: 'res-1',
      bindingName: 'MY_KV',
      bindingType: 'kv',
      config: '{}',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(result.created_at).toBe('2026-01-01T00:00:00.000Z');
  });
});
