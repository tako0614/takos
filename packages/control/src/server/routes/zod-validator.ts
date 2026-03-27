/**
 * Zod validator middleware for Hono routes.
 *
 * Built on Hono's built-in `validator` so that the inferred return type
 * flows into the Hono RPC schema, making json/query body types visible
 * to the frontend hc<ApiRoutes> client.
 */
import { validator } from 'hono/validator';
import type { ValidationTargets } from 'hono';
import type { z } from 'zod';
import { ValidationError } from '@takos/common/errors';

export function zValidator<T extends z.ZodTypeAny, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) {
  return validator(target, (value, c) => {
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new ValidationError('Validation error');
    }
    return result.data as z.infer<T>;
  });
}
