/**
 * HTTP Basic Auth middleware for Git Smart HTTP.
 *
 * Git clients send: Authorization: Basic base64(<username>:<password>)
 * For takos: username is ignored (or 'x-token-auth'), password is a PAT (tak_pat_xxx).
 *
 * Returns 401 with WWW-Authenticate header if no/invalid auth.
 */
import type { MiddlewareHandler } from 'hono';
import type { Env, User } from '../../shared/types';
type GitAuthVariables = {
    user?: User;
};
/**
 * Git auth middleware — requires Basic auth with PAT.
 * Sets c.get('user') on success.
 */
export declare const requireGitAuth: MiddlewareHandler<{
    Bindings: Env;
    Variables: GitAuthVariables;
}>;
/**
 * Optional git auth — sets user if valid auth present, allows anonymous for public repos.
 */
export declare const optionalGitAuth: MiddlewareHandler<{
    Bindings: Env;
    Variables: GitAuthVariables;
}>;
export {};
//# sourceMappingURL=git-auth.d.ts.map