export function isDigestPinnedImageRef(imageRef: string): boolean {
  return /@sha256:[a-f0-9]{64}$/i.test(String(imageRef || "").trim());
}
