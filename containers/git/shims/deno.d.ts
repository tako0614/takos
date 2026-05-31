type DenoCommandStdio = "piped" | "inherit" | "null";

interface DenoCommandOptions {
  args?: string[];
  cwd?: string | URL;
  env?: Record<string, string>;
  clearEnv?: boolean;
  stdin?: DenoCommandStdio;
  stdout?: DenoCommandStdio;
  stderr?: DenoCommandStdio;
  signal?: AbortSignal;
}

interface DenoCommandOutput {
  code: number;
  signal: string | null;
  success: boolean;
  stdout: Uint8Array;
  stderr: Uint8Array;
}

interface DenoCommandStatus {
  code: number;
  signal: string | null;
  success: boolean;
}

interface DenoChildProcess {
  pid: number;
  stdin: WritableStream<Uint8Array>;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  status: Promise<DenoCommandStatus>;
  output(): Promise<DenoCommandOutput>;
  kill(signal?: NodeJS.Signals): void;
  ref(): void;
  unref(): void;
}

interface DenoDirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
}

interface DenoFileInfo {
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  mtime: Date | null;
  atime: Date | null;
  birthtime: Date | null;
  mode: number | null;
}

interface DenoServeOptions {
  port?: number;
  hostname?: string;
  signal?: AbortSignal;
  onListen?: (params: { hostname: string; port: number }) => void;
}

type DenoServeHandler = (
  req: Request,
  info?: unknown,
) => Response | Promise<Response>;

interface DenoServer {
  addr: { transport: "tcp"; hostname: string; port: number };
  finished: Promise<void>;
  shutdown(): Promise<void>;
  ref(): void;
  unref(): void;
}

interface DenoNetAddr {
  transport: "tcp";
  hostname: string;
  port: number;
}

interface DenoFsFile {
  close(): void;
}

declare namespace Deno {
  export type CommandOutput = DenoCommandOutput;
  export type ChildProcess = DenoChildProcess;
  export type FileInfo = DenoFileInfo;
  export type DirEntry = DenoDirEntry;
  export type NetAddr = DenoNetAddr;
  export type HttpServer = DenoServer;
}

declare const Deno: {
  args: string[];
  pid: number;
  build: { os: string; arch: string };
  errors: {
    NotFound: new (...args: unknown[]) => Error;
    AlreadyExists: new (...args: unknown[]) => Error;
    PermissionDenied: new (...args: unknown[]) => Error;
  };
  env: {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    has(key: string): boolean;
    delete(key: string): void;
    toObject(): Record<string, string>;
  };
  cwd(): string;
  chdir(path: string | URL): void;
  exit(code?: number): never;
  execPath(): string;
  addSignalListener(signal: NodeJS.Signals, handler: () => void): void;
  removeSignalListener(signal: NodeJS.Signals, handler: () => void): void;
  mkdir(path: string | URL, options?: { recursive?: boolean; mode?: number }): Promise<void>;
  mkdirSync(path: string | URL, options?: { recursive?: boolean; mode?: number }): void;
  makeTempDir(options?: { dir?: string; prefix?: string; suffix?: string }): Promise<string>;
  makeTempDirSync(options?: { dir?: string; prefix?: string; suffix?: string }): string;
  makeTempFile(options?: { dir?: string; prefix?: string; suffix?: string }): Promise<string>;
  makeTempFileSync(options?: { dir?: string; prefix?: string; suffix?: string }): string;
  readDir(path: string | URL): AsyncIterable<DenoDirEntry>;
  readDirSync(path: string | URL): Iterable<DenoDirEntry>;
  readTextFile(path: string | URL): Promise<string>;
  readTextFileSync(path: string | URL): string;
  readFile(path: string | URL): Promise<Uint8Array>;
  readFileSync(path: string | URL): Uint8Array;
  writeTextFile(
    path: string | URL,
    data: string,
    options?: { append?: boolean; create?: boolean; mode?: number },
  ): Promise<void>;
  writeTextFileSync(
    path: string | URL,
    data: string,
    options?: { append?: boolean; create?: boolean; mode?: number },
  ): void;
  writeFile(path: string | URL, data: Uint8Array, options?: { mode?: number }): Promise<void>;
  writeFileSync(path: string | URL, data: Uint8Array, options?: { mode?: number }): void;
  open(
    path: string | URL,
    options?: {
      read?: boolean;
      write?: boolean;
      append?: boolean;
      create?: boolean;
      createNew?: boolean;
      truncate?: boolean;
      mode?: number;
    },
  ): Promise<DenoFsFile>;
  remove(path: string | URL, options?: { recursive?: boolean }): Promise<void>;
  removeSync(path: string | URL, options?: { recursive?: boolean }): void;
  stat(path: string | URL): Promise<DenoFileInfo>;
  statSync(path: string | URL): DenoFileInfo;
  lstat(path: string | URL): Promise<DenoFileInfo>;
  lstatSync(path: string | URL): DenoFileInfo;
  realPath(path: string | URL): Promise<string>;
  realPathSync(path: string | URL): string;
  rename(oldpath: string | URL, newpath: string | URL): Promise<void>;
  renameSync(oldpath: string | URL, newpath: string | URL): void;
  copyFile(from: string | URL, to: string | URL): Promise<void>;
  copyFileSync(from: string | URL, to: string | URL): void;
  symlink(
    oldpath: string | URL,
    newpath: string | URL,
    options?: { type?: "file" | "dir" | "junction" },
  ): Promise<void>;
  chmod(path: string | URL, mode: number): Promise<void>;
  resolveDns(name: string, recordType: "A" | "AAAA"): Promise<string[]>;
  serve(options: DenoServeOptions, handler: DenoServeHandler): DenoServer;
  serve(handler: DenoServeHandler): DenoServer;
  Command: new (command: string | URL, options?: DenoCommandOptions) => {
    output(): Promise<DenoCommandOutput>;
    outputSync(): DenoCommandOutput;
    spawn(): DenoChildProcess;
  };
};
