import type { Env } from '../../../shared/types/index.ts';
import type { DurableObjectStubBinding } from '../../../shared/types/bindings.ts';


type RunNotifierNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubBinding;
};

export async function emitRunUsageEvent(
  env: Env,
  input: {
    runId: string;
    meterType: string;
    units: number;
    referenceType?: string;
    metadata?: unknown;
  }
): Promise<void> {
  if (!env.TAKOS_OFFLOAD) return;
  const ns = env.RUN_NOTIFIER as unknown as RunNotifierNamespace;
  if (!ns) return;
  if (!input.runId) return;

  const id = ns.idFromName(input.runId);
  const stub = ns.get(id) as DurableObjectStubBinding;
  const request = new Request('https://internal.do/usage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Takos-Internal': '1' },
    body: JSON.stringify({
      runId: input.runId,
      meter_type: input.meterType,
      units: input.units,
      reference_type: input.referenceType,
      metadata: input.metadata,
    }),
  });
  await stub.fetch(request);
}
