/**
 * UI Extension Service
 *
 * bundle deployment による UI 拡張の管理
 */
import type { D1Database } from '../../../shared/types/bindings.ts';
import type { R2Bucket } from '../../../shared/types/bindings.ts';
export interface UIExtension {
    id: string;
    spaceId: string;
    path: string;
    label: string;
    icon?: string;
    bundleR2Key: string;
    sidebar?: {
        label: string;
        icon: string;
        path?: string;
        url?: string;
    };
    bundleDeploymentId?: string;
    createdAt: string;
}
export interface UIExtensionWithBundle extends UIExtension {
    bundleUrl?: string;
}
/**
 * List all UI extensions for a workspace
 */
export declare function listUIExtensions(db: D1Database, spaceId: string): Promise<UIExtension[]>;
/**
 * Get a single UI extension by path
 */
export declare function getUIExtensionByPath(db: D1Database, spaceId: string, path: string): Promise<UIExtension | null>;
/**
 * Get UI extension bundle content from R2
 */
export declare function getUIExtensionBundle(db: D1Database, storage: R2Bucket, spaceId: string, path: string): Promise<{
    content: ArrayBuffer;
    contentType: string;
} | null>;
/**
 * Get sidebar items for workspace (from all UI extensions)
 */
export declare function getUISidebarItems(db: D1Database, spaceId: string): Promise<Array<{
    label: string;
    icon: string;
    path?: string;
    url?: string;
    extensionId: string;
}>>;
/**
 * Check if a path is registered as a UI extension
 */
export declare function isUIExtensionPath(db: D1Database, spaceId: string, path: string): Promise<boolean>;
/**
 * Get all registered extension paths for a workspace
 */
export declare function getUIExtensionPaths(db: D1Database, spaceId: string): Promise<string[]>;
//# sourceMappingURL=ui-extensions.d.ts.map