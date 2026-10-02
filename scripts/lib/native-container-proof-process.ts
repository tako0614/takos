export type ProcessWitness = {
  pid: number;
  state: string;
  pgid: number;
  sessionId: number;
  startTicks: string;
  executable?: string;
};

/** Authorize a group signal only through the original live leader or previously observed identities. */
export function qualifyOwnedProcessGroup(
  pid: number,
  leaderStartTicks: string | undefined,
  head: ProcessWitness | undefined,
  current: Record<string, ProcessWitness>,
  observed: Record<string, ProcessWitness>,
): Record<string, ProcessWitness> {
  const liveLeader = head?.pid === pid && head.pgid === pid && head.sessionId === pid &&
    leaderStartTicks !== undefined && head.startTicks === leaderStartTicks;
  const qualified = { ...observed };
  for (const [key, state] of Object.entries(current)) {
    const previous = observed[key];
    if (!Number.isSafeInteger(pid) || pid <= 1 || key !== String(state.pid) ||
      state.pgid !== pid || state.sessionId !== pid || !/^[0-9]+$/u.test(state.startTicks) ||
      (!liveLeader && previous?.startTicks !== state.startTicks)) {
      throw new Error("unqualified process identity; refusing group signal");
    }
    qualified[key] = state;
  }
  return qualified;
}
