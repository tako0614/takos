/**
 * Basic helpers: print, fail, nowIso, randomId, sqlLiteral, sqlNullable,
 * escapeRegExp, appendAuditLog, takeFlag, takeOption, parsePositiveInt.
 */

import { randomBytes } from 'crypto';
import * as fs from 'fs';

import type { AuditEntry } from './types.ts';
import { AUDIT_LOG_DIR, AUDIT_LOG_FILE } from './constants.ts';

// ---------------------------------------------------------------------------
// Basic helpers
// ---------------------------------------------------------------------------

export function print(message: string, isJson: boolean): void {
  if (!isJson) {
    console.log(message);
  }
}

export function fail(message: string): never {
  throw new Error(message);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function randomId(): string {
  return randomBytes(16).toString('hex');
}

export function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function sqlNullable(value: string | null | undefined): string {
  if (value == null) {
    return 'NULL';
  }
  return sqlLiteral(value);
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function appendAuditLog(entry: AuditEntry): void {
  try {
    fs.mkdirSync(AUDIT_LOG_DIR, { recursive: true });
    fs.appendFileSync(AUDIT_LOG_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Warning: failed to write audit log (${AUDIT_LOG_FILE}): ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Argument parsing helpers
// ---------------------------------------------------------------------------

export function takeFlag(args: string[], flag: string): boolean {
  const index = args.indexOf(flag);
  if (index === -1) {
    return false;
  }
  args.splice(index, 1);
  return true;
}

export function takeOption(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  const next = args[index + 1];
  if (!next || next.startsWith('--')) {
    fail(`Option ${flag} requires a value.`);
  }

  args.splice(index, 2);
  return next;
}

export function parsePositiveInt(raw: string | undefined, optionName: string, defaultValue: number, maxValue: number): number {
  if (!raw) {
    return defaultValue;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    fail(`${optionName} must be a positive integer.`);
  }

  return Math.min(value, maxValue);
}
