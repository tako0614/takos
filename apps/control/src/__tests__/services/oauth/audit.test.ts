import { describe, expect, it, vi, beforeEach } from 'vitest';

function createMockDrizzleDb() {
  const chain = {
    values: vi.fn().mockReturnThis(),
  };
  return {
    insert: vi.fn(() => chain),
    _: { chain },
  };
}

const db = createMockDrizzleDb();

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>();
  return { ...actual, getDb: mocks.getDb };
});

import { logOAuthEvent } from '@/services/oauth/audit';
import type { OAuthAuditEvent } from '@/services/oauth/audit';
import type { D1Database } from '@takos/cloudflare-compat';

describe('logOAuthEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(db);
  });

  it('inserts an audit log entry with all fields', async () => {
    await logOAuthEvent({} as D1Database, {
      userId: 'user-1',
      clientId: 'client-1',
      eventType: 'authorize_approved',
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
      details: { redirect_uri: 'https://example.com/cb' },
    });

    expect(db.insert).toHaveBeenCalledTimes(1);
    const insertChain = db._.chain;
    expect(insertChain.values).toHaveBeenCalledTimes(1);

    const values = insertChain.values.mock.calls[0]![0] as Record<string, unknown>;
    expect(values.accountId).toBe('user-1');
    expect(values.clientId).toBe('client-1');
    expect(values.eventType).toBe('authorize_approved');
    expect(values.ipAddress).toBe('127.0.0.1');
    expect(values.userAgent).toBe('test-agent');
    expect(JSON.parse(values.details as string)).toEqual({
      redirect_uri: 'https://example.com/cb',
    });
    expect(values.id).toBeTruthy();
    expect(values.createdAt).toBeTruthy();
  });

  it('stores null for optional fields when not provided', async () => {
    await logOAuthEvent({} as D1Database, {
      eventType: 'token_issued',
    });

    const values = db._.chain.values.mock.calls[0]![0] as Record<string, unknown>;
    expect(values.accountId).toBeNull();
    expect(values.clientId).toBeNull();
    expect(values.ipAddress).toBeNull();
    expect(values.userAgent).toBeNull();
    expect(values.details).toBe('{}');
  });

  it('handles all defined event types', () => {
    // Type-level check: ensure all event types are valid strings
    const allEvents: OAuthAuditEvent[] = [
      'authorize_approved',
      'authorize_denied',
      'authorize_auto_approved',
      'device_code_issued',
      'device_auto_approved',
      'device_approved',
      'device_denied',
      'consent_granted',
      'consent_revoked',
      'token_issued',
      'token_refreshed',
      'token_revoked',
      'token_reuse_detected',
      'token_family_revoked',
      'client_registered',
      'client_updated',
      'client_deleted',
    ];
    expect(allEvents).toHaveLength(17);
  });
});
