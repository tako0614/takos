import {
  fetchAuthorizedRuntimeInterfaces,
  parseResolvedRuntimeInterface,
  type AuthorizedRuntimeInterface,
  type RuntimeInterfaceFetch,
} from "../platform/runtime-interface-client.ts";
import {
  projectAuthorizedFileHandler,
  projectAuthorizedUiSurface,
  getRuntimeInterfaceProtocolAdapter,
  safeRuntimeUrl,
} from "../platform/runtime-interface-profiles.ts";
import {
  FILE_HANDLER_INTERFACE_TYPE,
  FILE_HANDLER_OPEN_PERMISSION,
  MCP_SERVER_INTERFACE_TYPE,
  MCP_SERVER_INTERFACE_VERSION,
  MCP_SERVER_INVOKE_PERMISSION,
  UI_SURFACE_INTERFACE_TYPE,
  UI_SURFACE_INTERFACE_VERSION,
  UI_SURFACE_OPEN_PERMISSION,
} from "@takosjp/takosumi-contract/interface-types";

/**
 * Takos launcher/service presentation derived from authorized Takosumi
 * Interface + InterfaceBinding records. OpenTofu Outputs are apply evidence,
 * never runtime discovery.
 */

export type WorkloadServiceStatus =
  | "ready"
  | "not_configured"
  | "unavailable"
  | "unknown";

export interface CapsuleWorkloadServiceSummary {
  id: string;
  capability: string;
  status: WorkloadServiceStatus;
  endpoint: string | null;
  secret_configured: boolean;
  token_expires_at: string | null;
}

export interface CapsuleUiSurfaceServiceProjection {
  readonly capsuleId: string;
  readonly service: CapsuleWorkloadServiceSummary;
}

export interface TakosumiControlReadConfig {
  baseUrl: string;
  token?: string;
  subjectId?: string;
  fetch?: RuntimeInterfaceFetch;
}

function readyService(
  entry: Pick<AuthorizedRuntimeInterface, "interface">,
  endpoint: string,
): CapsuleWorkloadServiceSummary {
  return {
    id: `interface:${entry.interface.metadata.name}`,
    capability: entry.interface.spec.type,
    status: "ready",
    endpoint,
    secret_configured: false,
    token_expires_at: null,
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Project the Accounts plane's bounded, already-authorized Workspace launcher
 * page. The account plane performs the current Principal Binding join; this
 * consumer still validates the complete UI Interface document and its owner.
 */
export function projectCapsuleUiSurfaceServices(
  body: unknown,
  workspaceId: string,
): CapsuleUiSurfaceServiceProjection[] {
  const root = readRecord(body);
  if (!Array.isArray(root?.interfaces)) return [];
  return root.interfaces.flatMap((value) => {
    const iface = parseResolvedRuntimeInterface(value, {
      workspaceId,
      type: UI_SURFACE_INTERFACE_TYPE,
      permission: UI_SURFACE_OPEN_PERMISSION,
      deliveryTypes: ["none"],
    });
    if (
      !iface ||
      iface.spec.version !== UI_SURFACE_INTERFACE_VERSION ||
      iface.metadata.ownerRef.kind !== "Capsule"
    ) {
      return [];
    }
    const surface = projectAuthorizedUiSurface({ interface: iface });
    if (!surface) return [];
    const capsuleId = iface.metadata.ownerRef.id;
    if (!capsuleId) return [];
    return [{
      capsuleId,
      service: readyService({ interface: iface }, surface.url),
    }];
  });
}

function projectMcpService(
  entry: AuthorizedRuntimeInterface,
): CapsuleWorkloadServiceSummary | null {
  const iface = entry.interface;
  const protocolAdapter = getRuntimeInterfaceProtocolAdapter(iface.spec.type);
  if (
    protocolAdapter.mode !== "executable" ||
    protocolAdapter.adapter !== "mcp" ||
    protocolAdapter.version !== MCP_SERVER_INTERFACE_VERSION
  ) {
    return null;
  }
  if (
    iface.spec.type !== MCP_SERVER_INTERFACE_TYPE ||
    iface.spec.version !== MCP_SERVER_INTERFACE_VERSION
  ) {
    return null;
  }
  const endpoint = safeRuntimeUrl(iface.status.resolvedInputs?.endpoint);
  return endpoint ? readyService(entry, endpoint) : null;
}

async function fetchAuthorizedCapsuleInterfaces(
  capsuleId: string,
  workspaceId: string,
  config: Required<
    Pick<TakosumiControlReadConfig, "baseUrl" | "token" | "subjectId">
  > &
    Pick<TakosumiControlReadConfig, "fetch">,
): Promise<CapsuleWorkloadServiceSummary[]> {
  const request = (
    type: string,
    permission: string,
    deliveryTypes: readonly string[],
  ) =>
    fetchAuthorizedRuntimeInterfaces(
      {
        workspaceId,
        ownerKind: "Capsule",
        ownerId: capsuleId,
        type,
        permission,
        deliveryTypes,
      },
      config,
    );
  const [uiEntries, fileEntries, mcpEntries] = await Promise.all([
    request(UI_SURFACE_INTERFACE_TYPE, UI_SURFACE_OPEN_PERMISSION, ["none"]),
    request(FILE_HANDLER_INTERFACE_TYPE, FILE_HANDLER_OPEN_PERMISSION, [
      "none",
    ]),
    request(MCP_SERVER_INTERFACE_TYPE, MCP_SERVER_INVOKE_PERMISSION, [
      "none",
      "oauth2",
    ]),
  ]);

  return [
    ...uiEntries.flatMap((entry) => {
      const surface = projectAuthorizedUiSurface(entry);
      return surface ? [readyService(entry, surface.url)] : [];
    }),
    ...fileEntries.flatMap((entry, index) => {
      const handler = projectAuthorizedFileHandler(entry, index);
      return handler ? [readyService(entry, handler.openUrl)] : [];
    }),
    ...mcpEntries.flatMap((entry) => {
      const service = projectMcpService(entry);
      return service ? [service] : [];
    }),
  ].sort(
    (left, right) =>
      left.capability.localeCompare(right.capability) ||
      left.id.localeCompare(right.id),
  );
}

export async function fetchCapsuleWorkloadServices(
  capsuleId: string,
  workspaceId: string,
  config: TakosumiControlReadConfig | undefined,
): Promise<CapsuleWorkloadServiceSummary[]> {
  const token = config?.token?.trim();
  const subjectId = config?.subjectId?.trim();
  if (!config || !token || !subjectId) return [];
  try {
    return await fetchAuthorizedCapsuleInterfaces(capsuleId, workspaceId, {
      baseUrl: config.baseUrl,
      token,
      subjectId,
      ...(config.fetch ? { fetch: config.fetch } : {}),
    });
  } catch {
    return [];
  }
}
