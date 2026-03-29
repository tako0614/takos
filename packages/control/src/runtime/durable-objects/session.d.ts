export declare class SessionDO implements DurableObject {
    private state;
    private sessions;
    private oidcStates;
    constructor(state: DurableObjectState);
    private persist;
    private scheduleCleanupAlarm;
    alarm(): Promise<void>;
    fetch(request: Request): Promise<Response>;
}
//# sourceMappingURL=session.d.ts.map