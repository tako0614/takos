import { atom } from 'jotai';
import { getSpaceIdentifier } from '../lib/spaces';
import { rpc, rpcJson } from '../lib/rpc';
import { spacesAtom } from './auth';
import type { Thread, Space } from '../types';

// ---------------------------------------------------------------------------
// Thread data atoms
// ---------------------------------------------------------------------------

export const threadsBySpaceAtom = atom<Record<string, Thread[]>>({});

export const allThreadsAtom = atom<Thread[]>((get) =>
  Object.values(get(threadsBySpaceAtom)).flat(),
);

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
