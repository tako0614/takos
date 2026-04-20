/**
 * File write/create operation handlers.
 *
 * Consolidates: file_write, file_write_binary, file_copy, file_mkdir.
 */

import type { ToolHandler } from "../../tool-definitions.ts";
import {
  buildSessionPath,
  callSessionApi,
  requireContainer,
  resolveMountPath,
} from "./session.ts";
import {
  isBinaryFile,
  validateBinaryContent,
  validateContent,
} from "./limits.ts";
import { logError, logWarn } from "../../../../shared/utils/logger.ts";
import {
  handleSessionApiResponse,
  setupFileOperation,
} from "./file-operations.ts";

/* ------------------------------------------------------------------ */
/*  file_write                                                         */
/* ------------------------------------------------------------------ */

export const fileWriteHandler: ToolHandler = async (args, context) => {
  const { path, sessionId } = await setupFileOperation(args, context);
  const content = args.content as string;

  validateContent(content, path);

  const r2Key = `session-files/${context.spaceId}/${sessionId}/${path}`;

  const [runtimeResult, r2Result] = await Promise.allSettled([
    callSessionApi(context, "/session/file/write", { path, content }),
    context.storage?.put(r2Key, content, {
      customMetadata: {
        "space-id": context.spaceId,
        "session-id": sessionId,
        "path": path,
        "updated-at": new Date().toISOString(),
      },
    }),
  ]);

  if (r2Result.status === "rejected") {
    logWarn(`R2 backup write failed for ${path}`, {
      module: "tools/custom/file/write-handlers",
      detail: r2Result.reason,
    });
  }

  if (runtimeResult.status === "rejected") {
    logError("Runtime write failed", runtimeResult.reason, {
      module: "tools/custom/file/write-handlers",
    });
    throw new Error(`Failed to write file: ${runtimeResult.reason}`);
  }

  const response = runtimeResult.value;

  const result = await handleSessionApiResponse<{ path: string; size: number }>(
    response,
    "write file",
  );
  return `Written file: ${result.path} (${result.size} bytes)`;
};

/* ------------------------------------------------------------------ */
/*  file_write_binary                                                  */
/* ------------------------------------------------------------------ */

export const fileWriteBinaryHandler: ToolHandler = async (args, context) => {
  const mountPath = await resolveMountPath(
    context,
    args.repo_id as string | undefined,
    args.mount_path as string | undefined,
  );
  const path = buildSessionPath(mountPath, args.path as string);
  const contentBase64 = args.content_base64 as string;

  validateBinaryContent(contentBase64, path);

  requireContainer(context);

  const r2Key = `session-files/${context.spaceId}/${context.sessionId}/${path}`;

  let binaryData: Uint8Array;
  try {
    const binaryString = atob(contentBase64);
    binaryData = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      binaryData[i] = binaryString.charCodeAt(i);
    }
  } catch {
    throw new Error("Invalid base64 content");
  }

  const [runtimeResult, r2Result] = await Promise.allSettled([
    callSessionApi(context, "/session/file/write-binary", {
      path,
      content_base64: contentBase64,
    }),
    context.storage?.put(r2Key, binaryData, {
      customMetadata: {
        "space-id": context.spaceId,
        "session-id": context.sessionId || "",
        "path": path,
        "is-binary": "true",
        "updated-at": new Date().toISOString(),
      },
    }),
  ]);

  if (r2Result.status === "rejected") {
    logWarn(`R2 backup binary write failed for ${path}`, {
      module: "tools/custom/file/write-handlers",
      detail: r2Result.reason,
    });
  }

  if (runtimeResult.status === "rejected") {
    logError("Runtime binary write failed", runtimeResult.reason, {
      module: "tools/custom/file/write-handlers",
    });
    throw new Error(`Failed to write binary file: ${runtimeResult.reason}`);
  }

  const response = runtimeResult.value;
  if (!response.ok) {
    const error = await response.json() as { error: string };
    throw new Error(error.error || "Failed to write binary file");
  }

  const result = await response.json() as { path: string; size: number };
  return `Written binary file: ${result.path} (${result.size} bytes)`;
};

/* ------------------------------------------------------------------ */
/*  file_copy                                                          */
/* ------------------------------------------------------------------ */

export const fileCopyHandler: ToolHandler = async (args, context) => {
  const mountPath = await resolveMountPath(
    context,
    args.repo_id as string | undefined,
    args.mount_path as string | undefined,
  );
  const sourcePath = buildSessionPath(mountPath, args.source_path as string);
  const destPath = buildSessionPath(mountPath, args.dest_path as string);

  requireContainer(context);

  const readResponse = await callSessionApi(context, "/session/file/read", {
    path: sourcePath,
    binary: isBinaryFile(sourcePath),
  });
  if (!readResponse.ok) {
    throw new Error(`Source file not found: ${sourcePath}`);
  }
  const readResult = await readResponse.json() as {
    content: string;
    is_binary?: boolean;
    encoding?: "utf-8" | "base64";
  };

  const isBinary = Boolean(readResult.is_binary) ||
    readResult.encoding === "base64";
  const r2KeyNew =
    `session-files/${context.spaceId}/${context.sessionId}/${destPath}`;
  let binaryData: Uint8Array | null = null;
  if (isBinary) {
    try {
      const binaryString = atob(readResult.content);
      binaryData = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        binaryData[i] = binaryString.charCodeAt(i);
      }
    } catch {
      throw new Error("Invalid base64 content");
    }
  }
  const writeResponse = await callSessionApi(
    context,
    isBinary ? "/session/file/write-binary" : "/session/file/write",
    isBinary
      ? { path: destPath, content_base64: readResult.content }
      : { path: destPath, content: readResult.content },
  );
  if (!writeResponse.ok) {
    const error = await writeResponse.json() as { error: string };
    throw new Error(error.error || "Failed to copy file");
  }

  if (context.storage) {
    try {
      await context.storage.put(
        r2KeyNew,
        isBinary ? (binaryData as Uint8Array) : readResult.content,
        {
          customMetadata: {
            "space-id": context.spaceId,
            "session-id": context.sessionId || "",
            "path": destPath,
            ...(isBinary ? { "is-binary": "true" } : {}),
            "updated-at": new Date().toISOString(),
          },
        },
      );
    } catch (err) {
      logWarn(`R2 backup copy write failed for ${destPath}`, {
        module: "tools/custom/file/write-handlers",
        detail: err,
      });
    }
  }

  return `Copied: ${sourcePath} -> ${destPath}`;
};

/* ------------------------------------------------------------------ */
/*  file_mkdir                                                         */
/* ------------------------------------------------------------------ */

export const fileMkdirHandler: ToolHandler = async (args, context) => {
  const mountPath = await resolveMountPath(
    context,
    args.repo_id as string | undefined,
    args.mount_path as string | undefined,
  );
  const dirPath = buildSessionPath(
    mountPath,
    (args.path as string).replace(/\/+$/, ""),
  );

  requireContainer(context);

  const response = await callSessionApi(context, "/session/file/write", {
    path: `${dirPath}/.gitkeep`,
    content: "",
  });

  if (!response.ok) {
    const error = await response.json() as { error: string };
    throw new Error(error.error || "Failed to create directory");
  }

  return `Created directory: ${dirPath}/`;
};
