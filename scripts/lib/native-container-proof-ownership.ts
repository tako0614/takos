export type NativeContainerWitness = {
  runId: string;
  containerId: string;
  durableObjectId: string;
  imageTag: string;
  dockerImageId: string;
};
export type DockerCandidate = {
  id: string;
  name: string;
  imageId: string;
  imageReference: string;
  running: boolean;
  pid: number;
};
export type OwnedDockerCandidate = DockerCandidate & { cleanupRole: "agent" | "proxy" };
type DockerInspection = {
  Id?: unknown; Name?: unknown; Image?: unknown; Config?: { Image?: unknown };
  State?: { Running?: unknown; Pid?: unknown; [key: string]: unknown };
};

const hex64 = /^[a-f0-9]{64}$/u;
const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const imageId = /^sha256:[a-f0-9]{64}$/u;

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function nativeRecoveryPoolContainerId(runId: string): string {
  ensure(new RegExp(`^run_${uuid}$`, "u").test(runId), "invalid fresh controller Run identity");
  // The fixture configures one tier-1 slot and a UUID pool revision. The real
  // host still chooses the slot and must return this exact isolated receipt.
  return `tier1-warm-0-${runId.slice(4)}`;
}

export function fixtureContainerName(witness: NativeContainerWitness, agentImage: string, agentImageId: string): string {
  ensure(new RegExp(`^run_${uuid}$`, "u").test(witness?.runId ?? ""), "invalid fresh controller Run identity");
  ensure(new RegExp(`^container_${uuid}$`, "u").test(witness?.containerId ?? "") ||
    witness.containerId === nativeRecoveryPoolContainerId(witness.runId), "invalid fresh physical-slot identity");
  ensure(hex64.test(witness?.durableObjectId ?? ""), "invalid native DO identity");
  ensure(imageId.test(agentImageId) && witness.imageTag === agentImage && witness.dockerImageId === agentImageId,
    "controller image witness differs from inspected artifact");
  return `/workerd-canonical-container-${witness.runId}-ExecutorContainerTier1-${witness.durableObjectId}`;
}

export function selectOwnedStops(options: {
  witness: NativeContainerWitness; beforeIds: Set<string>; candidates: DockerCandidate[];
  agentImage: string; agentImageId: string; sidecarImage: string; sidecarImageId: string;
}): OwnedDockerCandidate[] {
  const { witness, beforeIds, candidates, agentImage, agentImageId, sidecarImage, sidecarImageId } = options;
  ensure(beforeIds instanceof Set && Array.isArray(candidates), "invalid Container baseline or candidates");
  ensure(imageId.test(sidecarImageId), "invalid pinned sidecar identity");
  const name = fixtureContainerName(witness, agentImage, agentImageId);
  const expected = new Map<string, { imageId: string; reference: string; role: "agent" | "proxy" }>([
    [name, { imageId: agentImageId, reference: agentImage, role: "agent" }],
    [name + "-proxy", { imageId: sidecarImageId, reference: sidecarImage, role: "proxy" }],
  ]);
  const seen = new Set<string>();
  const selected: OwnedDockerCandidate[] = [];
  for (const value of candidates) {
    const contract = expected.get(value.name);
    if (!contract || !value.running) continue;
    ensure(hex64.test(value.id ?? "") && !beforeIds.has(value.id), "refusing a preexisting or invalid Container ID");
    ensure(!seen.has(value.id), "duplicate candidate Container ID");
    ensure(value.imageId === contract.imageId && value.imageReference === contract.reference,
      "refusing an exact-name Container with mismatched image");
    ensure(Number.isSafeInteger(value.pid) && value.pid > 0, "running candidate lacks a physical process witness");
    seen.add(value.id);
    selected.push({ ...value, cleanupRole: contract.role });
  }
  return selected;
}

export function assertFreshInspection(expected: DockerCandidate, raw: DockerInspection): { Running: boolean; Pid: number; [key: string]: unknown } {
  ensure(raw?.Id === expected.id && raw.Name === expected.name && raw.Image === expected.imageId &&
    raw.Config?.Image === expected.imageReference, "Container identity changed before owned stop");
  ensure(typeof raw.State?.Running === "boolean" && typeof raw.State.Pid === "number" &&
    Number.isSafeInteger(raw.State.Pid) && raw.State.Pid >= 0, "fresh Container inspection lacks process state");
  return { ...raw.State, Running: raw.State.Running, Pid: raw.State.Pid };
}

export function assertNativeRecoveryWitnesses(options: {
  witnesses: Array<NativeContainerWitness & { dockerContainers: Array<Omit<DockerCandidate, "pid">> }>;
  acknowledgements: Array<{ status: number; containerId: string }>;
  beforeIds: Set<string>;
  agentImage: string;
  agentImageId: string;
}): void {
  const { witnesses, acknowledgements, beforeIds, agentImage, agentImageId } = options;
  ensure(Array.isArray(witnesses) && witnesses.length === 2 && Array.isArray(acknowledgements) && acknowledgements.length === 2,
    "native recovery requires two exact physical witnesses and destroy acknowledgements");
  const logical = new Set<string>();
  const physical = new Set<string>();
  const objects = new Set<string>();
  for (const witness of witnesses) {
    const name = fixtureContainerName(witness, agentImage, agentImageId);
    ensure(witness.runId === witnesses[0]!.runId && !logical.has(witness.containerId) && !objects.has(witness.durableObjectId),
      "native recovery must replace the same Run with a distinct Container and DO");
    logical.add(witness.containerId);
    objects.add(witness.durableObjectId);
    ensure(Array.isArray(witness.dockerContainers) && witness.dockerContainers.length === 1,
      "native admission lacks a single physical Docker witness");
    const docker = witness.dockerContainers[0]!;
    ensure(hex64.test(docker.id) && !beforeIds.has(docker.id) && !physical.has(docker.id) && docker.name === name &&
      docker.imageId === agentImageId && docker.imageReference === agentImage && docker.running === true,
      "native physical witness differs from the fresh exact Run/DO/image");
    physical.add(docker.id);
  }
  const acknowledged = new Set<string>();
  for (const ack of acknowledgements) {
    ensure(ack.status === 200 && logical.has(ack.containerId) && !acknowledged.has(ack.containerId),
      "native destroy acknowledgement does not match both exact Container witnesses");
    acknowledged.add(ack.containerId);
  }
}
