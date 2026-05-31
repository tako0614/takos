import {
  chmod as nodeChmod,
  mkdir as nodeMkdir,
  mkdtemp as nodeMkdtemp,
  readFile,
  readdir,
  rm,
  stat as nodeStat,
  writeFile,
} from "node:fs/promises";
import {
  readFileSync,
  readdirSync,
  statSync as nodeStatSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const args = process.argv.slice(2);
export const pid = process.pid;

export const env = {
  get(name: string): string | undefined {
    return process.env[name];
  },
  set(name: string, value: string): void {
    process.env[name] = value;
  },
  delete(name: string): void {
    delete process.env[name];
  },
  toObject(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === "string") result[key] = value;
    }
    return result;
  },
};

export function cwd(): string {
  return process.cwd();
}

export function exit(code = 0): never {
  process.exit(code);
}

type StdioMode = "pipe" | "inherit" | "ignore";

export async function runCommand(
  command: string,
  options: {
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    stdout?: StdioMode;
    stderr?: StdioMode;
    signal?: AbortSignal;
  } = {},
): Promise<CommandOutput> {
  const stdoutMode = options.stdout ?? "pipe";
  const stderrMode = options.stderr ?? "pipe";
  const proc = Bun.spawn([command, ...(options.args ?? [])], {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    stdout: stdoutMode,
    stderr: stderrMode,
    signal: options.signal,
  });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    proc.stdout ? streamBytes(proc.stdout) : Promise.resolve(new Uint8Array()),
    proc.stderr ? streamBytes(proc.stderr) : Promise.resolve(new Uint8Array()),
  ]);
  return { code, success: code === 0, stdout, stderr };
}

export type CommandOutput = {
  code: number;
  success: boolean;
  stdout: Uint8Array;
  stderr: Uint8Array;
};

async function streamBytes(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function readTextFile(path: string): Promise<string> {
  return await readFile(path, "utf8");
}

export function readTextFileSync(path: string): string {
  return readFileSync(path, "utf8");
}

export async function writeTextFile(path: string, text: string): Promise<void> {
  await writeFile(path, text);
}

export async function mkdir(
  path: string,
  options?: { recursive?: boolean },
): Promise<void> {
  await nodeMkdir(path, { recursive: options?.recursive });
}

export async function remove(
  path: string,
  options?: { recursive?: boolean },
): Promise<void> {
  await rm(path, { recursive: options?.recursive, force: true });
}

export async function chmod(path: string, mode: number): Promise<void> {
  await nodeChmod(path, mode);
}

export async function makeTempDir(
  options: { prefix?: string } = {},
): Promise<string> {
  return await nodeMkdtemp(join(tmpdir(), options.prefix ?? "takos-"));
}

export async function stat(path: string): Promise<PathStat> {
  try {
    return toPathStat(await nodeStat(path));
  } catch (error) {
    throw mapFsError(error);
  }
}

export function statSync(path: string): PathStat {
  try {
    return toPathStat(nodeStatSync(path));
  } catch (error) {
    throw mapFsError(error);
  }
}

export async function* readDir(path: string): AsyncIterable<DirEntry> {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    throw mapFsError(error);
  }
  for (const entry of entries) yield toDirEntry(entry);
}

export function readDirSync(path: string): DirEntry[] {
  try {
    return readdirSync(path, { withFileTypes: true }).map(toDirEntry);
  } catch (error) {
    throw mapFsError(error);
  }
}

export function listen(options: { hostname: string; port: number }): {
  addr: { hostname: string; port: number };
  close(): void;
} {
  const listener = Bun.listen({
    hostname: options.hostname,
    port: options.port,
    socket: { data() {} },
  });
  return {
    addr: { hostname: listener.hostname, port: listener.port },
    close: () => listener.stop(),
  };
}

export type PathStat = {
  isFile: boolean;
  isDirectory: boolean;
  mtime: Date | null;
};

export type DirEntry = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
};

export const errors = {
  NotFound: class NotFound extends Error {},
};

function toPathStat(value: {
  isFile(): boolean;
  isDirectory(): boolean;
  mtime: Date;
}): PathStat {
  return {
    isFile: value.isFile(),
    isDirectory: value.isDirectory(),
    mtime: value.mtime,
  };
}

function toDirEntry(value: {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}): DirEntry {
  return {
    name: value.name,
    isFile: value.isFile(),
    isDirectory: value.isDirectory(),
    isSymlink: value.isSymbolicLink(),
  };
}

function mapFsError(error: unknown): unknown {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ["ENOENT", "ENOTDIR"].includes(String((error as { code?: unknown }).code))
  ) {
    return new errors.NotFound(
      error instanceof Error ? error.message : "path not found",
    );
  }
  return error;
}
