import type { Env } from "../../../shared/types/index.ts";

export async function emitRunUsageEvent(
  env: Env,
  input: {
    runId: string;
    meterType: string;
    units: number;
    referenceType?: string;
    metadata?: unknown;
  },
): Promise<void> {
  if (!env.TAKOS_OFFLOAD) return;
  const ns = env.RUN_NOTIFIER;
  if (!ns) return;
  if (!input.runId) return;

  const id = ns.idFromName(input.runId);
  const stub = ns.get(id);
  const request = new Request("https://internal.do/usage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      runId: input.runId,
      meter_type: input.meterType,
      units: input.units,
      reference_type: input.referenceType,
      metadata: input.metadata,
    }),
  });
  const response = await stub.fetch(request);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Run usage event rejected: ${response.status}${
        detail ? ` ${detail.slice(0, 512)}` : ""
      }`,
    );
  }
}
