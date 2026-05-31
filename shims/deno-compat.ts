// deno-compat.ts — canonical Deno -> Bun runtime shim.
//
// Installs a `globalThis.Deno` good enough to run Deno-authored library /
// service code on Bun. Loaded as a Bun preload (see bunfig.toml) so that
// `Deno.*` references resolve before any module under test executes.
//
// Covered surface (intentionally minimal + behaviour-preserving):
//   - Deno.env (get/set/delete/has/toObject)
//   - Deno.args / Deno.pid / Deno.build / Deno.cwd / Deno.chdir / Deno.exit /
//     Deno.execPath / Deno.addSignalListener / Deno.removeSignalListener
//   - Deno.Command (output/outputSync/spawn) with web-stream stdin/out/err
//   - Deno.serve (Bun.serve adapter returning { finished, shutdown, addr }) and
//     Deno.upgradeWebSocket
//   - filesystem: readTextFile(Sync) / writeTextFile(Sync) / readFile(Sync) /
//     writeFile(Sync) / mkdir(Sync) / remove(Sync) / stat(Sync) / lstat(Sync) /
//     readDir(Sync) / makeTempDir(Sync) / makeTempFile(Sync) / realPath(Sync) /
//     rename(Sync) / copyFile(Sync) / symlink / chmod
//   - Deno.open / Deno.create / Deno.SeekMode (FsFile with read/seek/write/
//     truncate/stat/close) — required by takos-computer's FsManager
//   - Deno.errors (NotFound / AlreadyExists / PermissionDenied / NotADirectory)
//
// EVERY fs entry remaps node errno errors to Deno.errors.* so that callers that
// branch on `instanceof Deno.errors.NotFound` (e.g. FsManager.resolveExistingPath)
// behave identically to Deno.
//
// Sync fs is implemented via createRequire("node:fs") so that this file works
// when itself loaded as an ESM preload.

import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";

const require = createRequire(import.meta.url);
const nodeFs = require("node:fs") as typeof import("node:fs");
const nodeFsp = require(
  "node:fs/promises",
) as typeof import("node:fs/promises");
const nodeOs = require("node:os") as typeof import("node:os");
const nodePath = require("node:path") as typeof import("node:path");
const nodeProcess = require("node:process") as typeof import("node:process");

// ---------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------
class DenoError extends Error {}
class NotFound extends DenoError {
  override name = "NotFound";
}
class AlreadyExists extends DenoError {
  override name = "AlreadyExists";
}
class PermissionDenied extends DenoError {
  override name = "PermissionDenied";
}
class NotADirectory extends DenoError {
  override name = "NotADirectory";
}

function mapNodeError(err: unknown): Error {
  const e = err as NodeJS.ErrnoException;
  if (e && e.code === "ENOENT") {
    return Object.assign(new NotFound(e.message), { cause: e });
  }
  if (e && e.code === "EEXIST") {
    return Object.assign(new AlreadyExists(e.message), { cause: e });
  }
  if (e && (e.code === "EACCES" || e.code === "EPERM")) {
    return Object.assign(new PermissionDenied(e.message), { cause: e });
  }
  if (e && e.code === "ENOTDIR") {
    return Object.assign(new NotADirectory(e.message), { cause: e });
  }
  return e instanceof Error ? e : new Error(String(err));
}

function wrapSync<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    throw mapNodeError(err);
  }
}

async function wrapAsync<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw mapNodeError(err);
  }
}

// ---------------------------------------------------------------------------
// FileInfo
// ---------------------------------------------------------------------------
function toFileInfo(st: import("node:fs").Stats) {
  return {
    isFile: st.isFile(),
    isDirectory: st.isDirectory(),
    isSymlink: st.isSymbolicLink(),
    size: st.size,
    mtime: st.mtime,
    atime: st.atime,
    birthtime: st.birthtime,
    dev: st.dev,
    ino: st.ino,
    mode: st.mode,
    nlink: st.nlink,
    uid: st.uid,
    gid: st.gid,
    rdev: st.rdev,
    blksize: st.blksize,
    blocks: st.blocks,
    isBlockDevice: st.isBlockDevice(),
    isCharDevice: st.isCharacterDevice(),
    isFifo: st.isFIFO(),
    isSocket: st.isSocket(),
  };
}

function toDirEntry(d: import("node:fs").Dirent) {
  return {
    name: d.name,
    isFile: d.isFile(),
    isDirectory: d.isDirectory(),
    isSymlink: d.isSymbolicLink(),
  };
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------
type DenoStdio = "inherit" | "piped" | "null";

interface CommandOptions {
  args?: string[];
  cwd?: string | URL;
  env?: Record<string, string>;
  clearEnv?: boolean;
  stdin?: DenoStdio;
  stdout?: DenoStdio;
  stderr?: DenoStdio;
  signal?: AbortSignal;
}

function stdioFlag(v: DenoStdio | undefined, fallback: DenoStdio) {
  const m = v ?? fallback;
  if (m === "inherit") return "inherit";
  if (m === "null") return "ignore";
  return "pipe";
}

function buildEnv(opts: CommandOptions): NodeJS.ProcessEnv {
  if (opts.clearEnv) return { ...(opts.env ?? {}) };
  return { ...nodeProcess.env, ...(opts.env ?? {}) };
}

function resolveCwd(cwd: string | URL | undefined): string | undefined {
  if (cwd === undefined) return undefined;
  return cwd instanceof URL ? cwd.pathname : cwd;
}

// Adapt a node Readable to a web ReadableStream. Buffers chunks EAGERLY via the
// "data" listener attached synchronously here rather than lazily in start():
// under `bun test` a short-lived child can emit+end its node stream before a
// lazily-attached consumer (ShellManager calls getReader() only after closing
// stdin), which would otherwise drop output.
function nodeReadableToWeb(
  stream: NodeJS.ReadableStream | null,
): ReadableStream<Uint8Array> | null {
  if (!stream) return null;
  const chunks: Uint8Array[] = [];
  let ended = false;
  let errored: unknown = null;
  let wake: (() => void) | null = null;
  const signal = () => {
    const w = wake;
    wake = null;
    w?.();
  };
  stream.on("data", (chunk: Buffer | string) => {
    chunks.push(
      typeof chunk === "string"
        ? new TextEncoder().encode(chunk)
        : new Uint8Array(chunk),
    );
    signal();
  });
  stream.on("end", () => {
    ended = true;
    signal();
  });
  stream.on("error", (err) => {
    errored = err;
    ended = true;
    signal();
  });
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (chunks.length === 0 && !ended) {
        await new Promise<void>((res) => (wake = res));
      }
      if (chunks.length > 0) {
        controller.enqueue(chunks.shift()!);
        return;
      }
      if (errored) controller.error(errored);
      else controller.close();
    },
    cancel() {
      (stream as { destroy?: () => void }).destroy?.();
    },
  });
}

function webWritableToNode(
  stream: NodeJS.WritableStream | null,
): WritableStream<Uint8Array> | null {
  if (!stream) return null;
  return new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise((resolve, reject) => {
        stream.write(
          Buffer.from(chunk),
          (err) => err ? reject(err) : resolve(),
        );
      });
    },
    close() {
      return new Promise((resolve) => {
        (stream as { end: (cb: () => void) => void }).end(() => resolve());
      });
    },
  });
}

async function readAllWeb(
  stream: ReadableStream<Uint8Array> | null,
): Promise<Uint8Array> {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return chunks.length
    ? new Uint8Array(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))))
    : new Uint8Array();
}

class ChildProcess {
  #child: import("node:child_process").ChildProcess;
  #status: Promise<{ success: boolean; code: number; signal: string | null }>;
  readonly stdin: WritableStream<Uint8Array> | null;
  readonly stdout: ReadableStream<Uint8Array> | null;
  readonly stderr: ReadableStream<Uint8Array> | null;
  readonly pid: number;

  constructor(cmd: string, opts: CommandOptions) {
    const child = spawn(cmd, opts.args ?? [], {
      cwd: resolveCwd(opts.cwd),
      env: buildEnv(opts),
      signal: opts.signal,
      stdio: [
        stdioFlag(opts.stdin, "null"),
        stdioFlag(opts.stdout, "piped"),
        stdioFlag(opts.stderr, "piped"),
      ],
    });
    this.#child = child;
    this.pid = child.pid ?? -1;
    this.stdin = webWritableToNode(child.stdin);
    this.stdout = nodeReadableToWeb(child.stdout);
    this.stderr = nodeReadableToWeb(child.stderr);
    this.#status = new Promise((resolve, reject) => {
      child.on("error", (err) => reject(mapNodeError(err)));
      child.on("close", (code, signal) => {
        resolve({
          success: code === 0,
          code: code ?? (signal ? 128 : 1),
          signal: signal ?? null,
        });
      });
    });
  }

  get status() {
    return this.#status;
  }

  async output() {
    const [status, stdout, stderr] = await Promise.all([
      this.#status,
      readAllWeb(this.stdout),
      readAllWeb(this.stderr),
    ]);
    return { ...status, stdout, stderr };
  }

  kill(signo?: string | number) {
    this.#child.kill(signo as NodeJS.Signals | number | undefined);
  }

  ref() {
    this.#child.ref?.();
  }
  unref() {
    this.#child.unref?.();
  }
}

class Command {
  #cmd: string;
  #opts: CommandOptions;

  constructor(cmd: string | URL, opts: CommandOptions = {}) {
    this.#cmd = cmd instanceof URL ? cmd.pathname : cmd;
    this.#opts = opts;
  }

  output() {
    const opts = this.#opts;
    return new Promise<{
      code: number;
      signal: string | null;
      success: boolean;
      stdout: Uint8Array;
      stderr: Uint8Array;
    }>((resolve, reject) => {
      const child = spawn(this.#cmd, opts.args ?? [], {
        cwd: resolveCwd(opts.cwd),
        env: buildEnv(opts),
        signal: opts.signal,
        stdio: [
          stdioFlag(opts.stdin, "null"),
          stdioFlag(opts.stdout, "piped"),
          stdioFlag(opts.stderr, "piped"),
        ],
      });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      child.stdout?.on("data", (c: Buffer) => out.push(c));
      child.stderr?.on("data", (c: Buffer) => err.push(c));
      child.on("error", (e) => reject(mapNodeError(e)));
      child.on("close", (code, signal) => {
        resolve({
          code: code ?? (signal ? 128 : 1),
          signal: signal ?? null,
          success: code === 0,
          stdout: out.length
            ? new Uint8Array(Buffer.concat(out))
            : new Uint8Array(),
          stderr: err.length
            ? new Uint8Array(Buffer.concat(err))
            : new Uint8Array(),
        });
      });
    });
  }

  outputSync() {
    const opts = this.#opts;
    const res = spawnSync(this.#cmd, opts.args ?? [], {
      cwd: resolveCwd(opts.cwd),
      env: buildEnv(opts),
      maxBuffer: 1024 * 1024 * 256,
    });
    if (res.error) throw mapNodeError(res.error);
    return {
      success: res.status === 0,
      code: res.status ?? (res.signal ? 128 : 1),
      signal: res.signal ?? null,
      stdout: res.stdout ? new Uint8Array(res.stdout) : new Uint8Array(),
      stderr: res.stderr ? new Uint8Array(res.stderr) : new Uint8Array(),
    };
  }

  spawn() {
    return new ChildProcess(this.#cmd, this.#opts);
  }
}

// ---------------------------------------------------------------------------
// env
// ---------------------------------------------------------------------------
const env = {
  get: (k: string) => nodeProcess.env[k],
  set: (k: string, v: string) => {
    nodeProcess.env[k] = v;
  },
  delete: (k: string) => {
    delete nodeProcess.env[k];
  },
  has: (k: string) => k in nodeProcess.env,
  toObject: () => ({ ...nodeProcess.env }) as Record<string, string>,
};

// ---------------------------------------------------------------------------
// filesystem
// ---------------------------------------------------------------------------
interface MkdirOptions {
  recursive?: boolean;
  mode?: number;
}
interface RemoveOptions {
  recursive?: boolean;
}
interface MakeTempOptions {
  dir?: string;
  prefix?: string;
  suffix?: string;
}
interface WriteFileOptions {
  append?: boolean;
  create?: boolean;
  mode?: number;
}

function tempName(opts: MakeTempOptions = {}) {
  const base = opts.dir ?? nodeOs.tmpdir();
  const rand = crypto.randomUUID();
  return nodePath.join(base, `${opts.prefix ?? ""}${rand}${opts.suffix ?? ""}`);
}

function tempPrefix(opts: MakeTempOptions = {}) {
  const prefix = opts.prefix ?? "";
  const base = nodePath.join(opts.dir ?? nodeOs.tmpdir(), prefix);
  return prefix.length > 0 || base.endsWith(nodePath.sep)
    ? base
    : `${base}${nodePath.sep}`;
}

const fsApi = {
  readTextFile: (p: string | URL) =>
    wrapAsync(() => nodeFsp.readFile(p, "utf8")),
  readTextFileSync: (p: string | URL) =>
    wrapSync(() => nodeFs.readFileSync(p, "utf8")),
  writeTextFile: (p: string | URL, data: string, opts: WriteFileOptions = {}) =>
    wrapAsync(() =>
      nodeFsp.writeFile(p, data, {
        flag: opts.append ? "a" : "w",
        mode: opts.mode,
      })
    ),
  writeTextFileSync: (
    p: string | URL,
    data: string,
    opts: WriteFileOptions = {},
  ) =>
    wrapSync(() =>
      nodeFs.writeFileSync(p, data, {
        flag: opts.append ? "a" : "w",
        mode: opts.mode,
      })
    ),
  readFile: (p: string | URL) =>
    wrapAsync(async () => new Uint8Array(await nodeFsp.readFile(p))),
  readFileSync: (p: string | URL) =>
    wrapSync(() => new Uint8Array(nodeFs.readFileSync(p))),
  writeFile: (p: string | URL, data: Uint8Array, opts: WriteFileOptions = {}) =>
    wrapAsync(() => nodeFsp.writeFile(p, data, { mode: opts.mode })),
  writeFileSync: (
    p: string | URL,
    data: Uint8Array,
    opts: WriteFileOptions = {},
  ) => wrapSync(() => nodeFs.writeFileSync(p, data, { mode: opts.mode })),
  mkdir: (p: string | URL, opts: MkdirOptions = {}) =>
    wrapAsync(async () => {
      await nodeFsp.mkdir(p, opts);
    }),
  mkdirSync: (p: string | URL, opts: MkdirOptions = {}) =>
    wrapSync(() => {
      nodeFs.mkdirSync(p, opts);
    }),
  remove: (p: string | URL, opts: RemoveOptions = {}) =>
    wrapAsync(() => nodeFsp.rm(p, { recursive: opts.recursive, force: false })),
  removeSync: (p: string | URL, opts: RemoveOptions = {}) =>
    wrapSync(() =>
      nodeFs.rmSync(p, { recursive: opts.recursive, force: false })
    ),
  stat: (p: string | URL) =>
    wrapAsync(async () => toFileInfo(await nodeFsp.stat(p))),
  statSync: (p: string | URL) => wrapSync(() => toFileInfo(nodeFs.statSync(p))),
  lstat: (p: string | URL) =>
    wrapAsync(async () => toFileInfo(await nodeFsp.lstat(p))),
  lstatSync: (p: string | URL) =>
    wrapSync(() => toFileInfo(nodeFs.lstatSync(p))),
  realPath: (p: string | URL) => wrapAsync(() => nodeFsp.realpath(p)),
  realPathSync: (p: string | URL) => wrapSync(() => nodeFs.realpathSync(p)),
  rename: (a: string | URL, b: string | URL) =>
    wrapAsync(() => nodeFsp.rename(a, b)),
  renameSync: (a: string | URL, b: string | URL) =>
    wrapSync(() => nodeFs.renameSync(a, b)),
  copyFile: (a: string | URL, b: string | URL) =>
    wrapAsync(() => nodeFsp.copyFile(a, b)),
  copyFileSync: (a: string | URL, b: string | URL) =>
    wrapSync(() => nodeFs.copyFileSync(a, b)),
  symlink: (
    target: string | URL,
    p: string | URL,
    opts?: { type?: "file" | "dir" | "junction" },
  ) =>
    wrapAsync(() =>
      nodeFsp.symlink(target, p, opts?.type === "dir" ? "dir" : opts?.type)
    ),
  chmod: (p: string | URL, mode: number) =>
    wrapAsync(() => nodeFsp.chmod(p, mode)),
  makeTempDir: (opts: MakeTempOptions = {}) =>
    wrapAsync(async () => {
      const dir = await nodeFsp.mkdtemp(tempPrefix(opts));
      if (!opts.suffix) return dir;
      const target = `${dir}${opts.suffix}`;
      await nodeFsp.rename(dir, target);
      return target;
    }),
  makeTempDirSync: (opts: MakeTempOptions = {}) =>
    wrapSync(() => {
      const dir = nodeFs.mkdtempSync(tempPrefix(opts));
      if (!opts.suffix) return dir;
      const target = `${dir}${opts.suffix}`;
      nodeFs.renameSync(dir, target);
      return target;
    }),
  makeTempFile: (opts: MakeTempOptions = {}) =>
    wrapAsync(async () => {
      const name = tempName(opts);
      await nodeFsp.writeFile(name, "");
      return name;
    }),
  makeTempFileSync: (opts: MakeTempOptions = {}) =>
    wrapSync(() => {
      const name = tempName(opts);
      nodeFs.writeFileSync(name, "");
      return name;
    }),
  // deno returns an async iterable of DirEntry
  readDir: (p: string | URL) => {
    async function* iter() {
      const entries = await wrapAsync(() =>
        nodeFsp.readdir(p, { withFileTypes: true })
      );
      for (const e of entries) yield toDirEntry(e);
    }
    return iter();
  },
  readDirSync: (p: string | URL) => {
    const entries = wrapSync(() =>
      nodeFs.readdirSync(p, { withFileTypes: true })
    );
    return entries.map(toDirEntry)[Symbol.iterator]();
  },
};

// ---------------------------------------------------------------------------
// Deno.open / Deno.create / Deno.SeekMode (FsFile)
//
// takos-computer's FsManager uses Deno.open(path,{read})/{write}, then
// file.read(buf) (returns bytes-read or null at EOF), file.seek(offset, whence),
// file.write(buf), file.truncate(), file.stat(), and file.close().
// ---------------------------------------------------------------------------
const SeekMode = { Start: 0, Current: 1, End: 2 } as const;

interface OpenOptions {
  read?: boolean;
  write?: boolean;
  append?: boolean;
  create?: boolean;
  createNew?: boolean;
  truncate?: boolean;
}

function openFlags(opts: OpenOptions = {}): string {
  if (opts.write && opts.read) {
    return opts.createNew ? "wx+" : opts.create === false ? "r+" : "w+";
  }
  if (opts.write) return opts.append ? "a" : opts.createNew ? "wx" : "w";
  if (opts.append) return "a";
  return "r";
}

function makeFsFile(fh: import("node:fs/promises").FileHandle) {
  let pos = 0;
  return {
    async read(buf: Uint8Array): Promise<number | null> {
      const { bytesRead } = await fh.read(buf, 0, buf.byteLength, pos);
      if (bytesRead === 0) return null;
      pos += bytesRead;
      return bytesRead;
    },
    async write(buf: Uint8Array): Promise<number> {
      const { bytesWritten } = await fh.write(buf, 0, buf.byteLength, pos);
      pos += bytesWritten;
      return bytesWritten;
    },
    seek(offset: number | bigint, whence: number): Promise<number> {
      const off = Number(offset);
      if (whence === SeekMode.Start) pos = off;
      else if (whence === SeekMode.Current) pos += off;
      else pos = off; // End: best-effort (size not tracked here)
      return Promise.resolve(pos);
    },
    truncate(len?: number): Promise<void> {
      return fh.truncate(len);
    },
    stat: () => fh.stat().then(toFileInfo),
    close(): void {
      void fh.close();
    },
    get readable(): ReadableStream<Uint8Array> {
      return fh.readableWebStream() as unknown as ReadableStream<Uint8Array>;
    },
  };
}

const openApi = {
  SeekMode,
  open: (p: string | URL, opts?: OpenOptions) =>
    wrapAsync(async () => makeFsFile(await nodeFsp.open(p, openFlags(opts)))),
  create: (p: string | URL) =>
    wrapAsync(async () => makeFsFile(await nodeFsp.open(p, "w+"))),
};

// ---------------------------------------------------------------------------
// build / misc
// ---------------------------------------------------------------------------
const buildInfo = {
  target: `${nodeProcess.arch}-unknown-${nodeProcess.platform}`,
  arch: nodeProcess.arch === "x64" ? "x86_64" : nodeProcess.arch,
  os: nodeProcess.platform === "win32"
    ? "windows"
    : nodeProcess.platform === "darwin"
    ? "darwin"
    : "linux",
  vendor: "unknown",
};

const DenoShim = {
  env,
  args: nodeProcess.argv.slice(2),
  pid: nodeProcess.pid,
  build: buildInfo,
  cwd: () => nodeProcess.cwd(),
  chdir: (p: string | URL) =>
    nodeProcess.chdir(p instanceof URL ? p.pathname : p),
  exit: (code = 0): never => nodeProcess.exit(code),
  execPath: () => nodeProcess.execPath,
  addSignalListener: (sig: NodeJS.Signals, handler: () => void) => {
    nodeProcess.on(sig, handler);
  },
  removeSignalListener: (sig: NodeJS.Signals, handler: () => void) => {
    nodeProcess.off(sig, handler);
  },
  Command,
  ChildProcess,
  errors: { NotFound, AlreadyExists, PermissionDenied, NotADirectory },
  ...fsApi,
  ...openApi,
};

// Only install if a real Deno runtime is not present; otherwise merge missing
// members onto the existing partial Deno namespace.
const g = globalThis as { Deno?: Record<string, unknown> };
if (!g.Deno) {
  Object.defineProperty(globalThis, "Deno", {
    value: { ...DenoShim },
    writable: true,
    configurable: true,
    enumerable: false,
  });
} else {
  const existing = g.Deno;
  for (const [k, v] of Object.entries(DenoShim)) {
    if (!(k in existing)) existing[k] = v;
  }
}

// ---------------------------------------------------------------------------
// Deno.serve / Deno.upgradeWebSocket (Bun.serve adapter)
//
// Not exercised by bun:test (no *.test.ts imports the server entry) but lets the
// sandbox container run on `bun`.
// ---------------------------------------------------------------------------
type ServeHandler = (
  req: Request,
  info?: unknown,
) => Response | Promise<Response>;
interface ServeOptions {
  port?: number;
  hostname?: string;
  signal?: AbortSignal;
  onListen?: (addr: { hostname: string; port: number }) => void;
}

const BunRef = (globalThis as { Bun?: { serve: (o: unknown) => unknown } }).Bun;
const Deno = g.Deno as Record<string, unknown>;

Deno.serve = (a: ServeOptions | ServeHandler, b?: ServeHandler) => {
  const opts: ServeOptions = typeof a === "function" ? {} : a;
  const handler: ServeHandler = (typeof a === "function" ? a : b)!;
  if (!BunRef) throw new Error("Deno.serve shim requires the Bun runtime");
  const server = BunRef.serve({
    port: opts.port ?? 8000,
    hostname: opts.hostname ?? "0.0.0.0",
    signal: opts.signal,
    websocket: {
      message(
        ws: { data?: { onmessage?: (e: unknown) => void } },
        msg: unknown,
      ) {
        ws.data?.onmessage?.({ data: msg });
      },
      open(ws: { data?: { onopen?: () => void } }) {
        ws.data?.onopen?.();
      },
      close(ws: { data?: { onclose?: () => void } }) {
        ws.data?.onclose?.();
      },
    },
    fetch: (req: Request, srv: unknown) => {
      (req as unknown as Record<string, unknown>).__bunServer = srv;
      return handler(req, {});
    },
  }) as { hostname: string; port: number; stop?: (force?: boolean) => void };
  opts.onListen?.({
    hostname: server.hostname ?? opts.hostname ?? "0.0.0.0",
    port: server.port ?? opts.port ?? 8000,
  });
  return {
    finished: Promise.resolve(),
    shutdown: () => {
      server.stop?.(true);
      return Promise.resolve();
    },
    ref() {},
    unref() {},
    addr: {
      hostname: server.hostname,
      port: server.port,
      transport: "tcp" as const,
    },
  };
};

Deno.upgradeWebSocket = (req: Request) => {
  const srv = (req as unknown as {
    __bunServer?: { upgrade?: (req: Request, o?: unknown) => boolean };
  }).__bunServer;
  const data: Record<string, unknown> = {};
  const socket = {
    readyState: 0,
    send: (_m: unknown) => {},
    close: () => {},
    set onopen(fn: () => void) {
      data.onopen = fn;
    },
    set onmessage(fn: (e: unknown) => void) {
      data.onmessage = fn;
    },
    set onclose(fn: () => void) {
      data.onclose = fn;
    },
    set onerror(_fn: (e: unknown) => void) {
      // Bun upgrade errors are surfaced through the server-side upgrade result.
    },
  };
  const ok = srv?.upgrade?.(req, { data });
  const response = ok
    ? new Response(null, { status: 101 })
    : new Response("upgrade failed", { status: 426 });
  return { socket, response };
};

export {};
