import { atom } from 'jotai';
import { getSpaceIdentifier, getPersonalSpace, findSpaceByIdentifier } from '../lib/spaces';
import { rpc, rpcJson } from '../lib/rpc';
import { spacesAtom, spacesLoadedAtom } from './auth';
import type { RouteState, Thread, Space } from '../types';

// ---------------------------------------------------------------------------
// Route state atoms (driven by useRouter, synced via hook)
// ---------------------------------------------------------------------------

export const routeAtom = atom<RouteState>({ view: 'home' });

/**
 * Write-only atom storing the `navigate` callback from useRouter.
 * Populated by `useNavigationSync`.
 */
export const navigateFnAtom = atom<(state: Partial<RouteState>) => void>(() => {});

/**
 * Write-only atom storing the `replace` callback from useRouter.
 * Populated by `useNavigationSync`.
 */
export const replaceFnAtom = atom<(state: RouteState) => void>(() => {});

// ---------------------------------------------------------------------------
// Sidebar atoms
// ---------------------------------------------------------------------------

export const sidebarSpaceAtom = atom<Space | null>(null);
export const showMobileNavDrawerAtom = atom<boolean>(false);
export const mobileNavDrawerId = 'mobile-navigation-drawer';

// ---------------------------------------------------------------------------
// Thread data atoms
// ---------------------------------------------------------------------------

export const threadsBySpaceAtom = atom<Record<string, Thread[]>>({});

export const allThreadsAtom = atom<Thread[]>((get) =>
  Object.values(get(threadsBySpaceAtom)).flat(),
);

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

// ---------------------------------------------------------------------------
// Fetch threads action atom
// ---------------------------------------------------------------------------

export const fetchAllThreadsAtom = atom(
  null,
  async (get, set, wsList?: Space[]) => {
    const list = wsList ?? get(spacesAtom);
    if (list.length === 0) return;
    const entries = await Promise.all(
      list.map(async (ws) => {
        const identifier = getSpaceIdentifier(ws);
        try {
          const res = await rpc.spaces[':spaceId'].threads.$get({
            param: { spaceId: identifier },
            query: { status: 'active' },
          });
          const data = await rpcJson<{ threads: Thread[] }>(res);
          return [identifier, data.threads] as const;
        } catch {
          return [identifier, [] as Thread[]] as const;
        }
      }),
    );
    set(threadsBySpaceAtom, Object.fromEntries(entries));
  },
);
