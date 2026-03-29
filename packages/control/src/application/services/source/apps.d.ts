import type { Env } from '../../../shared/types';
export declare function normalizeDistPath(input: string): string;
export declare function deployFrontendFromWorkspace(env: Env, input: {
    spaceId: string;
    appName: string;
    distPath: string;
    clear?: boolean;
    description?: string | null;
    icon?: string | null;
}): Promise<{
    appName: string;
    uploaded: number;
    url: string;
}>;
//# sourceMappingURL=apps.d.ts.map