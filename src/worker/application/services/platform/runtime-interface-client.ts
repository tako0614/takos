import type {
  Interface as TakosumiInterface,
  InterfaceBinding,
} from "takosumi-contract";
import {
  isValidInterfaceName,
  isValidInterfacePermissionToken,
  TAKOSUMI_API_VERSION,
} from "takosumi-contract";

export type RuntimeInterfaceFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface RuntimeInterfaceRequestConfig {
  readonly baseUrl: string;
  readonly token: string;
  readonly subjectId: string;
  readonly fetch?: RuntimeInterfaceFetch;
}

export interface RuntimeInterfaceSelector {
  readonly workspaceId: string;
  readonly type: string;
  readonly permission: string;
  readonly deliveryTypes: readonly string[];
}

export interface AuthorizedRuntimeInterface {
  readonly interface: TakosumiInterface;
  readonly binding: InterfaceBinding;
}

const MAX_INTERFACE_LIST_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_INTERFACE_BINDINGS_RESPONSE_BYTES = 256 * 1024;
const MAX_INTERFACE_TOKEN_RESPONSE_BYTES = 64 * 1024;
const MAX_INTERFACE_ACCESS_TOKEN_LENGTH = 8_192;

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

async function readBoundedJsonResponse(
  response: Response,
  maxBytes: number,
): Promise<unknown | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }

  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch {
    return null;
  }
}

function interfacesUrl(
  baseUrl: string,
  selector: RuntimeInterfaceSelector,
): URL {
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/+$/u, "");
  url.pathname = basePath.endsWith("/v1/interfaces")
    ? basePath
    : `${basePath}/v1/interfaces`;
  url.search = "";
  url.hash = "";
  url.searchParams.set("workspaceId", selector.workspaceId);
  url.searchParams.set("type", selector.type);
  url.searchParams.set("phase", "Resolved");
  url.searchParams.set("permission", selector.permission);
  return url;
}

function interfaceBindingsUrl(
  baseUrl: string,
  interfaceId: string,
  permission: string,
): URL {
  const url = new URL(baseUrl);
  let basePath = url.pathname.replace(/\/+$/u, "");
  if (!basePath.endsWith("/v1/interfaces")) {
    basePath = `${basePath}/v1/interfaces`;
  }
  url.pathname = `${basePath}/${encodeURIComponent(interfaceId)}/bindings`;
  url.search = "";
  url.hash = "";
  url.searchParams.set("permission", permission);
  return url;
}

function interfaceTokenUrl(baseUrl: string, interfaceId: string): URL {
  const url = new URL(baseUrl);
  let basePath = url.pathname.replace(/\/+$/u, "");
  if (!basePath.endsWith("/v1/interfaces")) {
    basePath = `${basePath}/v1/interfaces`;
  }
  url.pathname = `${basePath}/${encodeURIComponent(interfaceId)}/token`;
  url.search = "";
  url.hash = "";
  return url;
}

function parseResolvedRuntimeInterface(
  value: unknown,
  selector: RuntimeInterfaceSelector,
): TakosumiInterface | null {
  const iface = readRecord(value);
  const metadata = readRecord(iface?.metadata);
  const ownerRef = readRecord(metadata?.ownerRef);
  const spec = readRecord(iface?.spec);
  const access = readRecord(spec?.access);
  const status = readRecord(iface?.status);
  const generation = readNonNegativeInteger(metadata?.generation);
  const observedGeneration = readNonNegativeInteger(status?.observedGeneration);
  const resolvedRevision = readNonNegativeInteger(status?.resolvedRevision);
  const id = readString(metadata?.id);
  const name = readString(metadata?.name);
  return iface?.apiVersion === TAKOSUMI_API_VERSION &&
    iface.kind === "Interface" &&
    metadata?.workspaceId === selector.workspaceId &&
    id !== null &&
    name !== null &&
    isValidInterfaceName(name) &&
    ownerRef !== null &&
    (ownerRef.kind === "Workspace" ||
      ownerRef.kind === "Capsule" ||
      ownerRef.kind === "Resource") &&
    readString(ownerRef.id) !== null &&
    generation !== null &&
    generation >= 1 &&
    spec !== null &&
    spec.type === selector.type &&
    readString(spec.version) !== null &&
    access !== null &&
    (access.visibility === "private" ||
      access.visibility === "workspace" ||
      access.visibility === "public") &&
    (access.resourceUriInput === undefined ||
      readString(access.resourceUriInput) !== null) &&
    status !== null &&
    status.phase === "Resolved" &&
    observedGeneration === generation &&
    resolvedRevision !== null &&
    resolvedRevision >= 1
    ? (value as TakosumiInterface)
    : null;
}

function parseAuthorizedRuntimeBinding(
  value: unknown,
  iface: TakosumiInterface,
  selector: RuntimeInterfaceSelector,
  config: RuntimeInterfaceRequestConfig,
): InterfaceBinding | null {
  const binding = readRecord(value);
  const metadata = readRecord(binding?.metadata);
  const spec = readRecord(binding?.spec);
  const subjectRef = readRecord(spec?.subjectRef);
  const delivery = readRecord(spec?.delivery);
  const status = readRecord(binding?.status);
  const generation = readNonNegativeInteger(metadata?.generation);
  return binding?.apiVersion === TAKOSUMI_API_VERSION &&
    binding.kind === "InterfaceBinding" &&
    metadata?.workspaceId === selector.workspaceId &&
    readString(metadata.id) !== null &&
    generation !== null &&
    generation >= 1 &&
    spec?.interfaceId === iface.metadata.id &&
    subjectRef?.kind === "Principal" &&
    subjectRef.id === config.subjectId &&
    Array.isArray(spec.permissions) &&
    spec.permissions.includes(selector.permission) &&
    typeof delivery?.type === "string" &&
    selector.deliveryTypes.includes(delivery.type) &&
    delivery.credentialRef === undefined &&
    delivery.options === undefined &&
    status?.phase === "Ready" &&
    status.observedInterfaceRevision === iface.status.resolvedRevision
    ? (value as InterfaceBinding)
    : null;
}

async function authorizedRuntimeBinding(
  iface: TakosumiInterface,
  selector: RuntimeInterfaceSelector,
  config: RuntimeInterfaceRequestConfig,
  headers: Headers,
): Promise<InterfaceBinding | null> {
  try {
    const response = await (config.fetch ?? fetch)(
      interfaceBindingsUrl(
        config.baseUrl,
        iface.metadata.id,
        selector.permission,
      ),
      { headers, redirect: "manual" },
    );
    if (!response.ok) return null;
    const body = readRecord(
      await readBoundedJsonResponse(
        response,
        MAX_INTERFACE_BINDINGS_RESPONSE_BYTES,
      ),
    );
    if (!body || !Array.isArray(body.bindings)) return null;
    return (
      body.bindings
        .map((candidate) =>
          parseAuthorizedRuntimeBinding(candidate, iface, selector, config),
        )
        .find((candidate) => candidate !== null) ?? null
    );
  } catch {
    return null;
  }
}

/**
 * Read resolved Interfaces and retain only exact Ready Principal bindings.
 * Visibility is discovery policy; this binding check is runtime authority.
 */
export async function fetchAuthorizedRuntimeInterfaces(
  selector: RuntimeInterfaceSelector,
  config: RuntimeInterfaceRequestConfig,
): Promise<AuthorizedRuntimeInterface[]> {
  if (
    !readString(config.token) ||
    !readString(config.subjectId) ||
    !isValidInterfacePermissionToken(selector.permission)
  ) {
    return [];
  }
  const headers = new Headers({
    accept: "application/json",
    authorization: `Bearer ${config.token}`,
  });
  try {
    const response = await (config.fetch ?? fetch)(
      interfacesUrl(config.baseUrl, selector),
      { headers, redirect: "manual" },
    );
    if (!response.ok) return [];
    const body = readRecord(
      await readBoundedJsonResponse(
        response,
        MAX_INTERFACE_LIST_RESPONSE_BYTES,
      ),
    );
    if (!body || !Array.isArray(body.interfaces)) return [];
    const candidates = body.interfaces
      .map((entry) => parseResolvedRuntimeInterface(entry, selector))
      .filter((entry): entry is TakosumiInterface => entry !== null)
      .slice(0, 64);
    const authorized = await Promise.all(
      candidates.map(async (iface) => ({
        interface: iface,
        binding: await authorizedRuntimeBinding(
          iface,
          selector,
          config,
          headers,
        ),
      })),
    );
    return authorized.filter(
      (
        entry,
      ): entry is {
        readonly interface: TakosumiInterface;
        readonly binding: InterfaceBinding;
      } => entry.binding !== null,
    );
  } catch {
    return [];
  }
}

/**
 * Ask Core for one invocation-only credential after it revalidates the exact
 * Interface/Binding revision. The delegated Accounts token is never returned
 * to the runtime service.
 */
export async function issueRuntimeInterfaceAccessToken(
  config: RuntimeInterfaceRequestConfig,
  input: {
    readonly interfaceId: string;
    readonly permission: string;
    readonly resource: string;
    readonly errorLabel: string;
  },
): Promise<string> {
  if (
    !readString(input.interfaceId) ||
    !isValidInterfacePermissionToken(input.permission) ||
    !readString(input.resource)
  ) {
    throw new Error(`${input.errorLabel} credential request is invalid`);
  }
  const response = await (config.fetch ?? fetch)(
    interfaceTokenUrl(config.baseUrl, input.interfaceId),
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ permission: input.permission }),
      redirect: "manual",
    },
  );
  if (!response.ok) {
    throw new Error(
      `${input.errorLabel} credential issuance failed (${response.status})`,
    );
  }
  const body = readRecord(
    await readBoundedJsonResponse(response, MAX_INTERFACE_TOKEN_RESPONSE_BYTES),
  );
  const accessToken =
    typeof body?.access_token === "string" ? body.access_token : null;
  const expiresIn = readNonNegativeInteger(body?.expires_in);
  const expiresAt = readString(body?.expires_at);
  const resource = readString(body?.resource);
  const expiresAtMillis = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  const nowMillis = Date.now();
  if (
    !accessToken ||
    accessToken !== accessToken.trim() ||
    /\s/u.test(accessToken) ||
    accessToken.length > MAX_INTERFACE_ACCESS_TOKEN_LENGTH ||
    accessToken === config.token ||
    body?.token_type !== "Bearer" ||
    expiresIn === null ||
    expiresIn < 1 ||
    expiresIn > 60 ||
    !Number.isFinite(expiresAtMillis) ||
    expiresAtMillis <= nowMillis ||
    expiresAtMillis - nowMillis > 60_000 ||
    body?.scope !== input.permission ||
    body?.refresh_token !== undefined ||
    resource !== input.resource
  ) {
    throw new Error(`${input.errorLabel} credential response is invalid`);
  }
  return accessToken;
}

export type { TakosumiInterface };
