// Takos Agent contract — shared types for agent service consumers

export interface StartPayload {
  readonly runId: string;
  readonly workerId: string;
  readonly serviceId?: string;
  readonly model?: string;
  readonly leaseVersion?: number;
  readonly executorTier?: number;
  readonly executorContainerId?: string;
  readonly controlRpcBaseUrl: string;
  readonly controlRpcToken: string;
}

export interface HealthResponse {
  readonly status: "ok";
  readonly service: "takos-agent";
  readonly runs: {
    readonly active: number;
    readonly max: number;
    readonly available: number;
  };
}

export const TAKOS_AGENT_PATHS = {
  health: "/health",
  start: "/start",
} as const;

export const TAKOS_AGENT_SERVICE_ID = "takos-agent" as const;
