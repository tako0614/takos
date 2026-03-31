import type { Env } from '../../../shared/types/index.ts';
import type { DurableObjectStubBinding } from '../../../shared/types/bindings.ts';
import type { RunNotifierEmitPayload } from './run-notifier-payload.ts';


type RunNotifierNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubBinding;
};

type RunNotifierStub = DurableObjectStubBinding;

export function getRunNotifierStub(
  env: Pick<Env, 'RUN_NOTIFIER'>,
  runId: string,
): RunNotifierStub {
  const namespace = env.RUN_NOTIFIER as unknown as RunNotifierNamespace;
  const notifierId = namespace.idFromName(runId);
  return namespace.get(notifierId);
}

export function buildRunNotifierEmitRequest(
  payload: RunNotifierEmitPayload,
  signal?: AbortSignal,
): Request {
  return new Request('https://internal.do/emit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Takos-Internal': '1' },
    body: JSON.stringify(payload),
    signal,
  });
}
