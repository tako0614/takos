import { describe, expect, test } from "bun:test";
import { MAX_DIRECT_THREAD_EXPORT_BODY_BYTES } from "takos-api-contract/thread-export";
import {
  parseContentDispositionFilename,
  readBoundedThreadExportBlob,
} from "../../../views/chat/thread-export-response.ts";

describe("Thread export response boundary", () => {
  test("accepts only filesystem-safe attachment filenames", () => {
    expect(
      parseContentDispositionFilename(
        'attachment; filename="Export-thread_1.json"',
      ),
    ).toBe("Export-thread_1.json");
    expect(
      parseContentDispositionFilename(
        "attachment; filename*=UTF-8''Export-thread_1.md",
      ),
    ).toBe("Export-thread_1.md");

    for (const header of [
      'attachment; filename="../../secret.json"',
      "attachment; filename*=UTF-8''Export%2Fsecret.json",
      'attachment; filename="unsafe name.json"',
      `attachment; filename="${"a".repeat(256)}"`,
    ]) {
      expect(parseContentDispositionFilename(header)).toBeNull();
    }
  });

  test("reads a bounded response with the exact media type", async () => {
    const response = new Response('{"ok":true}', {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": "11",
      },
    });

    const blob = await readBoundedThreadExportBlob(response, "json");
    expect(blob.type).toBe("application/json; charset=utf-8");
    expect(await blob.text()).toBe('{"ok":true}');
  });

  test("rejects media type and declared-size drift before reading", async () => {
    await expect(
      readBoundedThreadExportBlob(
        new Response("wrong type", {
          headers: { "Content-Type": "text/plain" },
        }),
        "json",
      ),
    ).rejects.toThrow("content type");

    for (const contentLength of [
      "1.5",
      "-1",
      String(MAX_DIRECT_THREAD_EXPORT_BODY_BYTES + 1),
    ]) {
      await expect(
        readBoundedThreadExportBlob(
          new Response("{}", {
            headers: {
              "Content-Type": "application/json",
              "Content-Length": contentLength,
            },
          }),
          "json",
        ),
      ).rejects.toThrow();
    }
  });

  test("cancels a stream whose actual body exceeds the direct-export limit", async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new Uint8Array(MAX_DIRECT_THREAD_EXPORT_BODY_BYTES),
          );
          controller.enqueue(new Uint8Array([1]));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { "Content-Type": "application/json" } },
    );

    await expect(readBoundedThreadExportBlob(response, "json")).rejects.toThrow(
      "too large",
    );
    expect(cancelled).toBe(true);
  });

  test("rejects a successful response without a body", async () => {
    await expect(
      readBoundedThreadExportBlob(
        new Response(null, {
          headers: { "Content-Type": "application/json" },
        }),
        "json",
      ),
    ).rejects.toThrow("body is missing");
  });
});
