/** Require a value to be present, throwing BadRequestError if missing */
export declare function requireParam<T>(value: T | null | undefined, name: string): T;
/** Require a resource to exist, throwing NotFoundError if missing */
export declare function requireFound<T>(value: T | null | undefined, resource: string): T;
//# sourceMappingURL=validation-utils.d.ts.map