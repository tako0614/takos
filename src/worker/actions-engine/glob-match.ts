/**
 * 共有 glob matcher。
 *
 * SECURITY (ReDoS): glob は attacker-controlled な .takos/workflows/*.yml /
 * 式評価器入力から来るため、backtracking RegExp ではなく線形時間の DP matcher を
 * 使う。`a*a*a*...*a` のような adversarial pattern でも catastrophic backtracking で
 * Worker CPU を pin できない。
 */

type GlobToken =
  | { t: "lit"; c: string }
  | { t: "any1" } // `?` : one non-`/` char
  | { t: "star" } // `*` : run of non-`/` chars
  | { t: "globstar" }; // `**` : any run, including `/`

const GLOB_TOKEN_CACHE_MAX = 2048;
const globTokenCache = new Map<string, GlobToken[]>();

function tokenizeGlob(glob: string): GlobToken[] {
  const cached = globTokenCache.get(glob);
  if (cached) return cached;
  const tokens: GlobToken[] = [];
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        tokens.push({ t: "globstar" });
        i++;
      } else {
        tokens.push({ t: "star" });
      }
    } else if (ch === "?") {
      tokens.push({ t: "any1" });
    } else {
      tokens.push({ t: "lit", c: ch });
    }
  }
  if (globTokenCache.size >= GLOB_TOKEN_CACHE_MAX) globTokenCache.clear();
  globTokenCache.set(glob, tokens);
  return tokens;
}

/**
 * O(pattern × value) dynamic-programming glob matcher — ReDoS-free. `*` = run of
 * non-`/` chars (`[^/]*`), `**` = any run including `/` (`.*`), `?` = single
 * non-`/` char (`[^/]`). Because it is a table DP (not regex backtracking), it
 * never exhibits the catastrophic blow-up a backtracking RegExp does on
 * adversarial globs, while still correctly handling patterns that mix `**` and
 * `*` (e.g. `src/**​/*.ts`).
 */
export function globMatch(glob: string, value: string): boolean {
  const tokens = tokenizeGlob(glob);
  const n = tokens.length;
  const m = value.length;
  // prev[j] === can tokens[i+1..] match value[j..]; seeded for the empty pattern.
  let prev = new Array<boolean>(m + 1).fill(false);
  prev[m] = true;
  for (let i = n - 1; i >= 0; i--) {
    const tok = tokens[i];
    const cur = new Array<boolean>(m + 1).fill(false);
    for (let j = m; j >= 0; j--) {
      if (tok.t === "star" || tok.t === "globstar") {
        // Match zero chars (prev[j]) or one more char then continue (cur[j+1]),
        // where a plain `*` may not consume `/`.
        const canConsume = j < m &&
          (tok.t === "globstar" || value[j] !== "/") && cur[j + 1];
        cur[j] = prev[j] || canConsume;
      } else if (tok.t === "any1") {
        cur[j] = j < m && value[j] !== "/" && prev[j + 1];
      } else {
        cur[j] = j < m && value[j] === tok.c && prev[j + 1];
      }
    }
    prev = cur;
  }
  return prev[0];
}
