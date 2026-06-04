/**
 * Client-side replica of the server's materialize permission digest.
 *
 * The materialize endpoint requires `confirm.permissionDigest` to byte-match a
 * digest the server recomputes from the request. The digest is
 * `sha256:<hex>` over the canonical JSON of the operation parameters. These two
 * functions intentionally mirror, exactly, the server's `canonicalJson` and
 * `sha256HexText` so the client-issued digest is accepted. Keep them in
 * lockstep with those server functions.
 *
 * Ported from takosumi dashboard-ui/src/lib/rpc/digest.ts.
 */

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${
      Object.keys(record).sort().map((key) =>
        `${JSON.stringify(key)}:${canonicalJson(record[key])}`
      ).join(",")
    }}`;
  }
  return JSON.stringify(value ?? null);
}

export async function sha256HexText(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return `sha256:${
    [...new Uint8Array(digest)].map((byte) =>
      byte.toString(16).padStart(2, "0")
    )
      .join("")
  }`;
}

/** `sha256:<hex>` digest of the canonical JSON of `value`. */
export function sha256Canonical(value: unknown): Promise<string> {
  return sha256HexText(canonicalJson(value));
}
