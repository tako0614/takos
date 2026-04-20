import { Hono } from "hono";
import { generateId } from "../../../shared/utils/index.ts";
import type { AuthenticatedRouteEnv } from "../route-auth.ts";
import { checkRepoAccess } from "../../../application/services/source/repos.ts";
import { generateExploreInvalidationUrls, hasWriteRole } from "./routes.ts";
import { getDb } from "../../../infra/db/index.ts";
import { repoReleaseAssets, repoReleases } from "../../../infra/db/schema.ts";
import { and, asc, eq } from "drizzle-orm";
import { invalidateCacheOnMutation } from "../../middleware/cache.ts";
import {
  type ReleaseAsset,
  toReleaseAsset,
  toReleaseAssets,
} from "../../../application/services/source/repo-release-assets.ts";
import {
  AuthorizationError,
  BadRequestError,
  InternalError,
  NotFoundError,
} from "takos-common/errors";
import {
  buildAttachmentDisposition,
  sanitizeReleaseAssetFilename,
} from "./release-shared.ts";
import { ok } from "../response-utils.ts";

type ReleaseAssetCategory =
  | "app"
  | "service"
  | "library"
  | "template"
  | "social";

const RELEASE_ASSET_CATEGORIES = new Set<ReleaseAssetCategory>([
  "app",
  "service",
  "library",
  "template",
  "social",
]);

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function parseReleaseAssetUploadMetadata(
  metadataJson: string | undefined,
): ReleaseAsset["bundle_meta"] | undefined {
  if (!metadataJson) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(metadataJson);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }
  const record = parsed as Record<string, unknown>;
  const version = toOptionalString(record.version);
  if (!version) return undefined;

  const metadata: ReleaseAsset["bundle_meta"] = { version };
  const name = toOptionalString(record.name);
  if (name) metadata.name = name;
  const appId = toOptionalString(record.app_id) ??
    toOptionalString(record.appId);
  if (appId) metadata.app_id = appId;
  const description = toOptionalString(record.description);
  if (description) metadata.description = description;
  const icon = toOptionalString(record.icon);
  if (icon) metadata.icon = icon;
  const category = toOptionalString(record.category);
  if (
    category &&
    RELEASE_ASSET_CATEGORIES.has(
      category as ReleaseAssetCategory,
    )
  ) {
    metadata.category = category as ReleaseAssetCategory;
  }

  if (Array.isArray(record.tags)) {
    const tags = record.tags.map(toOptionalString).filter((
      tag,
    ): tag is string => Boolean(tag));
    if (tags.length > 0) metadata.tags = tags;
  }

  if (Array.isArray(record.dependencies)) {
    const dependencies = record.dependencies
      .map((dependency): { repo: string; version: string } | null => {
        if (
          !dependency || typeof dependency !== "object" ||
          Array.isArray(dependency)
        ) {
          return null;
        }
        const dependencyRecord = dependency as Record<string, unknown>;
        const repo = toOptionalString(dependencyRecord.repo);
        const dependencyVersion = toOptionalString(dependencyRecord.version);
        if (!repo || !dependencyVersion) {
          return null;
        }
        return { repo, version: dependencyVersion };
      })
      .filter((dependency): dependency is { repo: string; version: string } =>
        Boolean(dependency)
      );
    if (dependencies.length > 0) metadata.dependencies = dependencies;
  }

  return metadata;
}

const releaseAssets = new Hono<AuthenticatedRouteEnv>()
  .post(
    "/repos/:repoId/releases/:tag/assets",
    invalidateCacheOnMutation([generateExploreInvalidationUrls]),
    async (c) => {
      const user = c.get("user");
      const repoId = c.req.param("repoId");
      const tag = c.req.param("tag");
      const db = getDb(c.env.DB);

      const repoAccess = await checkRepoAccess(c.env, repoId, user.id);
      if (!repoAccess) {
        throw new NotFoundError("Repository");
      }

      if (!hasWriteRole(repoAccess.role)) {
        throw new AuthorizationError();
      }

      const releaseData = await db.select().from(repoReleases)
        .where(and(eq(repoReleases.repoId, repoId), eq(repoReleases.tag, tag)))
        .get();

      if (!releaseData) {
        throw new NotFoundError("Release");
      }

      const contentType = c.req.header("content-type") || "";
      let fileData: ArrayBuffer;
      let uploadedFileName: string;
      let metadataJson: string | undefined;

      if (contentType.includes("multipart/form-data")) {
        const formData = await c.req.formData();
        const file = formData.get("file");
        const metadata = formData.get("metadata");

        if (!file || typeof file === "string") {
          throw new BadRequestError("No file uploaded");
        }
        if (typeof metadata === "string") {
          metadataJson = metadata;
        }

        // After null/string checks, `file` is a File (Blob with name)
        uploadedFileName = file.name || "asset";
        fileData = await file.arrayBuffer();
      } else {
        throw new BadRequestError(
          "Invalid content type. Use multipart/form-data",
        );
      }

      if (fileData.byteLength === 0) {
        throw new BadRequestError("Empty file");
      }

      if (fileData.byteLength > 100 * 1024 * 1024) {
        throw new BadRequestError("File too large. Maximum size is 100MB");
      }

      if (!c.env.GIT_OBJECTS) {
        throw new InternalError("Storage not configured");
      }

      const fileName = sanitizeReleaseAssetFilename(uploadedFileName);
      const fileNameLower = fileName.toLowerCase();
      const assetId = generateId();
      const r2Key =
        `release-assets/${repoId}/${releaseData.id}/${assetId}/${fileName}`;
      const timestamp = new Date().toISOString();

      let detectedContentType = "application/octet-stream";
      if (fileNameLower.endsWith(".zip")) {
        detectedContentType = "application/zip";
      } else if (
        fileNameLower.endsWith(".tar.gz") || fileNameLower.endsWith(".tgz")
      ) {
        detectedContentType = "application/gzip";
      } else if (fileNameLower.endsWith(".json")) {
        detectedContentType = "application/json";
      }

      const bundleMeta = parseReleaseAssetUploadMetadata(metadataJson);

      await c.env.GIT_OBJECTS.put(r2Key, fileData, {
        httpMetadata: { contentType: detectedContentType },
        customMetadata: {
          releaseId: releaseData.id,
          repoId,
          fileName,
          uploadedBy: user.id,
        },
      });

      const newAsset: ReleaseAsset = {
        id: assetId,
        name: fileName,
        content_type: detectedContentType,
        size: fileData.byteLength,
        r2_key: r2Key,
        download_count: 0,
        bundle_format: undefined,
        bundle_meta: bundleMeta,
        created_at: timestamp,
      };

      await db.insert(repoReleaseAssets).values({
        id: assetId,
        releaseId: releaseData.id,
        assetKey: r2Key,
        name: fileName,
        contentType: detectedContentType,
        sizeBytes: fileData.byteLength,
        downloadCount: 0,
        bundleFormat: null,
        bundleMetaJson: bundleMeta ? JSON.stringify(bundleMeta) : null,
        createdAt: timestamp,
      });
      await db.update(repoReleases)
        .set({ updatedAt: timestamp })
        .where(eq(repoReleases.id, releaseData.id));

      return c.json({
        asset: {
          id: newAsset.id,
          name: newAsset.name,
          content_type: newAsset.content_type,
          size: newAsset.size,
          download_count: 0,
          bundle_format: newAsset.bundle_format,
          bundle_meta: newAsset.bundle_meta,
          created_at: newAsset.created_at,
        },
      }, 201);
    },
  )
  .get("/repos/:repoId/releases/:tag/assets/:assetId/download", async (c) => {
    const user = c.get("user");
    const repoId = c.req.param("repoId");
    const tag = c.req.param("tag");
    const assetId = c.req.param("assetId");
    const db = getDb(c.env.DB);

    const repoAccess = await checkRepoAccess(
      c.env,
      repoId,
      user?.id,
      undefined,
      { allowPublicRead: true },
    );
    if (!repoAccess) {
      throw new NotFoundError("Repository");
    }

    const releaseData = await db.select().from(repoReleases)
      .where(and(eq(repoReleases.repoId, repoId), eq(repoReleases.tag, tag)))
      .get();

    if (!releaseData) {
      throw new NotFoundError("Release");
    }

    if (releaseData.isDraft) {
      const canSeeDrafts = hasWriteRole(repoAccess.role);
      if (!canSeeDrafts) {
        throw new NotFoundError("Release");
      }
    }

    const assetRow = await db.select().from(repoReleaseAssets)
      .where(and(
        eq(repoReleaseAssets.id, assetId),
        eq(repoReleaseAssets.releaseId, releaseData.id),
      ))
      .get();
    const asset = assetRow ? toReleaseAsset(assetRow) : null;

    if (!asset) {
      throw new NotFoundError("Asset");
    }

    if (!c.env.GIT_OBJECTS) {
      throw new InternalError("Storage not configured");
    }

    await db.update(repoReleaseAssets)
      .set({ downloadCount: asset.download_count + 1 })
      .where(eq(repoReleaseAssets.id, assetId));
    await db.update(repoReleases)
      .set({ downloads: releaseData.downloads + 1 })
      .where(eq(repoReleases.id, releaseData.id));

    const object = await c.env.GIT_OBJECTS.get(asset.r2_key);

    if (!object) {
      throw new NotFoundError("Asset file");
    }

    const headers = new Headers();
    headers.set("Content-Type", asset.content_type);
    headers.set("Content-Disposition", buildAttachmentDisposition(asset.name));
    headers.set("Content-Length", String(asset.size));

    // R2ObjectBody.body is a ReadableStream; cast required because CF types
    // use their own ReadableStream definition which differs from the standard BodyInit.
    return new Response(object.body as ReadableStream, { headers });
  })
  .delete(
    "/repos/:repoId/releases/:tag/assets/:assetId",
    invalidateCacheOnMutation([generateExploreInvalidationUrls]),
    async (c) => {
      const user = c.get("user");
      const repoId = c.req.param("repoId");
      const tag = c.req.param("tag");
      const assetId = c.req.param("assetId");
      const db = getDb(c.env.DB);

      const repoAccess = await checkRepoAccess(c.env, repoId, user.id);
      if (!repoAccess) {
        throw new NotFoundError("Repository");
      }

      if (!hasWriteRole(repoAccess.role)) {
        throw new AuthorizationError();
      }

      const releaseData = await db.select().from(repoReleases)
        .where(and(eq(repoReleases.repoId, repoId), eq(repoReleases.tag, tag)))
        .get();

      if (!releaseData) {
        throw new NotFoundError("Release");
      }

      const assetRow = await db.select().from(repoReleaseAssets)
        .where(and(
          eq(repoReleaseAssets.id, assetId),
          eq(repoReleaseAssets.releaseId, releaseData.id),
        ))
        .get();
      const asset = assetRow ? toReleaseAsset(assetRow) : null;

      if (!asset) {
        throw new NotFoundError("Asset");
      }

      if (c.env.GIT_OBJECTS) {
        await c.env.GIT_OBJECTS.delete(asset.r2_key);
      }

      await db.delete(repoReleaseAssets).where(
        eq(repoReleaseAssets.id, assetId),
      );
      await db.update(repoReleases)
        .set({ updatedAt: new Date().toISOString() })
        .where(eq(repoReleases.id, releaseData.id));

      return ok(c);
    },
  )
  .get("/repos/:repoId/releases/:tag/assets", async (c) => {
    const user = c.get("user");
    const repoId = c.req.param("repoId");
    const tag = c.req.param("tag");
    const db = getDb(c.env.DB);

    const repoAccess = await checkRepoAccess(
      c.env,
      repoId,
      user?.id,
      undefined,
      { allowPublicRead: true },
    );
    if (!repoAccess) {
      throw new NotFoundError("Repository");
    }

    const releaseData = await db.select().from(repoReleases)
      .where(and(eq(repoReleases.repoId, repoId), eq(repoReleases.tag, tag)))
      .get();

    if (!releaseData) {
      throw new NotFoundError("Release");
    }

    if (releaseData.isDraft) {
      const canSeeDrafts = hasWriteRole(repoAccess.role);
      if (!canSeeDrafts) {
        throw new NotFoundError("Release");
      }
    }

    const assetsData = await db.select().from(repoReleaseAssets)
      .where(eq(repoReleaseAssets.releaseId, releaseData.id))
      .orderBy(asc(repoReleaseAssets.createdAt))
      .all();

    const assets = toReleaseAssets(assetsData);

    return c.json({
      assets: assets.map((a) => ({
        id: a.id,
        name: a.name,
        content_type: a.content_type,
        size: a.size,
        download_count: a.download_count,
        bundle_format: a.bundle_format,
        bundle_meta: a.bundle_meta,
        created_at: a.created_at,
      })),
    });
  });

export default releaseAssets;
