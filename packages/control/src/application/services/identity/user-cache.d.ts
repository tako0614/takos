import type { D1Database } from '../../../shared/types/bindings.ts';
import type { User } from '../../../shared/types';
interface UserCacheContext {
    get(key: 'user'): User | undefined;
    set(key: 'user', value: User): void;
    env: {
        DB: D1Database;
    };
}
export declare function isValidUserId(userId: unknown): userId is string;
export declare function getCachedUser<C extends UserCacheContext>(c: C, userId: string): Promise<User | null>;
export {};
//# sourceMappingURL=user-cache.d.ts.map