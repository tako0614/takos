export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
export interface CircuitStats {
    state: CircuitState;
    failures: number;
    successes: number;
    lastFailure: number | null;
    lastSuccess: number | null;
    openedAt: number | null;
}
interface CircuitBreakerConfig {
    failureThreshold: number;
    resetTimeout: number;
    successThreshold: number;
}
export declare class CircuitBreaker {
    private circuits;
    private config;
    constructor(config?: Partial<CircuitBreakerConfig>);
    private getCircuit;
    canExecute(toolName: string): {
        allowed: boolean;
        reason?: string;
    };
    recordSuccess(toolName: string): void;
    recordFailure(toolName: string, error?: string): void;
    getState(toolName: string): CircuitStats;
    getAllStates(): Map<string, CircuitStats>;
    reset(toolName: string): void;
    resetAll(): void;
}
export {};
//# sourceMappingURL=circuit-breaker.d.ts.map