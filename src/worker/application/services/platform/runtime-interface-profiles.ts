import type { AuthorizedRuntimeInterface } from "./runtime-interface-client.ts";
import {
  FILE_HANDLER_INTERFACE_TYPE,
  FILE_HANDLER_INTERFACE_VERSION,
  hasCredentialQueryParams,
  MCP_SERVER_INTERFACE_TYPE,
  MCP_SERVER_INTERFACE_VERSION,
  parseInterfaceDisplay,
  UI_SURFACE_INTERFACE_TYPE,
  UI_SURFACE_INTERFACE_VERSION,
} from "takosumi-contract";

export type RuntimeInterfaceAdapterMode =
  | "executable"
  | "discovery-only"
  | "metadata-only";

export interface RuntimeInterfaceProtocolAdapter {
  readonly type: string;
  readonly mode: RuntimeInterfaceAdapterMode;
  /** The concrete consumer adapter, when this Takos surface can execute it. */
  readonly adapter: "mcp" | null;
  readonly version?: string;
}

const RUNTIME_INTERFACE_PROTOCOL_ADAPTERS: readonly RuntimeInterfaceProtocolAdapter[] =
  [
    {
      type: MCP_SERVER_INTERFACE_TYPE,
      version: MCP_SERVER_INTERFACE_VERSION,
      mode: "executable",
      adapter: "mcp",
    },
    {
      type: "http.openapi",
      mode: "discovery-only",
      adapter: null,
    },
    {
      type: "storage.s3",
      mode: "discovery-only",
      adapter: null,
    },
  ];

/**
 * Return the explicit protocol adapter for an Interface type. Interface type
 * namespaces are open: an unregistered type remains inspectable as metadata,
 * but this consumer never invents an execution path for it.
 */
export function getRuntimeInterfaceProtocolAdapter(
  type: unknown,
): RuntimeInterfaceProtocolAdapter {
  const normalized = typeof type === "string" ? type.trim() : "";
  return (
    RUNTIME_INTERFACE_PROTOCOL_ADAPTERS.find(
      (adapter) => adapter.type === normalized,
    ) ?? {
      type: normalized || "unknown",
      mode: "metadata-only",
      adapter: null,
    }
  );
}

export function listRuntimeInterfaceProtocolAdapters(): readonly RuntimeInterfaceProtocolAdapter[] {
  return RUNTIME_INTERFACE_PROTOCOL_ADAPTERS;
}

export type AuthorizedUiSurface = {
  readonly id: string;
  readonly interfaceName: string;
  readonly name: string;
  readonly description: string | null;
  readonly icon: string | null;
  readonly url: string;
  readonly category: string | null;
  readonly sortOrder: number | null;
  readonly ownerKind: "Workspace" | "Capsule" | "Resource";
  readonly ownerId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type AuthorizedFileHandler = {
  readonly idx: number;
  readonly id: string;
  readonly name: string;
  readonly title?: string;
  readonly mimeTypes: string[];
  readonly extensions: string[];
  readonly openUrl: string;
};

type AuthorizedRuntimeInterfaceProjection = Pick<
  AuthorizedRuntimeInterface,
  "interface"
>;

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function safeRuntimeUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    hasCredentialQueryParams(url.searchParams)
  ) {
    return null;
  }
  return url.toString();
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

function normalizeFileExtension(value: string): string {
  return value.startsWith(".") ? value : `.${value}`;
}

export function projectAuthorizedUiSurface(
  entry: AuthorizedRuntimeInterfaceProjection,
): AuthorizedUiSurface | null {
  const iface = entry.interface;
  if (
    iface.spec.type !== UI_SURFACE_INTERFACE_TYPE ||
    iface.spec.version !== UI_SURFACE_INTERFACE_VERSION
  ) {
    return null;
  }
  const document = readRecord(iface.spec.document);
  if (document?.launcher !== true || !iface.spec.inputs?.url) return null;
  const url = safeRuntimeUrl(iface.status.resolvedInputs?.url);
  if (!url) return null;
  const display = parseInterfaceDisplay(document.display, { surfaceUrl: url });
  const icon = display.icon
    ? display.icon.kind === "image"
      ? display.icon.url
      : display.icon.glyph
    : null;
  return {
    id: iface.metadata.id,
    interfaceName: iface.metadata.name,
    name: display.title ?? iface.metadata.name,
    description: display.description ?? null,
    icon,
    url,
    category: display.category ?? null,
    sortOrder: display.sortOrder ?? null,
    ownerKind: iface.metadata.ownerRef.kind,
    ownerId: iface.metadata.ownerRef.id,
    createdAt: iface.metadata.createdAt,
    updatedAt: iface.metadata.updatedAt,
  };
}

export function projectAuthorizedFileHandler(
  entry: AuthorizedRuntimeInterfaceProjection,
  idx: number,
): AuthorizedFileHandler | null {
  const iface = entry.interface;
  if (
    iface.spec.type !== FILE_HANDLER_INTERFACE_TYPE ||
    iface.spec.version !== FILE_HANDLER_INTERFACE_VERSION
  ) {
    return null;
  }
  const document = readRecord(iface.spec.document);
  if (!document || !iface.spec.inputs?.openUrl) return null;
  const openUrl = safeRuntimeUrl(iface.status.resolvedInputs?.openUrl);
  if (!openUrl) return null;
  let path: string;
  try {
    path = new URL(openUrl).pathname;
  } catch {
    return null;
  }
  if (!path.split("/").some((segment) => segment === ":id")) return null;
  const mimeTypes = readStringList(document.mimeTypes);
  const extensions = readStringList(document.extensions).map(
    normalizeFileExtension,
  );
  if (mimeTypes.length === 0 && extensions.length === 0) return null;
  const display = parseInterfaceDisplay(document.display, {
    surfaceUrl: openUrl,
  });
  return {
    idx,
    id: iface.metadata.id,
    name: iface.metadata.name,
    ...(display.title ? { title: display.title } : {}),
    mimeTypes,
    extensions,
    openUrl,
  };
}
