import type { ToolContext } from '../../types';
export declare function appendContainerStartFailureContext(context: ToolContext, fallbackMessage: string, retryHint: string): string;
export declare function buildContainerUnavailableMessage(context: ToolContext, action: string): string;
export declare function buildContainerStatusUnavailableMessage(context: ToolContext): string;
export declare function requireContainerSession(context: ToolContext, action: string): string;
//# sourceMappingURL=availability.d.ts.map