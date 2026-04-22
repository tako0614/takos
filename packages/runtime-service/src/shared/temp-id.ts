import { randomBytes } from "node:crypto";

/**
 * Generate a short random suffix for temporary file/directory names.
 * Returns a string like "1711234567890-ab12cd34".
 */
export function generateTempSuffix(): string {
  const id = randomBytes(6).toString("base64").replace(/[+/=]/g, "").slice(
    0,
    8,
  );
  return `${Date.now()}-${id}`;
}
