/**
 * Git Smart HTTP protocol capabilities.
 */

export const UPLOAD_PACK_CAPABILITIES = [
  "multi_ack_detailed",
  "thin-pack",
  "side-band-64k",
  "ofs-delta",
  "shallow",
  "no-progress",
  "include-tag",
  "allow-tip-sha1-in-want",
  "allow-reachable-sha1-in-want",
  "no-done",
];

export const RECEIVE_PACK_CAPABILITIES = [
  "report-status",
  "delete-refs",
  "ofs-delta",
  "side-band-64k",
  "no-thin",
];

export function formatCapabilities(caps: string[]): string {
  return caps.join(" ");
}
