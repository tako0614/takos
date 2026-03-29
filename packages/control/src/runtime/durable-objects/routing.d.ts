export declare class RoutingDO implements DurableObject {
    private state;
    constructor(state: DurableObjectState);
    fetch(request: Request): Promise<Response>;
    alarm(): Promise<void>;
    /**
     * Normalize and validate a hostname per DNS rules:
     * - Total length must not exceed 253 characters (RFC 1035 §2.3.4,
     *   accounting for the trailing dot which is typically omitted).
     * - Each label (between dots) must be 1–63 characters.
     * - Labels may only contain ASCII letters, digits, and hyphens.
     * - Labels must not start or end with a hyphen.
     */
    private normalizeHostname;
    private load;
    private save;
    private deleteRecord;
    private handleGet;
    private handlePut;
    private handleDelete;
    private putTombstoneIndex;
    private deleteTombstoneIndex;
    private cleanupExpiredTombstones;
    private scheduleNextCleanupAlarm;
    private handleRolloutSchedule;
    private handleRolloutCancel;
}
//# sourceMappingURL=routing.d.ts.map