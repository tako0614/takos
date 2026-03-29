import type { JwtHeartbeatPayload, SessionContext } from './session-mappers';
export declare function authenticateServiceRequest(c: SessionContext): Promise<Record<string, unknown> | null>;
export declare function serviceAuthError(_c: SessionContext): never;
export declare function toJwtHeartbeatPayload(payload: Record<string, unknown>): JwtHeartbeatPayload;
//# sourceMappingURL=auth.d.ts.map