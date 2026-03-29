import type { D1Database } from '../../../shared/types/bindings.ts';
export interface ShortcutItem {
    type: 'service' | 'ui' | 'd1' | 'r2' | 'kv' | 'link';
    id: string;
    label: string;
    icon?: string;
    serviceId?: string;
    uiPath?: string;
    resourceId?: string;
    url?: string;
}
export interface ShortcutGroup {
    id: string;
    spaceId: string;
    name: string;
    icon?: string;
    items: ShortcutItem[];
    bundleDeploymentId?: string;
    createdAt: string;
    updatedAt: string;
}
interface CreateGroupInput {
    name: string;
    icon?: string;
    items?: ShortcutItem[];
}
interface UpdateGroupInput {
    name?: string;
    icon?: string;
    items?: ShortcutItem[];
}
export declare function listShortcutGroups(d1: D1Database, spaceId: string): Promise<ShortcutGroup[]>;
export declare function getShortcutGroup(d1: D1Database, spaceId: string, groupId: string): Promise<ShortcutGroup | null>;
export declare function createShortcutGroup(d1: D1Database, spaceId: string, input: CreateGroupInput): Promise<ShortcutGroup>;
export declare function updateShortcutGroup(d1: D1Database, spaceId: string, groupId: string, input: UpdateGroupInput): Promise<ShortcutGroup | null>;
export declare function deleteShortcutGroup(d1: D1Database, spaceId: string, groupId: string): Promise<boolean>;
export declare function addItemToGroup(d1: D1Database, spaceId: string, groupId: string, item: Omit<ShortcutItem, 'id'>): Promise<ShortcutItem | null>;
export declare function removeItemFromGroup(d1: D1Database, spaceId: string, groupId: string, itemId: string): Promise<boolean>;
export {};
//# sourceMappingURL=shortcut-groups.d.ts.map