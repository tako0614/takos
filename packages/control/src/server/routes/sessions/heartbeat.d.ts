import type { JwtHeartbeatPayload, SessionContext } from './session-mappers';
export declare function heartbeatSession(c: SessionContext, jwtPayload?: JwtHeartbeatPayload): Promise<Response>;
export declare function getSessionHealth(c: SessionContext): Promise<Response>;
//# sourceMappingURL=heartbeat.d.ts.map