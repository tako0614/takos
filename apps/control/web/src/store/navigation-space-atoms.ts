import { atom } from 'jotai/vanilla';
import { getSpaceIdentifier, getPersonalSpace, findSpaceByIdentifier } from '../lib/spaces';
import { spacesAtom, spacesLoadedAtom } from './auth';
import { routeAtom } from './navigation-route-atoms';
import type { Space } from '../types';

// ---------------------------------------------------------------------------
// Space resolution atoms (derived)
// ---------------------------------------------------------------------------

/**
 * A helper atom that stores the translation function for 'personal'.
 * Updated via the sync hook so derived atoms can use it.
 */
export const personalLabelAtom = atom<string>('personal');

export const preferredSpaceAtom = atom<Space | undefined>((get) => {
  const spaces = get(spacesAtom);
  const label = get(personalLabelAtom);
  return getPersonalSpace(spaces, label) || spaces[0] || undefined;
});

export const preferredSpaceIdAtom = atom<string | undefined>((get) => {
  const space = get(preferredSpaceAtom);
  return space ? getSpaceIdentifier(space) : undefined;
});

export const routeSpaceIdAtom = atom<string | undefined>((get) => {
  const route = get(routeAtom);
  if (!route.spaceId) return undefined;
  const spaces = get(spacesAtom);
  const label = get(personalLabelAtom);
  const space = findSpaceByIdentifier(spaces, route.spaceId, label);
  return space ? getSpaceIdentifier(space) : undefined;
});

export const selectedSpaceIdAtom = atom<string | null>((get) => {
  const route = get(routeAtom);
  const routeSpaceId = get(routeSpaceIdAtom);
  const preferredSpaceId = get(preferredSpaceIdAtom);
  return route.spaceId
    ? routeSpaceId ?? null
    : preferredSpaceId ?? null;
});

export const waitingForSpaceResolutionAtom = atom<boolean>((get) => {
  const route = get(routeAtom);
  const routeSpaceId = get(routeSpaceIdAtom);
  const spacesLoaded = get(spacesLoadedAtom);
  return Boolean(route.spaceId) && !routeSpaceId && !spacesLoaded;
});
