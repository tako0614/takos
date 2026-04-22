import type {
  AppPublication,
  AppPublicationOutput,
} from "../app-manifest-types.ts";
import {
  asRecord,
  asRequiredString,
  asString,
  asStringArray,
} from "../app-manifest-utils.ts";

const PUBLICATION_FIELDS = new Set([
  "name",
  "publisher",
  "type",
  "outputs",
  "title",
  "spec",
]);

const FILE_HANDLER_PUBLICATION_TYPE = "FileHandler";

const FILE_HANDLER_SPEC_FIELDS = new Set([
  "mimeTypes",
  "extensions",
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

function parsePublicationOutputs(
  prefix: string,
  raw: unknown,
): Record<string, AppPublicationOutput> {
  if (raw == null) {
    throw new Error(`${prefix}.outputs is required`);
  }
  const record = asRecord(raw);
  const outputs: Record<string, AppPublicationOutput> = {};
  for (const [name, value] of Object.entries(record)) {
    const outputPrefix = `${prefix}.outputs.${name}`;
    const output = asRecord(value);
    assertAllowedFields(output, outputPrefix, new Set(["route"]));
    const route = asString(output.route, `${outputPrefix}.route`);
    if (!route) {
      throw new Error(`${outputPrefix}.route is required`);
    }
    if (!route.startsWith("/")) {
      throw new Error(`${outputPrefix}.route must start with '/' (got: ${route})`);
    }
    outputs[name] = { route };
  }
  if (Object.keys(outputs).length === 0) {
    throw new Error(`${prefix}.outputs must declare at least one output`);
  }
  return outputs;
}

function firstRouteOutput(
  outputs: Record<string, AppPublicationOutput>,
): string | undefined {
  return Object.values(outputs).find((output) => output.route)?.route;
}

function validateFileHandlerPublication(
  prefix: string,
  outputs: Record<string, AppPublicationOutput>,
  spec: Record<string, unknown> | undefined,
): void {
  const path = firstRouteOutput(outputs);
  if (!fileHandlerPathHasIdTemplate(path)) {
    throw new Error(`${prefix}.outputs must include a route with :id for FileHandler`);
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

export function parsePublicationEntry(
  index: number,
  raw: unknown,
  prefixBase = "publish",
): AppPublication {
  const prefix = `${prefixBase}[${index}]`;
  const record = asRecord(raw);
  assertAllowedFields(record, prefix, PUBLICATION_FIELDS);

  const name = asRequiredString(record.name, `${prefix}.name`);
  const publisher = asRequiredString(record.publisher, `${prefix}.publisher`);
  const type = asRequiredString(record.type, `${prefix}.type`);
  if (publisher === "takos") {
    throw new Error(
      `${prefix}.publisher 'takos' is not supported in app manifests; consume platform publications such as takos.api-key instead`,
    );
  }
  const outputs = parsePublicationOutputs(prefix, record.outputs);
  const title = asString(record.title, `${prefix}.title`);
  const spec = parseOptionalSpec(prefix, record.spec);

  if (type === FILE_HANDLER_PUBLICATION_TYPE) {
    validateFileHandlerPublication(prefix, outputs, spec);
  }

  return {
    name,
    publisher,
    type,
    outputs,
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
    for (const output of Object.values(entry.outputs ?? {})) {
      if (!output.route) continue;
      const routeKey = `${entry.publisher}\0${output.route}`;
      const previous = routePublisherPaths.get(routeKey);
      if (previous != null) {
        throw new Error(
          `publish[${index}] duplicate route publication publisher/route '${entry.publisher} ${output.route}' duplicates publish[${previous}]`,
        );
      }
      routePublisherPaths.set(routeKey, index);
    }
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
    parsePublicationEntry(index, entry, "publish")
  );
  validateUniqueness(entries);
  return entries;
}
