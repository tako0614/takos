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

export function splitSpaces(spaces: Space[], _personalLabel?: string): {
  personalSpace: Space | null;
  otherSpaces: Space[];
} {
  const personalSpace = getPersonalSpace(spaces);
  const otherSpaces = personalSpace
    ? spaces.filter((space) => space.id !== personalSpace.id)
    : spaces;
  return { personalSpace, otherSpaces };
}

/** Returns "me" for the default Workspace, otherwise its stable slug. */
export function getSpaceIdentifier(space: Space, _personalLabel?: string): string {
  return space.is_default ? "me" : space.slug;
}

export function findSpaceByIdentifier(
  spaces: Space[],
  identifier: string,
  _personalLabel?: string,
): Space | null {
  if (identifier === "me") return getPersonalSpace(spaces);
  return spaces.find((workspace) => workspace.slug === identifier) || null;
}
