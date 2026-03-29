import type { AgentMessage } from './agent-models';
export declare const PRODUCT_HINTS: readonly ["takos", "yurucommu", "roadtome"];
type ProductHint = typeof PRODUCT_HINTS[number];
export type DelegationLocale = 'ja' | 'en';
export type DelegationPacket = {
    task: string;
    goal: string | null;
    deliverable: string | null;
    constraints: string[];
    context: string[];
    acceptance_criteria: string[];
    product_hint: ProductHint | null;
    locale: DelegationLocale | null;
    parent_run_id: string;
    parent_thread_id: string;
    root_thread_id: string;
    thread_summary: string | null;
    thread_key_points: string[];
};
type DelegationPacketObservability = {
    explicit_field_count: number;
    inferred_field_count: number;
    has_thread_summary: boolean;
    constraints_count: number;
    context_count: number;
};
type BuildDelegationPacketInput = {
    task: string;
    goal?: string | null;
    deliverable?: string | null;
    constraints?: string[];
    context?: string[];
    acceptanceCriteria?: string[];
    productHint?: string | null;
    locale?: string | null;
    parentRunId: string;
    parentThreadId: string;
    rootThreadId: string;
    latestUserMessage?: string | null;
    parentRunInput?: Record<string, unknown>;
    threadSummary?: string | null;
    threadKeyPoints?: string[];
    threadLocale?: string | null;
    spaceLocale?: string | null;
};
export declare function normalizeStringArray(value: unknown): string[];
export declare function isDelegationLocale(value: unknown): value is DelegationLocale;
export declare function isProductHint(value: unknown): value is ProductHint;
export declare function parseRunInputObject(input: unknown): Record<string, unknown>;
export declare function getDelegationPacketFromRunInput(input: unknown): DelegationPacket | null;
export declare function inferProductHintFromTextSamples(samples: Array<string | null | undefined>): ProductHint | null;
export declare function buildDelegationPacket(input: BuildDelegationPacketInput): {
    packet: DelegationPacket;
    observability: DelegationPacketObservability;
};
export declare function buildDelegationSystemMessage(packet: DelegationPacket): AgentMessage;
export declare function buildDelegationUserMessage(packet: DelegationPacket): AgentMessage;
export {};
//# sourceMappingURL=delegation.d.ts.map