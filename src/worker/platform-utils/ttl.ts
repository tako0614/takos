/**
 * TTL branded types
 *
 * Cache and session TTL values flow through the codebase in two different
 * units (milliseconds and seconds) and are silently converted at usage sites
 * via `/ 1000`. This module provides branded number types so the unit lives
 * in the type, and explicit conversion helpers so the conversion site is
 * grep-able and reviewable.
 *
 * Branded types are nominal at the type-checker level only; they are still
 * `number` at runtime so this change is fully behavior-preserving when used
 * to tag existing constants.
 */

declare const ttlMsBrand: unique symbol;
declare const ttlSecondsBrand: unique symbol;

export type TtlMs = number & { readonly [ttlMsBrand]: "TtlMs" };
export type TtlSeconds = number & {
  readonly [ttlSecondsBrand]: "TtlSeconds";
};

/** Tag a raw number as a millisecond TTL. */
export const ttlMs = (n: number): TtlMs => n as TtlMs;

/** Tag a raw number as a second TTL. */
export const ttlSeconds = (n: number): TtlSeconds => n as TtlSeconds;

/** Convert a millisecond TTL to a (floored) second TTL. */
export const toSeconds = (ms: TtlMs): TtlSeconds =>
  Math.floor(ms / 1000) as TtlSeconds;

/** Convert a second TTL to a millisecond TTL. */
export const toMs = (s: TtlSeconds): TtlMs => (s * 1000) as TtlMs;
