import { expect, test } from "bun:test";

import { createMcpRegistryCandidateAccumulator } from "../mcp/candidate-aggregation.ts";
import type {
  McpRegistryCandidateProvenance,
  McpRegistryPackage,
  McpRegistrySearchCandidate,
} from "../mcp/registry-sources.ts";

function provenance(
  sourceId: string,
  serverName = sourceId,
  serverVersion = "1.0.0",
): McpRegistryCandidateProvenance {
  return {
    sourceId,
    sourceName: sourceId,
    sourceKind: "custom",
    baseUrl: `https://${sourceId}.example`,
    priority: 0,
    preview: false,
    bestEffort: false,
    serverName,
    serverVersion,
  };
}

function registryPackage(
  identifier: string,
  version: string | null = "1.0.0",
): McpRegistryPackage {
  return {
    registryType: "npm",
    registryBaseUrl: null,
    identifier,
    version,
    fileSha256: null,
    transportType: "stdio",
    transportUrl: null,
    runtimeHint: "node",
    requiresConfiguration: false,
  };
}

function candidate(
  input: {
    readonly name?: string;
    readonly title?: string;
    readonly version?: string;
    readonly url?: string | null;
    readonly requiresConfiguration?: boolean;
    readonly provenance?: McpRegistryCandidateProvenance[];
    readonly packages?: McpRegistryPackage[];
  } = {},
): McpRegistrySearchCandidate {
  return {
    name: input.name ?? "io.example/connector",
    title: input.title ?? "Connector",
    description: "description",
    version: input.version ?? "1.0.0",
    url: input.url === undefined ? "https://connector.example/mcp" : input.url,
    transport: input.url === null ? "package" : "streamable-http",
    repositoryUrl: null,
    repositorySubfolder: null,
    requiresConfiguration: input.requiresConfiguration ?? false,
    packages: input.packages ?? [],
    provenance: input.provenance ?? [],
  };
}

function countPropertyReads<T extends object>(
  item: T,
  keys: readonly (keyof T)[],
  onRead: () => void,
): void {
  for (const key of keys) {
    const value = item[key];
    Object.defineProperty(item, key, {
      configurable: true,
      enumerable: true,
      get: () => {
        onRead();
        return value;
      },
    });
  }
}

test("keeps first-candidate metadata and stable unique contribution order", () => {
  const firstProvenance = provenance("source-a", "server-a");
  const firstPackage = registryPackage("package-a");
  const first = candidate({
    title: "First metadata wins",
    provenance: [firstProvenance],
    packages: [firstPackage],
  });
  const duplicateProvenance = provenance("source-a", "server-a");
  const novelProvenance = provenance("source-b", "server-b");
  const duplicatePackage = registryPackage("package-a");
  const novelPackage = registryPackage("package-b");
  const second = candidate({
    title: "Later metadata",
    requiresConfiguration: true,
    provenance: [duplicateProvenance, novelProvenance, novelProvenance],
    packages: [duplicatePackage, novelPackage, novelPackage],
  });
  const secondProvenanceSnapshot = [...second.provenance];
  const secondPackagesSnapshot = [...second.packages];
  const accumulator = createMcpRegistryCandidateAccumulator();

  accumulator.add(first);
  accumulator.add(second);

  const result = accumulator.values();
  expect(result).toHaveLength(1);
  expect(result[0]).toBe(first);
  expect(result[0]!.title).toBe("First metadata wins");
  expect(result[0]!.requiresConfiguration).toBe(true);
  expect(result[0]!.provenance).toEqual([firstProvenance, novelProvenance]);
  expect(result[0]!.provenance[0]).toBe(firstProvenance);
  expect(result[0]!.provenance[1]).toBe(novelProvenance);
  expect(result[0]!.packages).toEqual([firstPackage, novelPackage]);
  expect(result[0]!.packages[0]).toBe(firstPackage);
  expect(result[0]!.packages[1]).toBe(novelPackage);
  expect(second.provenance).toEqual(secondProvenanceSnapshot);
  expect(second.packages).toEqual(secondPackagesSnapshot);
});

test("uses URL or package name and version as the existing candidate identity", () => {
  const endpoint = candidate({
    name: "first-name",
    version: "1.0.0",
    url: "https://connector.example/mcp",
  });
  const sameEndpoint = candidate({
    name: "other-name",
    version: "2.0.0",
    url: "https://connector.example/mcp",
  });
  const packageV1 = candidate({
    name: "io.example/package",
    version: "1.0.0",
    url: null,
  });
  const packageV2 = candidate({
    name: "io.example/package",
    version: "2.0.0",
    url: null,
  });
  const accumulator = createMcpRegistryCandidateAccumulator();

  accumulator.add(endpoint);
  accumulator.add(sameEndpoint);
  accumulator.add(packageV1);
  accumulator.add(packageV2);

  expect(accumulator.values()).toEqual([endpoint, packageV1, packageV2]);
});

test("indexes every contribution identity once across one requested-page fan-in", () => {
  const contributionCount = 17 * 50;
  let identityReads = 0;
  const accumulator = createMcpRegistryCandidateAccumulator();

  for (let index = 0; index < contributionCount; index += 1) {
    const itemProvenance = provenance(`source-${index}`, `server-${index}`);
    const itemPackage = registryPackage(`package-${index}`);
    countPropertyReads(
      itemProvenance,
      ["sourceId", "serverName", "serverVersion"],
      () => {
        identityReads += 1;
      },
    );
    countPropertyReads(
      itemPackage,
      ["registryType", "identifier", "version"],
      () => {
        identityReads += 1;
      },
    );
    accumulator.add(
      candidate({
        provenance: [itemProvenance],
        packages: [itemPackage],
      }),
    );
  }

  const result = accumulator.values();
  expect(result).toHaveLength(1);
  expect(result[0]!.provenance).toHaveLength(contributionCount);
  expect(result[0]!.packages).toHaveLength(contributionCount);
  expect(identityReads).toBe(6 * contributionCount);
});
