import type { D1Database } from '../../../shared/types/bindings.ts';
export declare const ALLOWED_SHORTCUT_RESOURCE_TYPES: readonly ["service", "resource", "link"];
export type ShortcutResourceType = (typeof ALLOWED_SHORTCUT_RESOURCE_TYPES)[number];
export interface ShortcutInput {
    name: string;
    resourceType: ShortcutResourceType;
    resourceId: string;
    icon?: string;
}
export interface ShortcutUpdateInput {
    name?: string;
    icon?: string;
    position?: number;
}
export interface ShortcutResponse {
    id: string;
    user_id: string;
    space_id: string;
    resource_type: string;
    resource_id: string;
    name: string;
    icon: string | null;
    position: number;
    created_at: string;
    updated_at: string;
    service_hostname?: string | null;
    service_status?: string | null;
    resource_name?: string | null;
    resource_type_name?: string | null;
}
export declare function generateShortcutId(): string;
export declare function isShortcutResourceType(value: string): value is ShortcutResourceType;
export declare function listShortcuts(db: D1Database, userId: string, spaceId: string): Promise<ShortcutResponse[]>;
export declare function createShortcut(db: D1Database, userId: string, spaceId: string, input: ShortcutInput): Promise<ShortcutResponse>;
export declare function updateShortcut(db: D1Database, userId: string, spaceId: string, id: string, updates: ShortcutUpdateInput): Promise<boolean>;
export declare function deleteShortcut(db: D1Database, userId: string, spaceId: string, id: string): Promise<void>;
export declare function reorderShortcuts(db: D1Database, userId: string, spaceId: string, orderedIds: string[]): Promise<void>;
//# sourceMappingURL=shortcuts.d.ts.map