import { NotifierBase, type EmitResult } from './notifier-base';
/** User-scoped notification streaming (WebSocket + ring buffer replay). */
export declare class NotificationNotifierDO extends NotifierBase {
    protected readonly moduleName = "notificationnotifierdo";
    protected readonly maxConnections = 1000;
    private userId;
    constructor(state: DurableObjectState);
    protected loadPersistedState(): Promise<void>;
    protected persistState(): Promise<void>;
    protected resetState(): void;
    protected isAuthorizedHttp(request: Request): boolean;
    protected validateWebSocket(request: Request, _url: URL): Promise<{
        reject?: Response;
        tags?: string[];
    }>;
    protected parseWsLastEventId(raw: string | null): number | null;
    protected parseReplayAfter(raw: string | null): number | null;
    protected mapEventForHttp(event: {
        id: number;
        type: string;
        data: unknown;
        timestamp: number;
    }): Record<string, unknown>;
    protected processEmit(input: {
        type: string;
        data: unknown;
    }, eventId: number): Promise<EmitResult>;
    protected getStateExtra(): Record<string, unknown>;
}
//# sourceMappingURL=notification-notifier.d.ts.map