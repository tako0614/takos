import type { AppPublication } from "../app-manifest-types.ts";
import {
  asRecord,
  asRequiredString,
  asString,
  asStringArray,
} from "../app-manifest-utils.ts";

const ROUTE_PUBLICATION_FIELDS = new Set([
  "name",
  "type",
  "path",
  "title",
  "transport",
  "authSecretRef",
  "mimeTypes",
  "extensions",
  "icon",
]);

const PROVIDER_PUBLICATION_FIELDS = new Set([
  "name",
  "provider",
  "kind",
  "spec",
]);

function assertAllowedFields(
  record: Record<string, unknown>,
  prefix: string,
  allowed: ReadonlySet<string>,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new Error(
        `${prefix}.${key} is not supported by the publish/consume contract`,
      );
    }
  }
}

function parseMcpServer(
  prefix: string,
  record: Record<string, unknown>,
): Pick<AppPublication, "transport" | "authSecretRef"> {
  const transport = asString(record.transport, `${prefix}.transport`);
  const authSecretRef = asString(
    record.authSecretRef,
    `${prefix}.authSecretRef`,
  );
  return {
    ...(transport ? { transport } : {}),
    ...(authSecretRef ? { authSecretRef } : {}),
  };
}

function parseFileHandler(
  prefix: string,
  record: Record<string, unknown>,
): Pick<AppPublication, "mimeTypes" | "extensions"> {
  const mimeTypes = asStringArray(record.mimeTypes, `${prefix}.mimeTypes`);
  const extensions = asStringArray(record.extensions, `${prefix}.extensions`);
  if (
    (!mimeTypes || mimeTypes.length === 0) &&
    (!extensions || extensions.length === 0)
  ) {
    throw new Error(
      `${prefix} requires at least one of mimeTypes or extensions`,
    );
  }
  return {
    ...(mimeTypes ? { mimeTypes } : {}),
    ...(extensions ? { extensions } : {}),
  };
}

function parseUiSurface(
  prefix: string,
  record: Record<string, unknown>,
): Pick<AppPublication, "icon" | "title"> {
  const icon = asString(record.icon, `${prefix}.icon`);
  const title = asString(record.title, `${prefix}.title`);
  return {
    ...(icon ? { icon } : {}),
    ...(title ? { title } : {}),
  };
}

function parseRoutePublication(
  index: number,
  record: Record<string, unknown>,
): AppPublication {
  const prefix = `publish[${index}]`;
  assertAllowedFields(record, prefix, ROUTE_PUBLICATION_FIELDS);

  const type = asRequiredString(record.type, `${prefix}.type`);
  const path = asRequiredString(record.path, `${prefix}.path`);
  if (!path.startsWith("/")) {
    throw new Error(`${prefix}.path must start with '/' (got: ${path})`);
  }

  const base: AppPublication = {
    name: asRequiredString(record.name, `${prefix}.name`),
    type,
    path,
  };

  switch (type) {
    case "McpServer":
      return { ...base, ...parseMcpServer(prefix, record) };
    case "FileHandler":
      return { ...base, ...parseFileHandler(prefix, record) };
    case "UiSurface":
      return { ...base, ...parseUiSurface(prefix, record) };
    default:
      return {
        ...base,
        ...(asString(record.title, `${prefix}.title`)
          ? { title: asString(record.title, `${prefix}.title`)! }
          : {}),
      };
  }
}

function parseProviderPublication(
  index: number,
  record: Record<string, unknown>,
): AppPublication {
  const prefix = `publish[${index}]`;
  assertAllowedFields(record, prefix, PROVIDER_PUBLICATION_FIELDS);

  const spec = record.spec == null ? {} : asRecord(record.spec);
  return {
    name: asRequiredString(record.name, `${prefix}.name`),
    provider: asRequiredString(record.provider, `${prefix}.provider`),
    kind: asRequiredString(record.kind, `${prefix}.kind`),
    spec,
  };
}

function parsePublicationEntry(
  index: number,
  raw: unknown,
): AppPublication {
  const record = asRecord(raw);
  if (record.provider != null || record.kind != null) {
    return parseProviderPublication(index, record);
  }
  return parseRoutePublication(index, record);
}

function validateUniqueness(entries: AppPublication[]): void {
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    const key = entry.name.trim();
    if (seen.has(key)) {
      throw new Error(`publish[${index}] duplicate publication name: ${key}`);
    }
    seen.add(key);
  });
}

export function parsePublish(
  topLevel: Record<string, unknown>,
): AppPublication[] {
  if (topLevel.publish == null) {
    return [];
  }
  if (!Array.isArray(topLevel.publish)) {
    throw new Error("publish must be an array");
  }
  const entries = topLevel.publish.map((entry, index) =>
    parsePublicationEntry(index, entry)
  );
  validateUniqueness(entries);
  return entries;
}
