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
import { validationError } from '../../shared/utils/error-response';

export function zValidator<T extends z.ZodTypeAny, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) {
  return validator(target, (value, c) => {
    const result = schema.safeParse(value);
    if (!result.success) {
      return validationError(c, 'Validation error', result.error.flatten());
    }
    return result.data as z.infer<T>;
  });
}
