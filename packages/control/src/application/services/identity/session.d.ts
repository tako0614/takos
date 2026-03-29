import type { Session, OIDCState } from '../../../shared/types';
import type { DurableNamespaceBinding } from '../../../shared/types/bindings.ts';
export declare function generateSessionId(): string;
export declare function normalizeSessionId(raw: string | null | undefined): string | null;
export type SessionStoreBinding = DurableNamespaceBinding;
export declare function createSession(sessionStore: SessionStoreBinding, userId: string): Promise<Session>;
export declare function getSession(sessionStore: SessionStoreBinding, sessionId: string): Promise<Session | null>;
export declare function deleteSession(sessionStore: SessionStoreBinding, sessionId: string): Promise<void>;
export declare function createOIDCState(sessionStore: SessionStoreBinding, oidcState: OIDCState): Promise<void>;
export declare function getOIDCState(sessionStore: SessionStoreBinding, state: string): Promise<OIDCState | null>;
export declare function deleteOIDCState(sessionStore: SessionStoreBinding, state: string): Promise<void>;
export declare const SESSION_COOKIE_NAME = "__Host-tp_session";
export declare function setSessionCookie(sessionId: string, maxAge: number): string;
export declare function clearSessionCookie(): string;
export declare function getSessionIdFromCookie(cookieHeader: string | null | undefined): string | null;
//# sourceMappingURL=session.d.ts.map