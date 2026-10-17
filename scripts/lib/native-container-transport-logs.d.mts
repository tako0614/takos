import type { DockerCandidate, NativeContainerWitness } from "./native-container-proof-ownership.ts";

type TransportLogFile = { path: string; bytes: number; sha256: string };

export type NativeContainerTransportLogCapture = {
  physicalId: string;
  runId: string;
  containerId: string;
  durableObjectId: string;
  phase: string;
  since: string;
  expectedName: string;
  capturedAt: string;
  capturePath: string;
  stdout: TransportLogFile;
  stderr: TransportLogFile;
  debugLines: number;
};

export function captureNativeContainerTransportLogs(options: {
  witness: NativeContainerWitness & {
    dockerContainers: Array<Omit<DockerCandidate, "pid"> & { pid?: number }>;
  };
  beforeIds: Set<string>;
  agentImage: string;
  agentImageId: string;
  outputDir: string;
  phase: string;
  since: string;
  command: (name: string, args: string[], timeout: number, maxBuffer: number) => Promise<{
    stdout: Buffer | Uint8Array;
    stderr: Buffer | Uint8Array;
  }>;
  requireDebug?: boolean;
}): Promise<NativeContainerTransportLogCapture>;
