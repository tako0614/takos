// ============================================================
// parse-publish.ts
// ============================================================
//
// Flat-schema publication parser (Phase 1).
//
// Walks the top-level `publish[]` array and builds
// `AppPublication[]`. Replaces the old `parseMcpServers` and
// `parseFileHandlers` (which lived under `spec.mcpServers` and
// `spec.fileHandlers`).
//
// `type` is an open string; the kernel validates known types.
// Phase 1 recognizes:
//   - McpServer (transport, authSecretRef)
//   - FileHandler (mimeTypes, extensions — at least one required)
//   - UiSurface (icon, title)
//
// The `name` field is required when multiple publications share
// both group (derived from `type`) and `type`. Phase 1 applies
// this check after collecting all entries.
// ============================================================

import type { AppPublication } from "../app-manifest-types.ts";
import {
  asRecord,
  asRequiredString,
  asString,
  asStringArray,
} from "../app-manifest-utils.ts";

// ============================================================
// Known type validators
// ============================================================

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
): Pick<AppPublication, "icon"> {
  const icon = asString(record.icon, `${prefix}.icon`);
  return {
    ...(icon ? { icon } : {}),
  };
}

// ============================================================
// Single publication entry
// ============================================================

function parsePublicationEntry(
  index: number,
  raw: unknown,
): AppPublication {
  const prefix = `publish[${index}]`;
  const record = asRecord(raw);

  const type = asRequiredString(record.type, `${prefix}.type`);
  const path = asRequiredString(record.path, `${prefix}.path`);
  if (!path.startsWith("/")) {
    throw new Error(`${prefix}.path must start with '/' (got: ${path})`);
  }
  const name = asString(record.name, `${prefix}.name`);
  const title = asString(record.title, `${prefix}.title`);

  const base: AppPublication = {
    type,
    path,
    ...(name ? { name } : {}),
    ...(title ? { title } : {}),
  };

  switch (type) {
    case "McpServer":
      return { ...base, ...parseMcpServer(prefix, record) };
    case "FileHandler":
      return { ...base, ...parseFileHandler(prefix, record) };
    case "UiSurface":
      return { ...base, ...parseUiSurface(prefix, record) };
    default:
      // Unknown type — preserve open-string behavior so the kernel
      // can validate its own first-party types.
      return base;
  }
}

// ============================================================
// Duplicate-name validation
// ============================================================

function validateUniqueness(entries: AppPublication[]): void {
  const countsByType = new Map<string, number>();
  for (const entry of entries) {
    countsByType.set(entry.type, (countsByType.get(entry.type) ?? 0) + 1);
  }
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    if ((countsByType.get(entry.type) ?? 0) <= 1) return;
    if (!entry.name) {
      throw new Error(
        `publish[${index}] requires 'name' when multiple ${entry.type} publications exist`,
      );
    }
    const key = `${entry.type}::${entry.name}`;
    if (seen.has(key)) {
      throw new Error(
        `publish[${index}] duplicate ${entry.type} publication name: ${entry.name}`,
      );
    }
    seen.add(key);
  });
}

// ============================================================
// Top-level publication walker
// ============================================================

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
