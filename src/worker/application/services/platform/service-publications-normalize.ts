import type {
  AppCompute,
  AppConsume,
  AppPublication,
} from "../source/app-manifest-types.ts";
import { normalizeEnvName } from "../common-env/crypto.ts";

export { normalizeEnvName };

export interface PublicationOutputDescriptor {
  name: string;
  defaultEnv: string;
  secret: boolean;
  kind: "url" | "string" | "secret";
}

export const ROUTE_PUBLICATION_FIELDS = new Set([
  "name",
  "publisher",
  "type",
  "outputs",
  "display",
  "auth",
  "spec",
]);

export const STANDARD_PUBLICATION_TYPES: Record<string, string> = {
  McpServer: "takos.mcp-server.v1",
  FileHandler: "takos.file-handler.v1",
  UiSurface: "takos.ui-surface.v1",
};

export const RETIRED_TAKOS_API_KEY_TYPE = "api-key";

export function canonicalPublicationType(type: string): string {
  return STANDARD_PUBLICATION_TYPES[type] ?? type;
}

export function isPublicationType(
  type: string,
  canonicalType: string,
): boolean {
  return canonicalPublicationType(type) === canonicalType;
}

export function parseJsonRecord(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function parsePublicationRecord(raw: string): AppPublication {
  const record = parseJsonRecord(raw);
  const publication: AppPublication = {
    name: typeof record.name === "string" ? record.name : "",
    ...(typeof record.publisher === "string"
      ? { publisher: record.publisher }
      : {}),
    type: typeof record.type === "string" ? record.type : "",
  };
  if (
    record.outputs &&
    typeof record.outputs === "object" &&
    !Array.isArray(record.outputs)
  ) {
    publication.outputs = record.outputs as AppPublication["outputs"];
  }
  if (
    record.display &&
    typeof record.display === "object" &&
    !Array.isArray(record.display)
  ) {
    publication.display = record.display as AppPublication["display"];
  }
  if (
    record.auth &&
    typeof record.auth === "object" &&
    !Array.isArray(record.auth)
  ) {
    publication.auth = record.auth as AppPublication["auth"];
  }
  if (
    record.spec &&
    typeof record.spec === "object" &&
    !Array.isArray(record.spec)
  ) {
    publication.spec = record.spec as Record<string, unknown>;
  }
  return publication;
}

export function normalizeName(name: string, field: string): string {
  const normalized = String(name || "").trim();
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

export function isRetiredTakosGrantPublication(
  publication: AppPublication,
): boolean {
  return publication.publisher === "takos";
}

export function isReservedTakosPublicationSource(source: string): boolean {
  return source.trim().startsWith("takos.");
}

export function consumeLocalName(
  consume: Pick<AppConsume, "publication" | "as">,
): string {
  return normalizeName(
    consume.as ?? consume.publication,
    "consume.as",
  );
}

export type ConsumeEntry = {
  computeName: string;
  path: string;
  compute: AppCompute;
  consume: AppConsume;
};

export function attachedWorkloadName(
  parentName: string,
  childName: string,
): string {
  return `${parentName}-${childName}`;
}

export function collectManifestConsumeEntries(manifest: {
  compute?: Record<string, AppCompute>;
}): ConsumeEntry[] {
  const entries: ConsumeEntry[] = [];
  for (const [name, compute] of Object.entries(manifest.compute ?? {})) {
    for (const [index, consume] of (compute.consume ?? []).entries()) {
      entries.push({
        computeName: name,
        path: `compute.${name}.consume[${index}]`,
        compute,
        consume,
      });
    }
    if (compute.kind !== "worker") continue;
    for (const [childName, child] of Object.entries(compute.containers ?? {})) {
      const workloadName = attachedWorkloadName(name, childName);
      for (const [index, consume] of (child.consume ?? []).entries()) {
        entries.push({
          computeName: workloadName,
          path: `compute.${name}.containers.${childName}.consume[${index}]`,
          compute: child,
          consume,
        });
      }
    }
  }
  return entries;
}

export function assertConsumeOutputAliases(
  consume: AppConsume,
  outputs: PublicationOutputDescriptor[],
): void {
  const outputNames = new Set(outputs.map((entry) => entry.name));
  for (const key of Object.keys(consume.inject?.env ?? {})) {
    if (outputNames.has(key)) continue;
    throw new Error(
      `consume '${consume.publication}' maps unknown output '${key}'. Known outputs: ${
        Array.from(outputNames).sort().join(", ")
      }`,
    );
  }
}

export function selectedConsumeOutputs(
  consume: AppConsume,
  outputs: PublicationOutputDescriptor[],
): PublicationOutputDescriptor[] {
  if (consume.inject?.defaults) return outputs;
  const aliases = consume.inject?.env ?? {};
  const selected = new Set(Object.keys(aliases));
  return outputs.filter((output) => selected.has(output.name));
}

export function resolveConsumeOutputEnvName(
  consume: Pick<AppConsume, "inject">,
  output: Pick<PublicationOutputDescriptor, "name" | "defaultEnv">,
): string {
  return normalizeEnvName(
    consume.inject?.env?.[output.name] ??
      output.defaultEnv,
  );
}

export function normalizePublicationEnvSegment(value: string): string {
  const normalized = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return normalized || "PUBLICATION";
}

export function publicationUrlDefaultEnv(name: string): string {
  return `PUBLICATION_${normalizePublicationEnvSegment(name)}_URL`;
}

export function retiredTakosApiOutputEnv(
  name: string,
  output: "ENDPOINT" | "API_KEY",
): string {
  return `PUBLICATION_${normalizePublicationEnvSegment(name)}_${output}`;
}

export function retiredTakosGrantOutputContract(
  publication: AppPublication,
): PublicationOutputDescriptor[] {
  return [
    {
      name: "endpoint",
      defaultEnv: retiredTakosApiOutputEnv(publication.name, "ENDPOINT"),
      secret: false,
      kind: "url",
    },
    {
      name: "apiKey",
      defaultEnv: retiredTakosApiOutputEnv(publication.name, "API_KEY"),
      secret: true,
      kind: "secret",
    },
  ];
}

export function buildPublicUrl(
  hostname: string,
  path: string,
  pathParams: Record<string, string> = {},
): string {
  const normalizedHostname = String(hostname || "").trim();
  if (!normalizedHostname) {
    throw new Error("hostname is required");
  }
  const normalizedPath = String(path || "").trim();
  if (!normalizedPath) {
    throw new Error("path is required");
  }
  const resolvedPath = Object.entries(pathParams).reduce(
    (current, [name, value]) =>
      current.replaceAll(`:${name}`, encodeURIComponent(String(value))),
    normalizedPath,
  );
  if (
    normalizedHostname.startsWith("http://") ||
    normalizedHostname.startsWith("https://")
  ) {
    return `${normalizedHostname}${resolvedPath}`;
  }
  return `https://${normalizedHostname}${resolvedPath}`;
}

export function publicationAllowedFields(
  publication: AppPublication,
): ReadonlySet<string> {
  void publication;
  return ROUTE_PUBLICATION_FIELDS;
}

function normalizeRoutePublication(
  publication: AppPublication,
): AppPublication {
  const name = normalizeName(publication.name, "publication.name");
  const publisher = publication.publisher
    ? normalizeName(publication.publisher, "publication.publisher")
    : undefined;
  const type = canonicalPublicationType(
    normalizeName(publication.type || "", "publication.type"),
  );
  if (publisher === "takos") {
    throw new Error(
      `publication '${name}' uses reserved publisher 'takos'; use AppGrant/AppBinding credentials from Takosumi Accounts instead`,
    );
  }
  if (!publication.outputs || Object.keys(publication.outputs).length === 0) {
    throw new Error(`publication '${name}'.outputs is required`);
  }
  const outputs: AppPublication["outputs"] = {};
  for (const [outputName, output] of Object.entries(publication.outputs)) {
    const kind = output.kind ?? "url";
    if (!["url", "string", "secret"].includes(kind)) {
      throw new Error(
        `publication '${name}'.outputs.${outputName}.kind must be url, string, or secret`,
      );
    }
    if (kind !== "url") {
      throw new Error(
        `publication '${name}'.outputs.${outputName}.kind must be url for route outputs`,
      );
    }
    const routeRef = output.routeRef?.trim();
    if (!routeRef) {
      throw new Error(
        `publication '${name}'.outputs.${outputName}.routeRef is required`,
      );
    }
    outputs[outputName] = {
      kind,
      routeRef,
    };
  }
  if (
    publication.spec != null &&
    (typeof publication.spec !== "object" || Array.isArray(publication.spec))
  ) {
    throw new Error(`publication '${name}'.spec must be an object`);
  }
  return {
    name,
    ...(publisher ? { publisher } : {}),
    type,
    outputs,
    ...(publication.display ? { display: publication.display } : {}),
    ...(publication.auth ? { auth: publication.auth } : {}),
    ...(publication.spec ? { spec: publication.spec } : {}),
  };
}

export function normalizePublicationDefinition(
  publication: AppPublication,
): AppPublication {
  const name = normalizeName(publication.name, "publication.name");
  return normalizeRoutePublication({
    ...publication,
    name,
  });
}

export function normalizeServiceConsumes(
  consumes: AppConsume[] | undefined,
): AppConsume[] {
  if (!consumes) return [];
  const seen = new Set<string>();
  return consumes.map((consume) => {
    const publication = normalizeName(
      consume.publication,
      "consume.publication",
    );
    const alias = consume.as
      ? normalizeName(consume.as, `consume '${publication}'.as`)
      : undefined;
    const localName = alias ?? publication;
    if (seen.has(localName)) {
      throw new Error(
        `consume contains duplicate local consume name: ${localName}`,
      );
    }
    seen.add(localName);
    const request = consume.request
      ? (() => {
        if (
          typeof consume.request !== "object" ||
          Array.isArray(consume.request)
        ) {
          throw new Error(`consume '${localName}'.request must be an object`);
        }
        return consume.request;
      })()
      : undefined;
    const rawInject = consume.inject;
    const injectEnv = rawInject?.env
      ? Object.fromEntries(
        Object.entries(rawInject.env).map(([outputName, envName]) => [
          normalizeName(outputName, `consume '${localName}'.inject.env output`),
          normalizeEnvName(envName),
        ]),
      )
      : undefined;
    const inject = rawInject
      ? {
        ...(injectEnv && Object.keys(injectEnv).length > 0
          ? { env: injectEnv }
          : {}),
        ...(rawInject.defaults != null
          ? { defaults: Boolean(rawInject.defaults) }
          : {}),
      }
      : undefined;
    return {
      publication,
      ...(alias ? { as: alias } : {}),
      ...(request ? { request } : {}),
      ...(inject && Object.keys(inject).length > 0 ? { inject } : {}),
    };
  });
}
