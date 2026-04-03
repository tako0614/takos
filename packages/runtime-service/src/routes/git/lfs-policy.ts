import path from "node:path";

export const LFS_OID_PATTERN = /^[a-f0-9]{64}$/i;
export const LFS_CONTENT_TYPE = "application/vnd.git-lfs+json";
export const MAX_LFS_UPLOAD_BYTES = 1024 * 1024 * 1024;
export const LFS_UPLOAD_TOO_LARGE_ERROR =
  "LFS upload payload exceeds maximum size";

export interface LfsBatchObjectDescriptor {
  oid: string;
  size: number;
}

export interface ParsedLfsBatchRequest {
  operation: "upload" | "download";
  objects: LfsBatchObjectDescriptor[];
}

export interface LfsBatchObjectResponse {
  oid: string;
  size: number;
  actions?: {
    upload?: {
      href: string;
      expires_in: number;
    };
    download?: {
      href: string;
      expires_in: number;
    };
  };
  error?: {
    code: number;
    message: string;
  };
}

export function normalizeLfsOid(oid: string | undefined): string | null {
  if (typeof oid !== "string" || !LFS_OID_PATTERN.test(oid)) {
    return null;
  }
  return oid.toLowerCase();
}

export function parseLfsBatchRequest(
  body: unknown,
): ParsedLfsBatchRequest | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const operation = (body as { operation?: unknown }).operation;
  const objects = (body as { objects?: unknown }).objects;

  if (
    (operation !== "upload" && operation !== "download") ||
    !Array.isArray(objects)
  ) {
    return null;
  }

  const parsedObjects: LfsBatchObjectDescriptor[] = [];
  for (const object of objects) {
    if (!object || typeof object !== "object") {
      return null;
    }

    const oid = normalizeLfsOid(
      (object as { oid?: unknown }).oid as string | undefined,
    );
    const size = (object as { size?: unknown }).size;

    if (
      !oid ||
      typeof size !== "number" ||
      !Number.isFinite(size) ||
      size < 0
    ) {
      return null;
    }

    parsedObjects.push({ oid, size });
  }

  return {
    operation,
    objects: parsedObjects,
  };
}

export function getLfsObjectPath(repoGitDir: string, oid: string): string {
  return path.resolve(
    repoGitDir,
    "lfs",
    "objects",
    oid.slice(0, 2),
    oid.slice(2, 4),
    oid,
  );
}

export function buildLfsBatchObjectResponse(params: {
  operation: "upload" | "download";
  oid: string;
  size: number;
  exists: boolean;
  href: string;
}): LfsBatchObjectResponse {
  const { operation, oid, size, exists, href } = params;

  if (operation === "upload") {
    if (exists) {
      return { oid, size };
    }
    return {
      oid,
      size,
      actions: {
        upload: {
          href,
          expires_in: 3600,
        },
      },
    };
  }

  if (!exists) {
    return {
      oid,
      size,
      error: {
        code: 404,
        message: "Object does not exist",
      },
    };
  }

  return {
    oid,
    size,
    actions: {
      download: {
        href,
        expires_in: 3600,
      },
    },
  };
}

export function parseContentLength(
  headerValue: string | undefined,
): number | null {
  if (typeof headerValue !== "string" || headerValue.trim().length === 0) {
    return null;
  }
  if (!/^\d+$/.test(headerValue)) {
    return NaN;
  }
  return Number.parseInt(headerValue, 10);
}
