import type { AppPublication } from "../app-manifest-types.ts";
import {
  asRecord,
  asRequiredString,
  asString,
  asStringArray,
} from "../app-manifest-utils.ts";
import {
  normalizeGrantPublication,
  type PublicationNormalizeOptions,
} from "../../platform/publication-catalog.ts";

const PUBLICATION_FIELDS = new Set([
  "name",
  "publisher",
  "type",
  "path",
  "title",
  "spec",
]);

const TAKOS_PUBLICATION_TYPES = new Set([
  "api-key",
  "oauth-client",
]);

const FILE_HANDLER_PUBLICATION_TYPE = "FileHandler";

const FILE_HANDLER_SPEC_FIELDS = new Set([
  "mimeTypes",
  "extensions",
]);

const TAKOS_API_KEY_SPEC_FIELDS = new Set([
  "scopes",
]);

const TAKOS_OAUTH_SPEC_FIELDS = new Set([
  "clientName",
  "redirectUris",
  "scopes",
  "metadata",
]);

const TAKOS_OAUTH_METADATA_FIELDS = new Set([
  "logoUri",
  "tosUri",
  "policyUri",
]);

function fileHandlerPathHasIdTemplate(path: string | undefined): boolean {
  return typeof path === "string" &&
    path.split("/").some((segment) => segment === ":id");
}

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

function parseOptionalSpec(
  prefix: string,
  value: unknown,
): Record<string, unknown> | undefined {
  if (value == null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${prefix}.spec must be an object`);
  }
  return value as Record<string, unknown>;
}

function validateFileHandlerPublication(
  prefix: string,
  path: string | undefined,
  spec: Record<string, unknown> | undefined,
): void {
  if (!fileHandlerPathHasIdTemplate(path)) {
    throw new Error(`${prefix}.path must include :id for FileHandler`);
  }

  const mimeTypes = asStringArray(spec?.mimeTypes, `${prefix}.spec.mimeTypes`);
  const extensions = asStringArray(
    spec?.extensions,
    `${prefix}.spec.extensions`,
  );

  if ((mimeTypes?.length ?? 0) === 0 && (extensions?.length ?? 0) === 0) {
    throw new Error(
      `${prefix}.spec.mimeTypes or ${prefix}.spec.extensions is required for FileHandler`,
    );
  }
  if (spec) {
    assertAllowedFields(spec, `${prefix}.spec`, FILE_HANDLER_SPEC_FIELDS);
  }
}

function validateTakosGrantSpec(
  prefix: string,
  type: string,
  spec: Record<string, unknown> | undefined,
): void {
  if (!spec) return;
  if (type === "api-key") {
    assertAllowedFields(spec, `${prefix}.spec`, TAKOS_API_KEY_SPEC_FIELDS);
    return;
  }
  if (type !== "oauth-client") return;
  assertAllowedFields(spec, `${prefix}.spec`, TAKOS_OAUTH_SPEC_FIELDS);
  const metadata = spec.metadata;
  if (
    metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata)
  ) {
    assertAllowedFields(
      metadata as Record<string, unknown>,
      `${prefix}.spec.metadata`,
      TAKOS_OAUTH_METADATA_FIELDS,
    );
  }
}

export function parsePublicationEntry(
  index: number,
  raw: unknown,
  prefixBase = "publish",
  options: PublicationNormalizeOptions = {},
): AppPublication {
  const prefix = `${prefixBase}[${index}]`;
  const record = asRecord(raw);
  assertAllowedFields(record, prefix, PUBLICATION_FIELDS);

  const name = asRequiredString(record.name, `${prefix}.name`);
  const publisher = asRequiredString(record.publisher, `${prefix}.publisher`);
  const type = asRequiredString(record.type, `${prefix}.type`);
  const path = asString(record.path, `${prefix}.path`);
  const title = asString(record.title, `${prefix}.title`);
  const spec = parseOptionalSpec(prefix, record.spec);

  if (publisher === "takos") {
    if (record.path != null) {
      throw new Error(`${prefix}.path is not supported for publisher 'takos'`);
    }
    if (record.title != null) {
      throw new Error(`${prefix}.title is not supported for publisher 'takos'`);
    }
    if (!TAKOS_PUBLICATION_TYPES.has(type)) {
      throw new Error(
        `${prefix}.type is unsupported for publisher 'takos': ${type}`,
      );
    }
    validateTakosGrantSpec(prefix, type, spec);
    return normalizeGrantPublication({
      name,
      publisher,
      type,
      ...(spec ? { spec } : {}),
    }, options);
  }

  if (!path) {
    throw new Error(`${prefix}.path is required for non-Takos publications`);
  }
  if (!path.startsWith("/")) {
    throw new Error(`${prefix}.path must start with '/' (got: ${path})`);
  }

  if (type === FILE_HANDLER_PUBLICATION_TYPE) {
    validateFileHandlerPublication(prefix, path, spec);
  }

  return {
    name,
    publisher,
    type,
    path,
    ...(title ? { title } : {}),
    ...(spec ? { spec } : {}),
  };
}

function validateUniqueness(entries: AppPublication[]): void {
  const seen = new Set<string>();
  const routePublisherPaths = new Map<string, number>();
  entries.forEach((entry, index) => {
    const key = entry.name.trim();
    if (seen.has(key)) {
      throw new Error(`publish[${index}] duplicate publication name: ${key}`);
    }
    seen.add(key);
    if (entry.publisher === "takos" || !entry.path) return;
    const routeKey = `${entry.publisher}\0${entry.path}`;
    const previous = routePublisherPaths.get(routeKey);
    if (previous != null) {
      throw new Error(
        `publish[${index}] duplicate route publication publisher/path '${entry.publisher} ${entry.path}' duplicates publish[${previous}]`,
      );
    }
    routePublisherPaths.set(routeKey, index);
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
    parsePublicationEntry(index, entry, "publish", {
      allowRelativeOAuthRedirectUris: true,
    })
  );
  validateUniqueness(entries);
  return entries;
}
