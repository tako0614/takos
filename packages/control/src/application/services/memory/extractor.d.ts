import type { D1Database } from '../../../shared/types/bindings.ts';
import type { MemoryType } from '../../../shared/types';
interface ExtractedMemory {
    type: MemoryType;
    content: string;
    category?: string;
    importance: number;
}
export declare class MemoryExtractor {
    private dbBinding;
    private llmClient;
    constructor(dbBinding: D1Database, apiKey?: string);
    extractFromThread(spaceId: string, threadId: string, userId: string): Promise<ExtractedMemory[]>;
    private extractWithLLM;
    private extractWithPatterns;
    saveMemories(spaceId: string, threadId: string, userId: string, extractedMemories: ExtractedMemory[]): Promise<number>;
    processThread(spaceId: string, threadId: string, userId: string): Promise<{
        extracted: number;
        saved: number;
    }>;
}
export declare function shouldAutoExtract(messageCount: number, lastExtractedCount: number): boolean;
export {};
//# sourceMappingURL=extractor.d.ts.map