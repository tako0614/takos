import type { Env } from '../../../shared/types';
export declare function normalizeEnvName(name: string): string;
export declare function uniqueEnvNames(names: string[]): string[];
export declare function getCommonEnvSecret(env: Pick<Env, 'ENCRYPTION_KEY'>): string;
export declare function encryptCommonEnvValue(env: Pick<Env, 'ENCRYPTION_KEY'>, spaceId: string, envName: string, value: string): Promise<string>;
export declare function decryptCommonEnvValue(env: Pick<Env, 'ENCRYPTION_KEY'>, row: {
    space_id: string;
    name: string;
    value_encrypted: string;
}): Promise<string>;
export declare function createBindingFingerprint(params: {
    env: Pick<Env, 'ENCRYPTION_KEY'>;
    spaceId: string;
    envName: string;
    type: 'plain_text' | 'secret_text';
    text?: string;
}): Promise<string | null>;
export declare function fingerprintMatches(params: {
    env: Pick<Env, 'ENCRYPTION_KEY'>;
    stored: string | null | undefined;
    spaceId: string;
    envName: string;
    type: 'plain_text' | 'secret_text';
    text?: string;
}): Promise<boolean>;
export declare const MANAGED_COMMON_ENV_KEYS: Set<string>;
export declare const RESERVED_SPACE_COMMON_ENV_KEYS: Set<string>;
export declare function normalizeCommonEnvName(name: string): string | null;
export declare function isManagedCommonEnvKey(name: string): boolean;
export declare function isReservedSpaceCommonEnvKey(name: string): boolean;
//# sourceMappingURL=crypto.d.ts.map