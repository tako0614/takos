import { getDb } from '../../../infra/db';
import { uiExtensions } from '../../../infra/db/schema';
import type { Env } from '../../../shared/types';
import { nanoid } from 'nanoid';
import { getRequiredPackageFile, normalizePackagePath, getAssetContentType } from './manifest';

export class BundleUIService {
  constructor(private env: Env) {}

  async registerUIExtension(
    spaceId: string,
    bundleDeploymentId: string,
    page: { path: string; label: string; icon?: string; bundle: string },
    files: Map<string, ArrayBuffer>,
    sidebar?: Array<{ label: string; icon: string; path?: string; url?: string }>
  ): Promise<{ id: string; r2Key: string }> {
    const db = getDb(this.env.DB);

    const bundleContent = getRequiredPackageFile(
      files,
      page.bundle,
      `UI bundle not found: ${page.bundle}`
    );

    const r2Key = `ui-extensions/${spaceId}/${bundleDeploymentId}${page.path}/bundle.js`;
    if (this.env.UI_BUNDLES) {
      await this.env.UI_BUNDLES.put(r2Key, bundleContent, {
        httpMetadata: { contentType: 'application/javascript' },
      });
    }

    const sidebarItem = sidebar?.find(s => s.path === page.path);

    const id = nanoid();
    await db.insert(uiExtensions).values({
      id,
      accountId: spaceId,
      path: page.path,
      label: page.label,
      icon: page.icon,
      bundleR2Key: r2Key,
      sidebarJson: sidebarItem ? JSON.stringify(sidebarItem) : null,
      bundleDeploymentId: bundleDeploymentId,
      createdAt: new Date().toISOString(),
    });

    return { id, r2Key };
  }

  async uploadUIAssets(
    spaceId: string,
    bundleDeploymentId: string,
    assetFiles: string[],
    files: Map<string, ArrayBuffer>
  ): Promise<string[]> {
    const uploadedKeys: string[] = [];
    if (!this.env.UI_BUNDLES) return uploadedKeys;

    const uploaded = new Set<string>();
    for (const filePath of assetFiles) {
      const normalizedPath = normalizePackagePath(filePath);
      if (!normalizedPath || uploaded.has(normalizedPath)) {
        continue;
      }
      uploaded.add(normalizedPath);

      const content = getRequiredPackageFile(
        files,
        normalizedPath,
        `UI asset not found: ${filePath}`
      );
      const r2Key = getUIAssetR2Key(spaceId, bundleDeploymentId, normalizedPath);

      await this.env.UI_BUNDLES.put(r2Key, content, {
        httpMetadata: {
          contentType: getAssetContentType(normalizedPath),
        },
      });
      uploadedKeys.push(r2Key);
    }

    return uploadedKeys;
  }

  async registerSidebarLink(
    spaceId: string,
    bundleDeploymentId: string,
    sidebarItem: { label: string; icon: string; url: string }
  ): Promise<string> {
    const db = getDb(this.env.DB);

    const id = nanoid();
    await db.insert(uiExtensions).values({
      id,
      accountId: spaceId,
      path: `__external_link_${id}`,
      label: sidebarItem.label,
      icon: sidebarItem.icon,
      bundleR2Key: '',
      sidebarJson: JSON.stringify(sidebarItem),
      bundleDeploymentId: bundleDeploymentId,
      createdAt: new Date().toISOString(),
    });

    return id;
  }
}

export function getUIAssetR2Key(spaceId: string, bundleDeploymentId: string, assetPath: string): string {
  return `ui-extensions/${spaceId}/${bundleDeploymentId}/assets/${assetPath}`;
}
