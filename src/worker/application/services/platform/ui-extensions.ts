import { asRecord } from "../../../shared/utils/guards.ts";
import {
  fetchAuthorizedRuntimeInterfaces,
  type AuthorizedRuntimeInterface,
} from "./runtime-interface-client.ts";
import type { RuntimeInterfaceAuthorization } from "./runtime-interface-authorization.ts";
import { projectAuthorizedUiSurface } from "./runtime-interface-profiles.ts";
import {
  UI_SURFACE_INTERFACE_TYPE,
  UI_SURFACE_OPEN_PERMISSION,
} from "takosumi-contract";

type UISidebarItem = {
  label: string;
  icon: string;
  path?: string;
  url?: string;
  extensionId: string;
};

function readOptionalString(
  record: Record<string, unknown> | null,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export const uiExtensionDeps = {
  fetchAuthorizedRuntimeInterfaces,
};

function sidebarItemFromUiSurface(
  entry: AuthorizedRuntimeInterface,
): UISidebarItem | null {
  const surface = projectAuthorizedUiSurface(entry);
  if (!surface) return null;
  const document = asRecord(entry.interface.spec.document);
  const sidebarSpec = asRecord(document?.sidebar);
  const label =
    readOptionalString(sidebarSpec, "label") ?? surface.name;
  const icon =
    readOptionalString(sidebarSpec, "icon") ??
    surface.icon ??
    "app";
  const path = readOptionalString(sidebarSpec, "path");
  return {
    label,
    icon,
    ...(path ? { path } : {}),
    url: surface.url,
    extensionId: `interface:${surface.id}`,
  };
}

/**
 * Get sidebar items from the caller's exact authorized UI Interfaces.
 */
export async function getUISidebarItems(
  authorization: RuntimeInterfaceAuthorization,
): Promise<UISidebarItem[]> {
  return (
    await uiExtensionDeps.fetchAuthorizedRuntimeInterfaces(
      {
        workspaceId: authorization.workspaceId,
        type: UI_SURFACE_INTERFACE_TYPE,
        permission: UI_SURFACE_OPEN_PERMISSION,
        deliveryTypes: ["none"],
      },
      authorization,
    )
  )
    .map(sidebarItemFromUiSurface)
    .filter((item): item is NonNullable<typeof item> => item !== null);
}
