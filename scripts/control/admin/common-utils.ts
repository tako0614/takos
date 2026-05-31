/**
 * General utilities: nowIso, randomId, appendAuditLog.
 */

import { randomBytes } from "node:crypto";
import * as fs from "node:fs";

import type { AuditEntry } from "./admin-types.ts";
import { AUDIT_LOG_DIR, AUDIT_LOG_FILE } from "./constants.ts";

export function nowIso(): string {
  return new Date().toISOString();
}

export function randomId(): string {
  return randomBytes(16).toString("hex");
}

export function appendAuditLog(entry: AuditEntry): void {
  try {
    fs.mkdirSync(AUDIT_LOG_DIR, { recursive: true });
    fs.appendFileSync(AUDIT_LOG_FILE, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `Warning: failed to write audit log (${AUDIT_LOG_FILE}): ${message}`,
    );
  }
}
