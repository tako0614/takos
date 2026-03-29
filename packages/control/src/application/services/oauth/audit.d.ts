import type { Env } from '../../../shared/types';
export type OAuthAuditEvent = 'authorize_approved' | 'authorize_denied' | 'authorize_auto_approved' | 'device_code_issued' | 'device_auto_approved' | 'device_approved' | 'device_denied' | 'consent_granted' | 'consent_revoked' | 'token_issued' | 'token_refreshed' | 'token_revoked' | 'token_reuse_detected' | 'token_family_revoked' | 'client_registered' | 'client_updated' | 'client_deleted';
export declare function logOAuthEvent(dbBinding: Env['DB'], input: {
    userId?: string | null;
    clientId?: string | null;
    eventType: OAuthAuditEvent;
    ipAddress?: string | null;
    userAgent?: string | null;
    details?: Record<string, unknown>;
}): Promise<void>;
//# sourceMappingURL=audit.d.ts.map