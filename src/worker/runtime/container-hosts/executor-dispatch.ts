export interface AgentExecutorDispatchPayload {
  runId: string;
  workerId: string;
  serviceId: string;
  model?: string;
  leaseVersion?: number;
  executorTier?: 1 | 2 | 3;
  executorContainerId?: string;
}

export interface AgentExecutorControlConfig {
  controlRpcBaseUrl?: string;
  controlRpcToken: string;
  startToken?: string;
}

export interface AgentExecutorStartPayload
  extends AgentExecutorDispatchPayload, AgentExecutorControlConfig {}

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
  dispatchStart(
    body: AgentExecutorDispatchPayload,
  ): Promise<AgentExecutorDispatchResult>;
}

export function resolveAgentExecutorServiceId(
  body: AgentExecutorDispatchPayload,
): string | null {
  const serviceId = body.serviceId?.trim();
  const workerId = body.workerId?.trim();
  if (!serviceId || !workerId) return null;
  return serviceId;
}

export async function dispatchAgentExecutorStart(
  target: AgentExecutorDispatchTarget,
  body: AgentExecutorDispatchPayload,
  controlConfig: AgentExecutorControlConfig,
): Promise<AgentExecutorDispatchResult> {
  const serviceId = resolveAgentExecutorServiceId(body);
  if (!serviceId) {
    return {
      ok: false,
      status: 400,
      body: JSON.stringify({ error: "Missing serviceId or workerId" }),
    };
  }
  await target.startAndWaitForPorts(8080);

  const startPayload: AgentExecutorStartPayload = {
    ...body,
    serviceId,
    ...controlConfig,
  };
  const headers = new Headers({ "Content-Type": "application/json" });
  const startToken = controlConfig.startToken?.trim();
  if (startToken) {
    headers.set("Authorization", `Bearer ${startToken}`);
  }

  const response = await target.fetch(
    new Request("https://executor/start", {
      method: "POST",
      headers,
      body: JSON.stringify(startPayload),
    }),
  );

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
    return new Response(
      JSON.stringify({ error: `Failed to start container: ${message}` }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
