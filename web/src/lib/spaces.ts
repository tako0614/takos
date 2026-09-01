import type { Space } from "../types/index.ts";

export function normalizeSpace(space: Space): Space {
  return space;
}

export function normalizeSpaces(spaces: Space[]): Space[] {
  return spaces.map(normalizeSpace);
}

export function getPersonalSpace(
  spaces: Space[],
  _personalLabel?: string,
): Space | null {
  return spaces.find((space) => space.is_default) || null;
}

export function splitSpaces(spaces: Space[], personalLabel?: string): {
  personalSpace: Space | null;
  otherSpaces: Space[];
} {
  const personalSpace = getPersonalSpace(spaces, personalLabel);
  const otherSpaces = personalSpace
    ? spaces.filter((space) => space.slug !== personalSpace.slug)
    : spaces;
  return { personalSpace, otherSpaces };
}

/** Returns "me" for the default Workspace, otherwise the Workspace slug. */
export function getSpaceIdentifier(space: Space): string {
  if (space.is_default) return "me";
  return space.slug ?? "";
}

export function findSpaceByIdentifier(
  spaces: Space[],
  identifier: string,
  personalLabel?: string,
): Space | null {
  if (identifier === "me") {
    return getPersonalSpace(spaces, personalLabel);
  }
  return spaces.find((w) => w.slug === identifier) || null;
}
