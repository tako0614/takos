import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createLogger } from '@takos/common/logger';

const logger = createLogger({ service: 'takos-runtime' });

interface TempDirManagerOptions {
  /** Cleanup timeout in milliseconds (default: 5 minutes) */
  cleanupTimeoutMs?: number;
  /** Log prefix for cleanup messages */
  logPrefix?: string;
}

interface TempDirEntry {
  path: string;
  createdAt: number;
  timer: ReturnType<typeof setTimeout>;
}

class TempDirManager {
  private readonly activeTempDirs = new Map<string, TempDirEntry>();
  private readonly cleanupTimeoutMs: number;
  private readonly logPrefix: string;

  constructor(options: TempDirManagerOptions = {}) {
    this.cleanupTimeoutMs = options.cleanupTimeoutMs ?? 5 * 60 * 1000;
    this.logPrefix = options.logPrefix ?? 'temp';
  }

  async createTempDirWithCleanup(prefix: string): Promise<string> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    const id = crypto.randomUUID();

    const timer = setTimeout(async () => {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
        this.activeTempDirs.delete(id);
        logger.info('Cleanup: removed stale temp dir', { prefix: this.logPrefix, tempDir });
      } catch {
        // Ignore cleanup errors
      }
    }, this.cleanupTimeoutMs);

    this.activeTempDirs.set(id, { path: tempDir, createdAt: Date.now(), timer });

    return tempDir;
  }

  async cleanupTempDir(tempDir: string): Promise<void> {
    for (const [id, entry] of this.activeTempDirs.entries()) {
      if (entry.path === tempDir) {
        clearTimeout(entry.timer);
        this.activeTempDirs.delete(id);
        break;
      }
    }
    await fs.rm(tempDir, { recursive: true, force: true }).catch((err) => {
      logger.debug('Failed to clean up temp dir', { tempDir, error: err as Error });
    });
  }
}

// Default instances for common use cases
export const execTempDirManager = new TempDirManager({
  cleanupTimeoutMs: 5 * 60 * 1000, // 5 minutes
  logPrefix: 'exec',
});

export const mergeTempDirManager = new TempDirManager({
  cleanupTimeoutMs: 2 * 60 * 60 * 1000, // 2 hours for large merge operations
  logPrefix: 'merge',
});
