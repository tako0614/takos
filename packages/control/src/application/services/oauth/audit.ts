import type { Env } from '../../../shared/types';
import { generateId, now } from '../../../shared/utils';
import { getDb, oauthAuditLogs } from '../../../infra/db';

export type OAuthAuditEvent =
  | 'authorize_approved'
  | 'authorize_denied'
  | 'authorize_auto_approved'
  | 'device_code_issued'
  | 'device_auto_approved'
  | 'device_approved'
  | 'device_denied'
  | 'consent_granted'
  | 'consent_revoked'
  | 'token_issued'
  | 'token_refreshed'
  | 'token_revoked'
  | 'token_reuse_detected'
  | 'token_family_revoked'
  | 'client_registered'
  | 'client_updated'
  | 'client_deleted';

export async function logOAuthEvent(
  dbBinding: Env['DB'],
  input: {
    userId?: string | null;
    clientId?: string | null;
    eventType: OAuthAuditEvent;
    ipAddress?: string | null;
    userAgent?: string | null;
    details?: Record<string, unknown>;
  }
) {
  const db = getDb(dbBinding);
  const id = generateId();
  const timestamp = now();
  const details = input.details ? JSON.stringify(input.details) : '{}';

  await db.insert(oauthAuditLogs).values({
    id,
    accountId: input.userId || null,
    clientId: input.clientId || null,
    eventType: input.eventType,
    ipAddress: input.ipAddress || null,
    userAgent: input.userAgent || null,
    details,
    createdAt: timestamp,
  });
}
