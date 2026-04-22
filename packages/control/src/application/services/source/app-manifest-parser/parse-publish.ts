import type {
  AppPublication,
  AppPublicationOutput,
} from "../app-manifest-types.ts";
import {
  asOptionalInteger,
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
  "display",
  "auth",
  "title",
  "spec",
]);

const STANDARD_PUBLICATION_TYPES: Record<string, string> = {
  McpServer: "takos.mcp-server.v1",
  FileHandler: "takos.file-handler.v1",
  UiSurface: "takos.ui-surface.v1",
};

const FILE_HANDLER_PUBLICATION_TYPE = "takos.file-handler.v1";

const FILE_HANDLER_SPEC_FIELDS = new Set([
  "mimeTypes",
  "extensions",
]);

const OUTPUT_FIELDS = new Set(["kind", "routeRef", "route"]);
const DISPLAY_FIELDS = new Set([
  "title",
  "description",
  "icon",
  "category",
  "sortOrder",
]);
const AUTH_FIELDS = new Set(["bearer"]);
const AUTH_BEARER_FIELDS = new Set(["secretRef"]);
const OUTPUT_KINDS = new Set(["url", "string", "secret"]);

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

function canonicalPublicationType(type: string): string {
  return STANDARD_PUBLICATION_TYPES[type] ?? type;
}

function parseOptionalDisplay(
  prefix: string,
  value: unknown,
): AppPublication["display"] | undefined {
  if (value == null) return undefined;
  const record = asRecord(value);
  assertAllowedFields(record, `${prefix}.display`, DISPLAY_FIELDS);
  const title = asString(record.title, `${prefix}.display.title`);
  const description = asString(
    record.description,
    `${prefix}.display.description`,
  );
  const icon = asString(record.icon, `${prefix}.display.icon`);
  const category = asString(record.category, `${prefix}.display.category`);
  const sortOrder = asOptionalInteger(
    record.sortOrder,
    `${prefix}.display.sortOrder`,
  );
  const display = {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(icon ? { icon } : {}),
    ...(category ? { category } : {}),
    ...(sortOrder != null ? { sortOrder } : {}),
  };
  return Object.keys(display).length > 0 ? display : undefined;
}

function parseOptionalAuth(
  prefix: string,
  value: unknown,
): AppPublication["auth"] | undefined {
  if (value == null) return undefined;
  const record = asRecord(value);
  assertAllowedFields(record, `${prefix}.auth`, AUTH_FIELDS);
  if (record.bearer == null) return undefined;
  const bearer = asRecord(record.bearer);
  assertAllowedFields(bearer, `${prefix}.auth.bearer`, AUTH_BEARER_FIELDS);
  const secretRef = asRequiredString(
    bearer.secretRef,
    `${prefix}.auth.bearer.secretRef`,
  );
  return { bearer: { secretRef } };
}

function legacyAuthSecretRef(
  spec: Record<string, unknown> | undefined,
): string | undefined {
  const value = spec?.authSecretRef;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function specWithoutLegacyAuth(
  spec: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!spec || spec.authSecretRef == null) return spec;
  const { authSecretRef: _authSecretRef, ...rest } = spec;
  return Object.keys(rest).length > 0 ? rest : undefined;
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
    assertAllowedFields(output, outputPrefix, OUTPUT_FIELDS);
    const kind = asString(output.kind, `${outputPrefix}.kind`);
    if (kind && !OUTPUT_KINDS.has(kind)) {
      throw new Error(`${outputPrefix}.kind must be url, string, or secret`);
    }
    const routeRef = asString(output.routeRef, `${outputPrefix}.routeRef`);
    const route = asString(output.route, `${outputPrefix}.route`);
    if (route && routeRef) {
      throw new Error(`${outputPrefix} must not combine route and routeRef`);
    }
    if (!route && !routeRef) {
      throw new Error(`${outputPrefix}.routeRef is required`);
    }
    if (route && !route.startsWith("/")) {
      throw new Error(
        `${outputPrefix}.route must start with '/' (got: ${route})`,
      );
    }
    if (routeRef && !kind) {
      throw new Error(`${outputPrefix}.kind is required when routeRef is used`);
    }
    if (kind && kind !== "url") {
      throw new Error(`${outputPrefix}.kind must be url for route outputs`);
    }
    outputs[name] = {
      ...(kind
        ? { kind: kind as "url" | "string" | "secret" }
        : { kind: "url" }),
      ...(routeRef ? { routeRef } : {}),
      ...(route ? { route } : {}),
    };
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
  if (path && !fileHandlerPathHasIdTemplate(path)) {
    throw new Error(
      `${prefix}.outputs must include a route with :id for FileHandler`,
    );
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
  const type = canonicalPublicationType(
    asRequiredString(record.type, `${prefix}.type`),
  );
  const publisher = asString(record.publisher, `${prefix}.publisher`);
  if (publisher === "takos") {
    throw new Error(
      `${prefix}.publisher 'takos' is not supported in app manifests; consume platform publications such as takos.api-key instead`,
    );
  }
  const outputs = parsePublicationOutputs(prefix, record.outputs);
  const usesLegacyRoute = Object.values(outputs).some((output) => output.route);
  if (usesLegacyRoute && !publisher) {
    throw new Error(`${prefix}.publisher is required when outputs use route`);
  }
  const title = asString(record.title, `${prefix}.title`);
  const display = parseOptionalDisplay(prefix, record.display);
  if (title && display?.title) {
    throw new Error(`${prefix} must not combine title and display.title`);
  }
  const spec = parseOptionalSpec(prefix, record.spec);
  const auth = parseOptionalAuth(prefix, record.auth);
  const authSecretRef = legacyAuthSecretRef(spec);
  if (auth && authSecretRef) {
    throw new Error(`${prefix} must not combine auth and spec.authSecretRef`);
  }
  const normalizedAuth = auth ??
    (authSecretRef ? { bearer: { secretRef: authSecretRef } } : undefined);
  const normalizedDisplay = display ?? (title ? { title } : undefined);
  const normalizedSpec = specWithoutLegacyAuth(spec);

  if (type === FILE_HANDLER_PUBLICATION_TYPE) {
    validateFileHandlerPublication(prefix, outputs, normalizedSpec);
  }

  return {
    name,
    ...(publisher ? { publisher } : {}),
    type,
    outputs,
    ...(normalizedDisplay ? { display: normalizedDisplay } : {}),
    ...(title ? { title } : {}),
    ...(normalizedAuth ? { auth: normalizedAuth } : {}),
    ...(normalizedSpec ? { spec: normalizedSpec } : {}),
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
      if (!output.route || !entry.publisher) continue;
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
  if (topLevel.publish != null && topLevel.publications != null) {
    throw new Error("publish and publications cannot be used together");
  }
  const raw = topLevel.publications ?? topLevel.publish;
  const field = topLevel.publications != null ? "publications" : "publish";
  if (raw == null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new Error(`${field} must be an array`);
  }
  const entries = raw.map((entry, index) =>
    parsePublicationEntry(index, entry, field)
  );
  validateUniqueness(entries);
  return entries;
}
