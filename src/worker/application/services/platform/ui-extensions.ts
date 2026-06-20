/**
 * UI Extension Service
 *
 * bundle deployment による UI 拡張の管理
 */

import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import { asRecord } from "../../../shared/utils/guards.ts";
import {
  isPublicationType,
  listPublications,
  type PublicationRecord,
  publicationResolvedUrl,
  SERVICE_GRAPH_CAPABILITIES,
} from "./service-publications.ts";

export interface UIExtension {
  id: string;
  spaceId: string;
  path: string;
  label: string;
  icon?: string;
  bundleR2Key: string;
  sidebar?: {
    label: string;
    icon: string;
    path?: string;
    url?: string;
  };
  bundleDeploymentId?: string;
  createdAt: string;
}

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

function sidebarItemFromUiSurfacePublication(
  record: PublicationRecord,
): UISidebarItem | null {
  const url = publicationResolvedUrl(record);
  if (!url) return null;
  const spec = record.publication.spec ?? {};
  const display = record.publication.display ?? {};
  const sidebarSpec = asRecord(spec.sidebar);
  const label =
    readOptionalString(sidebarSpec, "label") ?? display.title ?? record.name;
  const icon =
    readOptionalString(sidebarSpec, "icon") ??
    display.icon ??
    readOptionalString(spec, "icon") ??
    "app";
  const path = readOptionalString(sidebarSpec, "path");
  return {
    label,
    icon,
    ...(path ? { path } : {}),
    url,
    extensionId: `publication:${record.id}`,
  };
}

/**
 * Get sidebar items for workspace from UiSurface route publications.
 */
export async function getUISidebarItems(
  db: SqlDatabaseBinding,
  spaceId: string,
): Promise<UISidebarItem[]> {
  const publicationItems = (await listPublications({ DB: db }, spaceId))
    .filter((record) =>
      isPublicationType(
        record.publicationType,
        SERVICE_GRAPH_CAPABILITIES.interfaceUiSurface,
      ),
    )
    .map(sidebarItemFromUiSurfacePublication)
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return publicationItems;
}
