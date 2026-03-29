export declare function runLocalSmokeProxyless(): Promise<{
    proxyless: boolean;
    proxyUsageDelta: Record<string, number>;
    runId: string;
    status: string;
    workerId: string | null;
    startedAt: string | null;
    completedAt: string | null;
    output: string | null;
}>;
export declare function runLocalSmokeProxylessCommand(): Promise<void>;
//# sourceMappingURL=run-smoke-proxyless.d.ts.map