export interface AgentExecutorDispatchPayload {
  runId: string;
  workerId: string;
  model?: string;
  leaseVersion?: number;
}

export interface AgentExecutorControlConfig {
  controlRpcBaseUrl?: string;
  controlRpcToken: string;
}

export interface AgentExecutorStartPayload extends AgentExecutorDispatchPayload, AgentExecutorControlConfig {}

export interface AgentExecutorDispatchResult {
  ok: boolean;
  status: number;
  body: string;
}

export interface AgentExecutorDispatchTarget {
  startAndWaitForPorts(ports?: number | number[]): Promise<void>;
  fetch(request: Request): Promise<Response>;
}

export interface AgentExecutorDispatchStub {
  dispatchStart(body: AgentExecutorDispatchPayload): Promise<AgentExecutorDispatchResult>;
}

export async function dispatchAgentExecutorStart(
  target: AgentExecutorDispatchTarget,
  body: AgentExecutorDispatchPayload,
  controlConfig: AgentExecutorControlConfig,
): Promise<AgentExecutorDispatchResult> {
  await target.startAndWaitForPorts(8080);

  const startPayload: AgentExecutorStartPayload = {
    ...body,
    ...controlConfig,
  };

  const response = await target.fetch(new Request('https://executor/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(startPayload),
  }));

  return {
    ok: response.ok,
    status: response.status,
    body: await response.text(),
  };
}

export async function forwardAgentExecutorDispatch(
  stub: AgentExecutorDispatchStub,
  body: AgentExecutorDispatchPayload,
): Promise<Response> {
  try {
    const result = await stub.dispatchStart(body);
    return new Response(result.body, { status: result.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: `Failed to start container: ${message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
