import { promises as dns } from "node:dns";
import {
  mkdtempSync,
  readFileSync,
} from "node:fs";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type CommandOutput = {
  code: number;
  success: boolean;
  stdout: Uint8Array;
  stderr: Uint8Array;
};

export type ChildProcess = {
  stdin: {
    write(chunk: Uint8Array): number | Promise<number>;
    end(): void;
  };
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  kill(signal?: NodeJS.Signals | number): void;
  exited: Promise<number>;
  status: Promise<{ code: number; success: boolean }>;
  output(): Promise<CommandOutput>;
};

export type DirEntry = {
  name: string;
  isDirectory: boolean;
  isSymlink: boolean;
};

export type PathStat = {
  isFile: boolean;
  isDirectory: boolean;
  mtime: Date | null;
};

export function getEnv(name: string): string | undefined {
  return process.env[name];
}

export function setEnv(name: string, value: string): void {
  process.env[name] = value;
}

export function deleteEnv(name: string): void {
  delete process.env[name];
}

export function spawnCommand(
  command: string,
  options: {
    args?: string[];
    stdin?: "pipe" | "ignore";
    stdout?: "pipe";
    stderr?: "pipe";
    env?: Record<string, string>;
  } = {},
): ChildProcess {
  const proc = Bun.spawn([command, ...(options.args ?? [])], {
    stdin: options.stdin ?? "ignore",
    stdout: options.stdout ?? "pipe",
    stderr: options.stderr ?? "pipe",
    env: options.env,
  });
  const status = proc.exited.then((code) => ({
    code,
    success: code === 0,
  }));
  return {
    stdin: proc.stdin as ChildProcess["stdin"],
    stdout: proc.stdout,
    stderr: proc.stderr,
    kill: (signal?: NodeJS.Signals | number) => proc.kill(signal),
    exited: proc.exited,
    status,
    output: async () => {
      const [code, stdout, stderr] = await Promise.all([
        proc.exited,
        streamBytes(proc.stdout),
        streamBytes(proc.stderr),
      ]);
      return { code, success: code === 0, stdout, stderr };
    },
  };
}

export async function streamBytes(
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

export async function makeTempDir(prefix: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix));
}

export function makeTempDirSync(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export async function makeDirectory(
  path: string,
  options?: { recursive?: boolean },
): Promise<void> {
  await mkdir(path, { recursive: options?.recursive });
}

export async function readTextFile(path: string): Promise<string> {
  return await readFile(path, "utf8");
}

export function readTextFileSync(path: string): string {
  return readFileSync(path, "utf8");
}

export async function writeBytes(path: string, data: Uint8Array): Promise<void> {
  await writeFile(path, data);
}

export async function writeText(path: string, data: string): Promise<void> {
  await writeFile(path, data);
}

export async function removePath(
  path: string,
  options?: { recursive?: boolean },
): Promise<void> {
  await rm(path, { recursive: options?.recursive, force: true });
}

export async function createNewFile(path: string): Promise<{ close(): void }> {
  return await open(path, "wx");
}

export async function pathStat(path: string): Promise<PathStat> {
  const result = await stat(path);
  return {
    isFile: result.isFile(),
    isDirectory: result.isDirectory(),
    mtime: result.mtime,
  };
}

export async function readDirEntries(path: string): Promise<DirEntry[]> {
  const entries = await readdir(path, { withFileTypes: true });
  return entries.map((entry) => ({
    name: entry.name,
    isDirectory: entry.isDirectory(),
    isSymlink: entry.isSymbolicLink(),
  }));
}

export function isNotFoundError(error: unknown): boolean {
  return isErrnoException(error, "ENOENT") ||
    isErrnoException(error, "ENOTFOUND") ||
    isErrnoException(error, "ENODATA") ||
    isErrnoException(error, "ENOTDIR");
}

export function isAlreadyExistsError(error: unknown): boolean {
  return isErrnoException(error, "EEXIST");
}

function isErrnoException(error: unknown, code: string): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code;
}

export async function resolveDns(
  hostname: string,
  recordType: "A" | "AAAA",
): Promise<string[]> {
  return recordType === "A"
    ? await dns.resolve4(hostname)
    : await dns.resolve6(hostname);
}
