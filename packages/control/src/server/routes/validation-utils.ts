import { BadRequestError, NotFoundError } from 'takos-common/errors';

/** Require a value to be present, throwing BadRequestError if missing */
export function requireParam<T>(value: T | null | undefined, name: string): T {
  if (value == null) throw new BadRequestError(`Missing ${name}`);
  return value;
}

/** Require a resource to exist, throwing NotFoundError if missing */
export function requireFound<T>(value: T | null | undefined, resource: string): T {
  if (value == null) throw new NotFoundError(resource);
  return value;
}
