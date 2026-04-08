/**
 * Worker readiness probe — kernel deploy 時の HTTP probe 実装。
 *
 * Spec (`docs/apps/manifest.md` / `docs/apps/workers.md` / `docs/architecture/control-plane.md`):
 *
 * - kernel は deploy 時に Worker に対して **HTTP probe** を送る
 * - default probe path は `/`
 * - manifest の `compute.<name>.readiness` field で probe path を override 可
 * - **HTTP 200 OK のみ** を ready とみなす
 * - 201/204/3xx (redirect)/4xx/5xx は fail
 * - timeout は **hard-coded で 10 秒** (configurable ではない)
 * - 失敗したら deploy fail-fast (worker は起動扱いされず、routing は更新されない)
 *
 * Service / Container は manifest の `healthCheck` field を使うので、この probe は
 * Worker (workers-dispatch / runtime-host) のみで動く。
 */

/** kernel readiness probe の hard-coded timeout (10 秒)。 */
export const READINESS_PROBE_TIMEOUT_MS = 10_000;

/** default readiness path (manifest 未指定時)。 */
export const DEFAULT_READINESS_PATH = "/";

/** kernel が ready と判定する唯一の HTTP status。 */
export const READY_STATUS_CODE = 200;

export type ReadinessProbeOutcome =
  | { ok: true; status: number }
  | { ok: false; reason: "non-200"; status: number }
  | { ok: false; reason: "timeout" }
  | { ok: false; reason: "error"; error: string };

export type ReadinessProbeOptions = {
  /** Probe 先 URL の base (例: `https://my-app.takos.app`)。trailing slash はあってもなくても可。 */
  baseUrl: string;
  /** Probe path (例: `/`, `/healthz`)。先頭 `/` 必須。 */
  path: string;
  /** Test 用 fetch 注入 (default: global fetch)。 */
  fetchImpl?: typeof fetch;
  /** Test 用 timeout override (default: `READINESS_PROBE_TIMEOUT_MS`)。production code は default を使う。 */
  timeoutMs?: number;
};

/**
 * Probe URL を組み立てる。`baseUrl` の trailing slash と `path` の leading slash を
 * 重複させない。
 */
export function buildProbeUrl(baseUrl: string, path: string): string {
  const trimmedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${trimmedBase}${normalizedPath}`;
}

/**
 * Worker に HTTP GET probe を送って readiness を判定する。
 *
 * - **HTTP 200 OK のみ** を ready とみなす
 * - 201/204/3xx (redirect 含む)/4xx/5xx はすべて fail
 * - 10 秒の hard-coded timeout (`READINESS_PROBE_TIMEOUT_MS`)
 * - redirect は follow しない (`redirect: "manual"`)。3xx を返した時点で fail
 *
 * 失敗時は throw せず {@link ReadinessProbeOutcome} を返す。caller が deploy
 * fail-fast の error を組み立てる。
 */
export async function probeWorkerReadiness(
  options: ReadinessProbeOptions,
): Promise<ReadinessProbeOutcome> {
  const url = buildProbeUrl(options.baseUrl, options.path);
  const timeoutMs = options.timeoutMs ?? READINESS_PROBE_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      // redirect: "manual" → 3xx を follow せず、そのまま status を観察する。
      // spec: 3xx redirect は ready とみなさない。
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "User-Agent": "takos-kernel-readiness-probe/1.0",
      },
    });

    // 唯一の ready 条件: HTTP 200 OK。
    // 201/204/3xx (redirect)/4xx/5xx はすべて fail。
    if (response.status === READY_STATUS_CODE) {
      // body は読まずに drain (TCP 接続を解放し、Workers fetch handler をリーク
      // させない)。
      try {
        await response.body?.cancel();
      } catch {
        // drain failure は readiness 判定に影響しない。
      }
      return { ok: true, status: response.status };
    }

    try {
      await response.body?.cancel();
    } catch {
      // ignore
    }
    return { ok: false, reason: "non-200", status: response.status };
  } catch (error) {
    if (
      error instanceof DOMException && error.name === "AbortError" ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      return { ok: false, reason: "timeout" };
    }
    return {
      ok: false,
      reason: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe failure の error message を組み立てる。`execute.ts` の deploy step が
 * throw する Error message として使う。
 */
export function describeReadinessFailure(
  url: string,
  outcome: Extract<ReadinessProbeOutcome, { ok: false }>,
): string {
  switch (outcome.reason) {
    case "non-200":
      return `Worker readiness probe failed: ${url} returned HTTP ${outcome.status} ` +
        `(only HTTP 200 is treated as ready; 201/204/3xx/4xx/5xx all fail)`;
    case "timeout":
      return `Worker readiness probe failed: ${url} did not respond within ` +
        `${READINESS_PROBE_TIMEOUT_MS / 1000}s`;
    case "error":
      return `Worker readiness probe failed: ${url} request error: ${outcome.error}`;
  }
}
