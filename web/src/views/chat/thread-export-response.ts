import {
  MAX_DIRECT_THREAD_EXPORT_BODY_BYTES,
  type ThreadExportDownloadFormat,
} from "takos-api-contract/thread-export";

const EXPECTED_MEDIA_TYPES: Record<ThreadExportDownloadFormat, string> = {
  markdown: "text/markdown",
  json: "application/json",
};

function safeDownloadFilename(value: string): string | null {
  if (
    value.length < 1 ||
    value.length > 255 ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value) ||
    value === "." ||
    value === ".."
  ) {
    return null;
  }
  return value;
}

export function parseContentDispositionFilename(
  value: string | null,
): string | null {
  if (!value || value.length > 1_024) return null;
  const utf8 = /(?:^|;)\s*filename\*=UTF-8''([^;]+)/iu.exec(value);
  if (utf8?.[1]) {
    try {
      return safeDownloadFilename(decodeURIComponent(utf8[1].trim()));
    } catch {
      return null;
    }
  }
  const plain = /(?:^|;)\s*filename="?([^";]+)"?/iu.exec(value);
  return plain?.[1] ? safeDownloadFilename(plain[1].trim()) : null;
}

function assertExportMediaType(
  response: Response,
  format: ThreadExportDownloadFormat,
): string {
  const contentType = response.headers.get("content-type") ?? "";
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== EXPECTED_MEDIA_TYPES[format]) {
    throw new TypeError("Unexpected Thread export content type");
  }
  return contentType;
}

export async function readBoundedThreadExportBlob(
  response: Response,
  format: ThreadExportDownloadFormat,
): Promise<Blob> {
  const contentType = assertExportMediaType(response, format);
  const maximumBytes = MAX_DIRECT_THREAD_EXPORT_BODY_BYTES;
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(contentLength)) {
      throw new TypeError("Invalid Thread export content length");
    }
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maximumBytes) {
      throw new TypeError("Thread export response is too large");
    }
  }

  const reader = response.body?.getReader();
  if (!reader) throw new TypeError("Thread export response body is missing");
  const chunks: ArrayBuffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel("Thread export response is too large");
        throw new TypeError("Thread export response is too large");
      }
      chunks.push(chunk.value.slice().buffer as ArrayBuffer);
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(chunks, { type: contentType });
}
