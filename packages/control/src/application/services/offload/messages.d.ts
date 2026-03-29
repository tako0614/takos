import type { R2Bucket } from '../../../shared/types/bindings.ts';
import type { MessageRole } from '../../../shared/types';
export type PersistedMessage = {
    id: string;
    thread_id: string;
    role: MessageRole;
    content: string;
    tool_calls: string | null;
    tool_call_id: string | null;
    metadata: string;
    sequence: number;
    created_at: string;
};
export declare const MESSAGE_OFFLOAD_CONTENT_THRESHOLD_CHARS = 4000;
export declare const MESSAGE_PREVIEW_MAX_CHARS = 800;
export declare function messageR2Key(threadId: string, messageId: string): string;
export declare function shouldOffloadMessage(input: {
    role: MessageRole;
    content: string;
}): boolean;
export declare function makeMessagePreview(content: string): string;
export declare function writeMessageToR2(bucket: R2Bucket, threadId: string, messageId: string, payload: PersistedMessage): Promise<{
    key: string;
}>;
export declare function readMessageFromR2(bucket: R2Bucket, key: string): Promise<PersistedMessage | null>;
//# sourceMappingURL=messages.d.ts.map