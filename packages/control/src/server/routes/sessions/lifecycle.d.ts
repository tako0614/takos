import type { SessionContext } from './session-mappers';
type StartSessionBody = {
    repo_id: string;
    branch?: string;
};
type StopSessionBody = {
    commit_message?: string;
};
export declare function startSession(c: SessionContext, body: StartSessionBody): Promise<Response>;
export declare function stopSession(c: SessionContext, body: StopSessionBody): Promise<Response>;
export declare function resumeSession(c: SessionContext): Promise<Response>;
export declare function discardSession(c: SessionContext): Promise<Response>;
export {};
//# sourceMappingURL=lifecycle.d.ts.map