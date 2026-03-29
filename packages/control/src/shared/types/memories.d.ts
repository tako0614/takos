export type MemoryType = 'episode' | 'semantic' | 'procedural';
export interface Memory {
    id: string;
    space_id: string;
    user_id: string | null;
    thread_id: string | null;
    type: MemoryType;
    category: string | null;
    content: string;
    summary: string | null;
    importance: number;
    tags: string | null;
    occurred_at: string | null;
    expires_at: string | null;
    last_accessed_at: string | null;
    access_count: number;
    created_at: string;
    updated_at: string;
}
export type ReminderTriggerType = 'time' | 'condition' | 'context';
export type ReminderStatus = 'pending' | 'triggered' | 'completed' | 'dismissed';
export type ReminderPriority = 'low' | 'normal' | 'high' | 'critical';
export interface Reminder {
    id: string;
    space_id: string;
    user_id: string | null;
    content: string;
    context: string | null;
    trigger_type: ReminderTriggerType;
    trigger_value: string | null;
    status: ReminderStatus;
    triggered_at: string | null;
    priority: ReminderPriority;
    created_at: string;
    updated_at: string;
}
//# sourceMappingURL=memories.d.ts.map