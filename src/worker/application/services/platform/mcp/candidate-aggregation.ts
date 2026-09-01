import type {
  McpRegistryCandidateProvenance,
  McpRegistryPackage,
  McpRegistrySearchCandidate,
} from "./registry-sources.ts";

class TripleIndex<A, B, C> {
  readonly #values = new Map<A, Map<B, Set<C>>>();

  add(first: A, second: B, third: C): boolean {
    let bySecond = this.#values.get(first);
    if (!bySecond) {
      bySecond = new Map();
      this.#values.set(first, bySecond);
    }
    let thirds = bySecond.get(second);
    if (!thirds) {
      thirds = new Set();
      bySecond.set(second, thirds);
    }
    if (thirds.has(third)) return false;
    thirds.add(third);
    return true;
  }
}

interface IndexedCandidate {
  readonly candidate: McpRegistrySearchCandidate;
  readonly provenance: TripleIndex<string, string, string>;
  readonly packages: TripleIndex<
    McpRegistryPackage["registryType"],
    string,
    string | null
  >;
}

export interface McpRegistryCandidateAccumulator {
  add(candidate: McpRegistrySearchCandidate): void;
  values(): McpRegistrySearchCandidate[];
}

/**
 * Merge candidate contributions in first-seen order while indexing each
 * provenance and package identity once. The first candidate object remains the
 * result owner, matching the previous in-place aggregation behavior.
 */
export function createMcpRegistryCandidateAccumulator(): McpRegistryCandidateAccumulator {
  const candidates = new Map<string, IndexedCandidate>();

  return {
    add(candidate) {
      const key = candidateIdentity(candidate);
      const existing = candidates.get(key);
      if (!existing) {
        candidates.set(key, indexCandidate(candidate));
        return;
      }

      for (const provenance of candidate.provenance) {
        if (addProvenance(existing.provenance, provenance)) {
          existing.candidate.provenance.push(provenance);
        }
      }
      existing.candidate.requiresConfiguration ||=
        candidate.requiresConfiguration;
      for (const packageEntry of candidate.packages) {
        if (addPackage(existing.packages, packageEntry)) {
          existing.candidate.packages.push(packageEntry);
        }
      }
    },
    values: () => [...candidates.values()].map(({ candidate }) => candidate),
  };
}

function candidateIdentity(candidate: McpRegistrySearchCandidate): string {
  return candidate.url ?? `package:${candidate.name}@${candidate.version}`;
}

function indexCandidate(
  candidate: McpRegistrySearchCandidate,
): IndexedCandidate {
  const provenance = new TripleIndex<string, string, string>();
  for (const item of candidate.provenance) addProvenance(provenance, item);
  const packages = new TripleIndex<
    McpRegistryPackage["registryType"],
    string,
    string | null
  >();
  for (const item of candidate.packages) addPackage(packages, item);
  return { candidate, provenance, packages };
}

function addProvenance(
  index: TripleIndex<string, string, string>,
  provenance: McpRegistryCandidateProvenance,
): boolean {
  return index.add(
    provenance.sourceId,
    provenance.serverName,
    provenance.serverVersion,
  );
}

function addPackage(
  index: TripleIndex<McpRegistryPackage["registryType"], string, string | null>,
  packageEntry: McpRegistryPackage,
): boolean {
  return index.add(
    packageEntry.registryType,
    packageEntry.identifier,
    packageEntry.version,
  );
}
