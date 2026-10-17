export const MAX_CHECKPOINT_BYTES: number;
export const MAX_INLINE_CHECKPOINT_BYTES: number;

export type NativeCheckpointExpected = {
  runId: string;
  serviceId: string;
  leaseVersion: number;
  pendingToolCallId: string;
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number };
};

export type NativeCheckpointWitness = {
  readonly storage: "inline" | "r2";
  readonly storedSha256: string;
  readonly serializedSha256: string;
  readonly serializedBytes: number;
  readonly graphId: string;
  readonly node: string;
  readonly status: string;
  readonly loopId: string;
  readonly sessionId: string;
  readonly pendingToolCallIds: readonly string[];
  readonly usage: Readonly<NativeCheckpointExpected["usage"]>;
};

export type NativeCheckpointCapture = {
  readonly witness: NativeCheckpointWitness;
  readonly rawSerialized: Uint8Array;
};

type CheckpointObjectReader = (key: string) => Promise<{
  size: number;
  body: ReadableStream<Uint8Array>;
} | null>;

export function captureCheckpointWitness(options: {
  stored: unknown;
  expected: NativeCheckpointExpected;
  readObject?: CheckpointObjectReader;
}): Promise<NativeCheckpointCapture>;

export function assertCheckpointUnchanged(options: {
  beforeStored: unknown;
  beforeCapture: unknown;
  afterStored: unknown;
  expected: NativeCheckpointExpected;
  readObject?: CheckpointObjectReader;
}): Promise<NativeCheckpointCapture>;
