import type { ToolContext } from '../../types';
export declare function requireContainer(context: ToolContext): void;
export declare function resolveMountPath(context: ToolContext, repoId?: string, mountPath?: string): Promise<string>;
export declare function buildSessionPath(mountPath: string, path: string): string;
export declare function callSessionApi(context: ToolContext, endpoint: string, body: Record<string, unknown>): Promise<Response>;
//# sourceMappingURL=session.d.ts.map