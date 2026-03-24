/**
 * HTTP Basic Auth middleware for Git Smart HTTP.
 *
 * Git clients send: Authorization: Basic base64(<username>:<password>)
 * For takos: username is ignored (or 'x-token-auth'), password is a PAT (tak_pat_xxx).
 *
 * Returns 401 with WWW-Authenticate header if no/invalid auth.
 */

import type { Context, MiddlewareHandler } from 'hono';
import type { Env, User } from '../../shared/types';
import { getCachedUser, isValidUserId } from '../../shared/utils/user-cache';
import { validateTakosPersonalAccessToken } from '../../application/services/identity/takos-access-tokens';

type GitAuthVariables = {
  user?: User;
};

type GitAuthContext = Context<{ Bindings: Env; Variables: GitAuthVariables }>;

function unauthorizedResponse(): Response {
  return new Response('Authentication required\n', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="takos"',
      'Content-Type': 'text/plain',
    },
  });
}

function forbiddenResponse(): Response {
  return new Response('Access denied\n', {
    status: 403,
    headers: { 'Content-Type': 'text/plain' },
  });
}

/**
 * Extract PAT from Basic auth header.
 * Format: Authorization: Basic base64(username:password)
 * The password field contains the PAT.
 */
function extractPatFromBasicAuth(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Basic ')) return null;

  try {
    const decoded = atob(authHeader.slice(6));
    const colonIdx = decoded.indexOf(':');
    if (colonIdx === -1) return null;
    const password = decoded.slice(colonIdx + 1);
    return password.startsWith('tak_pat_') ? password : null;
  } catch {
    return null;
  }
}

async function validatePat(
  c: GitAuthContext,
  token: string,
): Promise<User | null> {
  const validated = await validateTakosPersonalAccessToken(c.env.DB, token);
  if (!validated || !isValidUserId(validated.userId)) return null;
  return getCachedUser(c, validated.userId);
}

/**
 * Git auth middleware — requires Basic auth with PAT.
 * Sets c.get('user') on success.
 */
export const requireGitAuth: MiddlewareHandler<{ Bindings: Env; Variables: GitAuthVariables }> = async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const pat = extractPatFromBasicAuth(authHeader);

  if (!pat) {
    return unauthorizedResponse();
  }

  const user = await validatePat(c as GitAuthContext, pat);
  if (!user) {
    return forbiddenResponse();
  }

  c.set('user', user);
  await next();
};

/**
 * Optional git auth — sets user if valid auth present, allows anonymous for public repos.
 */
export const optionalGitAuth: MiddlewareHandler<{ Bindings: Env; Variables: GitAuthVariables }> = async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const pat = extractPatFromBasicAuth(authHeader);

  if (pat) {
    const user = await validatePat(c as GitAuthContext, pat);
    if (user) {
      c.set('user', user);
    }
  }

  await next();
};
