import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createLogger } from '@takos/common/logger';

const logger = createLogger({ service: 'takos-runtime' });

export interface AuditEntry {
  timestamp: string;
  event: string;
  spaceId: string;
  sessionId?: string;
  command?: string;
  commands?: string[];
  exitCode?: number;
  durationMs?: number;
  status: 'started' | 'completed' | 'failed';
  error?: string;
  ip?: string;
  requestId?: string;
}

const AUDIT_LOG_DIR = process.env.TAKOS_AUDIT_LOG_DIR || path.join(os.tmpdir(), 'takos-audit');
const AUDIT_LOG_FILE = path.join(AUDIT_LOG_DIR, 'execution-audit.jsonl');

const MAX_AUDIT_FILE_SIZE = 50 * 1024 * 1024;
const MAX_ROTATED_FILES = 5;

let dirEnsured = false;

async function ensureDir(): Promise<void> {
  if (dirEnsured) return;
  try {
    await fs.mkdir(AUDIT_LOG_DIR, { recursive: true });
    dirEnsured = true;
  } catch { /* ignored */ }
}

async function rotateIfNeeded(): Promise<void> {
  try {
    const stats = await fs.stat(AUDIT_LOG_FILE);
    if (stats.size < MAX_AUDIT_FILE_SIZE) return;

    for (let i = MAX_ROTATED_FILES - 1; i >= 1; i--) {
      const from = `${AUDIT_LOG_FILE}.${i}`;
      const to = `${AUDIT_LOG_FILE}.${i + 1}`;
      try {
        await fs.rename(from, to);
      } catch { /* ignored */ }
    }

    try {
      await fs.rename(AUDIT_LOG_FILE, `${AUDIT_LOG_FILE}.1`);
    } catch { /* ignored */ }

    try {
      await fs.unlink(`${AUDIT_LOG_FILE}.${MAX_ROTATED_FILES + 1}`);
    } catch { /* ignored */ }
  } catch { /* ignored */ }
}

function redactCommand(cmd: string): string {
  return cmd
    .replace(/:\/\/([^@\s]+)@/g, '://***@')
    .replace(/(Authorization:\s*)(Bearer\s+)?\S+/gi, '$1***')
    .replace(/\b((?:SECRET|TOKEN|PASSWORD|API_KEY|ACCESS_KEY|PRIVATE_KEY|AUTH)[A-Z_]*)=(\S+)/gi, '$1=***')
    // Redact common secret patterns in key=value and key: value formats
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)[\s]*[=:]\s*\S+/gi, '$1=***');
}

function redactAuditEntry(entry: AuditEntry): AuditEntry {
  const redacted = { ...entry };
  if (redacted.command) {
    redacted.command = redactCommand(redacted.command);
  }
  if (redacted.commands) {
    redacted.commands = redacted.commands.map(redactCommand);
  }
  return redacted;
}

export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    await ensureDir();
    await rotateIfNeeded();
    const safeEntry = redactAuditEntry(entry);
    const line = JSON.stringify(safeEntry) + '\n';
    await fs.appendFile(AUDIT_LOG_FILE, line, 'utf-8');
  } catch (err) {
    logger.error('[AUDIT] Failed to write audit log', { error: err });
  }
}
