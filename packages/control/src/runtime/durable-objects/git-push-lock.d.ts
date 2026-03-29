export declare class GitPushLockDO {
    private readonly state;
    constructor(state: DurableObjectState);
    fetch(request: Request): Promise<Response>;
    private acquire;
    private release;
    alarm(): Promise<void>;
}
//# sourceMappingURL=git-push-lock.d.ts.map