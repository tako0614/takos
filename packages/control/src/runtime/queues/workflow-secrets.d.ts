import type { D1Database } from '../../shared/types/bindings.ts';
export declare function resolveSecretValues(db: D1Database, repoId: string, secretIds: string[], encryptionKey?: string, requiredSecretNames?: string[]): Promise<Record<string, string>>;
export declare function collectReferencedSecretNamesFromEnv(jobEnv: Record<string, string>): string[];
//# sourceMappingURL=workflow-secrets.d.ts.map