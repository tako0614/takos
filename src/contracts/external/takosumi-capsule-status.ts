/**
 * The Capsule status vocabulary Takosumi publishes.
 *
 * This is a mirror, not an invention. `@takosjp/takosumi-contract` ships
 * `types.ts` — it is in the package's `files` — but does not list it in
 * `exports`, so `import { GroupSummaryStatus } from "@takosjp/takosumi-contract/types"`
 * fails with `ERR_PACKAGE_PATH_NOT_EXPORTED` and this union cannot yet be
 * imported. Until the package exports it, the copy below is checked against
 * the bytes the pinned package actually ships, by
 * `takosumi-capsule-status.test.ts`, so a change on Takosumi's side fails
 * here rather than being discovered by a Capsule rendering as a raw string.
 *
 * Delete this file and import the union directly once the export exists.
 */

/** Mirrors `GroupSummaryStatus` in @takosjp/takosumi-contract's types.ts. */
export const CAPSULE_STATUSES = [
  "empty",
  "planning",
  "applying",
  "active",
  "degraded",
  "outage",
  "recovering",
  "failed",
  "suspended",
  "deleted",
] as const;

export type CapsuleStatus = (typeof CAPSULE_STATUSES)[number];

/**
 * How a Capsule status reads on a product page.
 *
 * Exhaustive by construction: adding a status to the union above without
 * classifying it here is a type error, which is the whole point. The map this
 * replaced was two `Set<string>`s holding eleven strings, six of which
 * (`pending`, `queued`, `installing`, `in_progress`, `stale`, `error`) are not
 * in the published vocabulary at all and could never match, while six that are
 * (`empty`, `degraded`, `outage`, `recovering`, `suspended`, `deleted`) were
 * unhandled and rendered as raw text.
 */
export type CapsulePresentation =
  /** Work is under way; the product page surfaces it as in flight. */
  | "inflight"
  /** Serving, in whatever health. */
  | "active"
  /** Serving nothing, and not because anything is in progress. */
  | "inert";

export const CAPSULE_PRESENTATION: Readonly<
  Record<CapsuleStatus, CapsulePresentation>
> = {
  empty: "inert",
  planning: "inflight",
  applying: "inflight",
  active: "active",
  degraded: "active",
  outage: "inflight",
  recovering: "inflight",
  failed: "inflight",
  suspended: "inert",
  deleted: "inert",
};

export function isCapsuleStatus(value: string): value is CapsuleStatus {
  return (CAPSULE_STATUSES as readonly string[]).includes(value);
}

/** An unknown status is surfaced, never silently treated as healthy. */
export function capsulePresentation(value: string): CapsulePresentation {
  const normalized = value.trim().toLowerCase();
  return isCapsuleStatus(normalized)
    ? CAPSULE_PRESENTATION[normalized]
    : "inflight";
}

/**
 * A status as it arrives on the wire.
 *
 * The published vocabulary, plus room for a value a newer Takosumi sends that
 * this pinned mirror does not know yet. Typing a wire field as plain `string`
 * erased the vocabulary; typing it as `CapsuleStatus` would claim a
 * completeness the pin cannot promise. `capsulePresentation` classifies an
 * unrecognized value as in flight, so an unknown status is surfaced rather
 * than presented as healthy.
 */
export type CapsuleWireStatus = CapsuleStatus | (string & {});
