import { assertEquals } from "jsr:@std/assert";
import { isDigestPinnedImageRef } from "../image-ref.ts";

Deno.test("isDigestPinnedImageRef accepts 64-hex digest refs", () => {
  assertEquals(
    isDigestPinnedImageRef(
      "ghcr.io/org/api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    ),
    true,
  );
});

Deno.test("isDigestPinnedImageRef rejects short digest refs and tags", () => {
  assertEquals(isDigestPinnedImageRef("ghcr.io/org/api@sha256:abc123"), false);
  assertEquals(isDigestPinnedImageRef("ghcr.io/org/api:latest"), false);
});
