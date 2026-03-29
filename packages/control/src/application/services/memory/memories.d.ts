import type { Env, Memory, MemoryType, Reminder, ReminderPriority, ReminderStatus, ReminderTriggerType } from '../../../shared/types';
export declare const MEMORY_TYPES: readonly string[];
export declare function listMemories(dbBinding: Env['DB'], spaceId: string, options: {
    type?: MemoryType;
    category?: string;
    limit?: number;
    offset?: number;
}): Promise<Memory[]>;
export declare function bumpMemoryAccess(dbBinding: Env['DB'], memoryIds: string[], timestamp?: string): Promise<void>;
export declare function searchMemories(dbBinding: Env['DB'], spaceId: string, query: string, type?: MemoryType, limit?: number): Promise<Memory[]>;
export declare function getMemoryById(dbBinding: Env['DB'], memoryId: string): Promise<Memory | null>;
export declare function createMemory(dbBinding: Env['DB'], input: {
    spaceId: string;
    userId: string;
    threadId?: string | null;
    type: MemoryType;
    content: string;
    category?: string | null;
    summary?: string | null;
    importance?: number;
    tags?: string[] | null;
    occurredAt?: string | null;
    expiresAt?: string | null;
}): Promise<Memory | null>;
export declare function updateMemory(dbBinding: Env['DB'], memoryId: string, updates: {
    content?: string;
    summary?: string;
    importance?: number;
    category?: string;
    tags?: string[] | null;
    expiresAt?: string | null;
}): Promise<Memory | null>;
export declare function deleteMemory(dbBinding: Env['DB'], memoryId: string): Promise<void>;
export declare function listReminders(dbBinding: Env['DB'], spaceId: string, options: {
    status?: ReminderStatus;
    limit?: number;
}): Promise<Reminder[]>;
export declare function getReminderById(dbBinding: Env['DB'], reminderId: string): Promise<Reminder | null>;
export declare function createReminder(dbBinding: Env['DB'], input: {
    spaceId: string;
    userId: string;
    content: string;
    context?: string | null;
    triggerType: ReminderTriggerType;
    triggerValue?: string | null;
    priority?: ReminderPriority;
}): Promise<Reminder | null>;
export declare function updateReminder(dbBinding: Env['DB'], reminderId: string, updates: {
    content?: string;
    context?: string;
    triggerValue?: string;
    status?: ReminderStatus;
    priority?: ReminderPriority;
}): Promise<Reminder | null>;
export declare function deleteReminder(dbBinding: Env['DB'], reminderId: string): Promise<void>;
export declare function triggerReminder(dbBinding: Env['DB'], reminderId: string): Promise<Reminder | null>;
//# sourceMappingURL=memories.d.ts.map