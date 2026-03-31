import type { Space } from '../types/index.ts';

const normalize = (value?: string) => (value || '').trim().toLowerCase();

export function normalizeSpace(space: Space): Space {
  return {
    ...space,
    is_personal: space.kind === 'user' || space.is_personal === true,
  };
}

export function normalizeSpaces(spaces: Space[]): Space[] {
  return spaces.map(normalizeSpace);
}

function isPersonalSpace(space: Space, personalLabel?: string): boolean {
  if (space.kind === 'user' || space.is_personal) return true;
  const normalizedName = normalize(space.name);
  if (!normalizedName) return false;
  const normalizedLabel = normalize(personalLabel);
  return normalizedName === 'personal' || (!!normalizedLabel && normalizedName === normalizedLabel);
}

export function getPersonalSpace(spaces: Space[], personalLabel?: string): Space | null {
  return spaces.find((space) => isPersonalSpace(space, personalLabel)) || null;
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

/** Returns "me" for user spaces, otherwise the space slug. */
export function getSpaceIdentifier(space: Space): string {
  if (space.kind === 'user' || space.is_personal) return 'me';
  return space.slug ?? '';
}

export function findSpaceByIdentifier(
  spaces: Space[],
  identifier: string,
  personalLabel?: string
): Space | null {
  if (identifier === 'me') {
    return getPersonalSpace(spaces, personalLabel);
  }
  return spaces.find((w) => w.slug === identifier) || null;
}
