/**
 * createLatestRequest — owns the "latest-wins" stale-response guard that was
 * hand-rolled (~100x) across the data hooks in `web/src/hooks`.
 *
 * Each fetch claims a monotonically increasing sequence number. When the
 * awaited work settles, the result is only committed if (a) it is still the
 * most recent claim and (b) the optional source snapshot still matches (e.g.
 * the spaceId / username the request was issued for has not changed). Stale
 * settlements are dropped, exactly mirroring the previous
 * `if (seq !== ref || target !== current()) return;` boilerplate that appeared
 * in the `try`, `catch` and `finally` blocks of every hook.
 *
 * Two usage shapes are supported:
 *
 *   // 1. run(): the primitive owns try/catch sequencing; the fetcher only does
 *   //    the request + parse. Returns `undefined` for a superseded settlement.
 *   const data = await latest.run(() => fetchJson(), { isCurrent });
 *   if (data === undefined) return;
 *
 *   // 2. claim(): for hooks that keep their own try/catch and need to gate the
 *   //    success / error / finally branches with a single `claim.won()` check.
 *   const claim = latest.claim(isCurrent);
 *   try { ...; if (claim.won()) setData(data); }
 *   catch { if (claim.won()) setError(...); }
 *   finally { if (claim.won()) setLoading(false); }
 */
export interface LatestRequestRunOptions {
  /**
   * Optional snapshot guard re-checked after the work settles. Return `false`
   * to treat the settlement as stale. Mirrors the `target !== current()`
   * checks the hooks used to inline.
   */
  isCurrent?: () => boolean;
}

export interface RequestClaim {
  /**
   * `true` while this claim is still the most recent one AND the optional
   * `isCurrent` snapshot guard (captured at claim time) still holds.
   */
  won(): boolean;
}

export interface LatestRequest {
  /**
   * Run a fetcher under latest-wins sequencing.
   *
   * @returns the fetcher's resolved value when this call is still the latest
   * settlement, or `undefined` when it has been superseded (or the snapshot
   * guard rejected it). Rejections from the fetcher are re-thrown for the
   * latest call and swallowed for stale calls.
   */
  run<T>(
    fetcher: () => Promise<T>,
    options?: LatestRequestRunOptions,
  ): Promise<T | undefined>;
  /**
   * Claim the next sequence number, returning a token whose `won()` reports
   * whether this remains the latest in-flight request. Use this when the hook
   * keeps its own try/catch/finally and wants to gate each branch.
   */
  claim(isCurrent?: () => boolean): RequestClaim;
  /**
   * Claim the next sequence number without a fetcher, invalidating any
   * in-flight request the way `++requestSeq` used to on source change.
   */
  next(): number;
}

export function createLatestRequest(): LatestRequest {
  let seq = 0;

  const next = () => ++seq;

  function claim(isCurrent?: () => boolean): RequestClaim {
    const claimed = ++seq;
    return {
      won: () => claimed === seq && (isCurrent ? isCurrent() : true),
    };
  }

  async function run<T>(
    fetcher: () => Promise<T>,
    options?: LatestRequestRunOptions,
  ): Promise<T | undefined> {
    const token = claim(options?.isCurrent);
    try {
      const value = await fetcher();
      if (!token.won()) return undefined;
      return value;
    } catch (err) {
      if (!token.won()) return undefined;
      throw err;
    }
  }

  return { run, claim, next };
}
