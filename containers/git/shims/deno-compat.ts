// Bun migration: minimal, self-installing `globalThis.Deno` runtime compat.
//
// Implements the RUNTIME subset of the Deno namespace this CLI uses, backed by
// Bun / node: APIs. Importing this module installs the global as a side effect
// (idempotent). It does NOT provide `Deno.test` (that is test-only and added by
// shims/deno-test-preload.ts) and deliberately omits the Deno permission model
// (no Node/Bun equivalent).
//
// This is the canonical pattern reused across the ecosystem's Bun migration.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import process from "node:process";
import { Readable, Writable } from "node:stream";
import { createServer, type Server } from "node:http";
import { Buffer } from "node:buffer";

type StdioStr = "piped" | "inherit" | "null";

function mapStdio(v: StdioStr | undefined): "pipe" | "inherit" | "ignore" {
  if (v === "inherit") return "inherit";
  if (v === "null") return "ignore";
  return "pipe";
}

interface CommandOptions {
  args?: string[];
  cwd?: string | URL;
  env?: Record<string, string>;
  clearEnv?: boolean;
  stdin?: StdioStr;
  stdout?: StdioStr;
  stderr?: StdioStr;
  signal?: AbortSignal;
}

interface CommandOutput {
  code: number;
  signal: string | null;
  success: boolean;
  stdout: Uint8Array;
  stderr: Uint8Array;
}

function tempPrefix(opts?: {
  dir?: string;
  prefix?: string;
  suffix?: string;
}): string {
  const prefix = opts?.prefix ?? "";
  const base = path.join(opts?.dir ?? os.tmpdir(), prefix);
  return prefix.length > 0 || base.endsWith(path.sep)
    ? base
    : `${base}${path.sep}`;
}

function buildEnv(opts: CommandOptions): NodeJS.ProcessEnv {
  if (opts.clearEnv) return { ...(opts.env ?? {}) };
  return { ...process.env, ...(opts.env ?? {}) };
}

class DenoCommand {
  #cmd: string;
  #opts: CommandOptions;
  constructor(cmd: string | URL, opts: CommandOptions = {}) {
    this.#cmd = cmd instanceof URL ? cmd.pathname : cmd;
    this.#opts = opts;
  }

  output(): Promise<CommandOutput> {
    const o = this.#opts;
    return new Promise((resolve, reject) => {
      const child = spawn(this.#cmd, o.args ?? [], {
        cwd: o.cwd instanceof URL ? o.cwd.pathname : o.cwd,
        env: buildEnv(o),
        stdio: [
          mapStdio(o.stdin),
          mapStdio(o.stdout ?? "piped"),
          mapStdio(o.stderr ?? "piped"),
        ],
        signal: o.signal,
      });
      const out: Uint8Array[] = [];
      const err: Uint8Array[] = [];
      child.stdout?.on("data", (c: Buffer) => out.push(c));
      child.stderr?.on("data", (c: Buffer) => err.push(c));
      child.on("error", reject);
      child.on("close", (code, sig) => {
        resolve({
          code: code ?? 0,
          signal: sig,
          success: (code ?? 0) === 0,
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

  outputSync(): CommandOutput {
    const o = this.#opts;
    const r = spawnSync(this.#cmd, o.args ?? [], {
      cwd: o.cwd instanceof URL ? o.cwd.pathname : o.cwd,
      env: buildEnv(o),
      stdio: [
        mapStdio(o.stdin),
        mapStdio(o.stdout ?? "piped"),
        mapStdio(o.stderr ?? "piped"),
      ],
    });
    return {
      code: r.status ?? 0,
      signal: r.signal,
      success: (r.status ?? 0) === 0,
      stdout: r.stdout ? new Uint8Array(r.stdout) : new Uint8Array(),
      stderr: r.stderr ? new Uint8Array(r.stderr) : new Uint8Array(),
    };
  }

  spawn(): DenoChildProcess {
    const o = this.#opts;
    const child = spawn(this.#cmd, o.args ?? [], {
      cwd: o.cwd instanceof URL ? o.cwd.pathname : o.cwd,
      env: buildEnv(o),
      stdio: [
        mapStdio(o.stdin),
        mapStdio(o.stdout ?? "piped"),
        mapStdio(o.stderr ?? "piped"),
      ],
      signal: o.signal,
    });
    return new DenoChildProcess(child);
  }
}

interface CommandStatus {
  code: number;
  success: boolean;
  signal: string | null;
}

// Deno's ChildProcess exposes WEB streams for stdin/stdout/stderr, so call
// sites use `child.stdin.getWriter()` / `child.stdout.getReader()`, plus
// `status` and `output()`. Node's child_process exposes node streams. This
// wrapper bridges the two so existing Deno-style call sites run unchanged.
class DenoChildProcess {
  #child: ChildProcess;
  readonly pid: number;
  readonly status: Promise<CommandStatus>;
  #stdoutWeb?: ReadableStream<Uint8Array>;
  #stderrWeb?: ReadableStream<Uint8Array>;
  #stdin?: WritableStream<Uint8Array>;
  #outputPromise?: Promise<CommandOutput>;

  constructor(child: ChildProcess) {
    this.#child = child;
    this.pid = child.pid ?? -1;
    this.status = new Promise<CommandStatus>((res, rej) => {
      child.on("error", rej);
      child.on(
        "close",
        (code, sig) =>
          res({ code: code ?? 0, success: (code ?? 0) === 0, signal: sig }),
      );
    });
  }

  get stdout(): ReadableStream<Uint8Array> {
    if (!this.#stdoutWeb) {
      this.#stdoutWeb = this.#child.stdout
        ? (Readable.toWeb(this.#child.stdout) as unknown as ReadableStream<
          Uint8Array
        >)
        : emptyReadable();
    }
    return this.#stdoutWeb;
  }

  get stderr(): ReadableStream<Uint8Array> {
    if (!this.#stderrWeb) {
      this.#stderrWeb = this.#child.stderr
        ? (Readable.toWeb(this.#child.stderr) as unknown as ReadableStream<
          Uint8Array
        >)
        : emptyReadable();
    }
    return this.#stderrWeb;
  }

  get stdin(): WritableStream<Uint8Array> {
    if (!this.#stdin) {
      this.#stdin = this.#child.stdin
        ? (Writable.toWeb(this.#child.stdin) as WritableStream<Uint8Array>)
        : new WritableStream<Uint8Array>();
    }
    return this.#stdin;
  }

  async output(): Promise<CommandOutput> {
    if (!this.#outputPromise) {
      this.#outputPromise = this.#collectOutput();
    }
    return await this.#outputPromise;
  }

  async #collectOutput(): Promise<CommandOutput> {
    if (this.#stdoutWeb || this.#stderrWeb) {
      const status = await this.status;
      return {
        code: status.code,
        signal: status.signal,
        success: status.success,
        stdout: new Uint8Array(),
        stderr: new Uint8Array(),
      };
    }

    const outChunks: Uint8Array[] = [];
    const errChunks: Uint8Array[] = [];
    this.#child.stdout?.on("data", (c: Buffer) => {
      outChunks.push(new Uint8Array(c));
    });
    this.#child.stderr?.on("data", (c: Buffer) => {
      errChunks.push(new Uint8Array(c));
    });
    const status = await this.status;
    return {
      code: status.code,
      signal: status.signal,
      success: status.success,
      stdout: concat(outChunks),
      stderr: concat(errChunks),
    };
  }

  kill(sig?: NodeJS.Signals): void {
    this.#child.kill(sig);
  }

  ref(): void {
    this.#child.ref?.();
  }
  unref(): void {
    this.#child.unref?.();
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 0) return new Uint8Array();
  if (chunks.length === 1) return chunks[0];
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

function emptyReadable(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
}

class NotFound extends Error {
  override name = "NotFound";
}
class AlreadyExists extends Error {
  override name = "AlreadyExists";
}
class PermissionDenied extends Error {
  override name = "PermissionDenied";
}

function remap(e: unknown): unknown {
  const code = (e as { code?: string })?.code;
  if (code === "ENOENT") {
    return Object.assign(new NotFound((e as Error).message), { cause: e });
  }
  if (code === "EEXIST") {
    return Object.assign(new AlreadyExists((e as Error).message), { cause: e });
  }
  if (code === "EACCES" || code === "EPERM") {
    return Object.assign(new PermissionDenied((e as Error).message), {
      cause: e,
    });
  }
  return e;
}

interface DirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
}

const DenoCompat = {
  args: process.argv.slice(2),
  pid: process.pid,
  build: {
    os:
      (process.platform === "win32"
        ? "windows"
        : process.platform === "darwin"
        ? "darwin"
        : process.platform) as string,
    arch: process.arch,
  },
  errors: { NotFound, AlreadyExists, PermissionDenied },

  env: {
    get: (k: string): string | undefined => process.env[k],
    set: (k: string, v: string): void => {
      process.env[k] = v;
    },
    has: (k: string): boolean => k in process.env,
    delete: (k: string): void => {
      delete process.env[k];
    },
    toObject: (): Record<
      string,
      string
    > => ({ ...process.env } as Record<string, string>),
  },

  exit: (code = 0): never => process.exit(code) as never,
  cwd: (): string => process.cwd(),
  chdir: (dir: string | URL): void =>
    process.chdir(dir instanceof URL ? dir.pathname : dir),
  execPath: (): string => process.execPath,

  addSignalListener: (sig: NodeJS.Signals, handler: () => void): void => {
    process.on(sig, handler);
  },
  removeSignalListener: (sig: NodeJS.Signals, handler: () => void): void => {
    process.off(sig, handler);
  },

  readTextFile: (p: string | URL): Promise<string> =>
    fsp.readFile(p, "utf8").catch((e) => Promise.reject(remap(e))),
  readTextFileSync: (p: string | URL): string => {
    try {
      return fs.readFileSync(p, "utf8");
    } catch (e) {
      throw remap(e);
    }
  },
  readFile: (p: string | URL): Promise<Uint8Array> =>
    fsp.readFile(p).then((b) => new Uint8Array(b)).catch((e) =>
      Promise.reject(remap(e))
    ),

  writeTextFile: (
    p: string | URL,
    data: string,
    opts?: { append?: boolean; create?: boolean; mode?: number },
  ): Promise<void> =>
    fsp.writeFile(p, data, {
      flag: opts?.append ? "a" : "w",
      mode: opts?.mode,
    }),
  writeTextFileSync: (
    p: string | URL,
    data: string,
    opts?: { append?: boolean; create?: boolean; mode?: number },
  ): void =>
    fs.writeFileSync(p, data, {
      flag: opts?.append ? "a" : "w",
      mode: opts?.mode,
    }),
  writeFile: (
    p: string | URL,
    data: Uint8Array,
    opts?: { mode?: number },
  ): Promise<void> => fsp.writeFile(p, data, { mode: opts?.mode }),
  writeFileSync: (
    p: string | URL,
    data: Uint8Array,
    opts?: { mode?: number },
  ): void => fs.writeFileSync(p, data, { mode: opts?.mode }),
  open: async (
    p: string | URL,
    opts?: {
      read?: boolean;
      write?: boolean;
      append?: boolean;
      create?: boolean;
      createNew?: boolean;
      truncate?: boolean;
      mode?: number;
    },
  ): Promise<{ close(): void }> => {
    let flags = "r";
    if (opts?.createNew) flags = "wx";
    else if (opts?.append) flags = opts.read ? "a+" : "a";
    else if (opts?.write && opts.truncate) flags = "w";
    else if (opts?.write && opts.read) flags = opts.create ? "w+" : "r+";
    else if (opts?.write) flags = opts.create ? "w" : "r+";
    try {
      const handle = await fsp.open(p, flags, opts?.mode);
      return { close: () => void handle.close() };
    } catch (e) {
      throw remap(e);
    }
  },

  mkdir: (
    p: string | URL,
    opts?: { recursive?: boolean; mode?: number },
  ): Promise<void> =>
    fsp.mkdir(p, { recursive: opts?.recursive, mode: opts?.mode }).then(() =>
      undefined
    ),
  remove: (p: string | URL, opts?: { recursive?: boolean }): Promise<void> =>
    fsp.rm(p, { recursive: opts?.recursive ?? false, force: false }).catch((
      e,
    ) => Promise.reject(remap(e))),
  removeSync: (p: string | URL, opts?: { recursive?: boolean }): void => {
    try {
      fs.rmSync(p, { recursive: opts?.recursive ?? false, force: false });
    } catch (e) {
      throw remap(e);
    }
  },

  makeTempDir: (opts?: {
    dir?: string;
    prefix?: string;
    suffix?: string;
  }): Promise<string> =>
    fsp.mkdtemp(tempPrefix(opts)).then(async (dir) => {
      if (!opts?.suffix) return dir;
      const target = `${dir}${opts.suffix}`;
      await fsp.rename(dir, target);
      return target;
    }),
  makeTempDirSync: (opts?: {
    dir?: string;
    prefix?: string;
    suffix?: string;
  }): string => {
    const dir = fs.mkdtempSync(tempPrefix(opts));
    if (!opts?.suffix) return dir;
    const target = `${dir}${opts.suffix}`;
    fs.renameSync(dir, target);
    return target;
  },
  makeTempFile: async (
    opts?: { dir?: string; prefix?: string; suffix?: string },
  ): Promise<string> => {
    const dir = opts?.dir ?? os.tmpdir();
    const p = path.join(
      dir,
      `${opts?.prefix ?? ""}${crypto.randomUUID()}${opts?.suffix ?? ""}`,
    );
    await fsp.writeFile(p, "");
    return p;
  },
  makeTempFileSync: (
    opts?: { dir?: string; prefix?: string; suffix?: string },
  ): string => {
    const dir = opts?.dir ?? os.tmpdir();
    const p = path.join(
      dir,
      `${opts?.prefix ?? ""}${crypto.randomUUID()}${opts?.suffix ?? ""}`,
    );
    fs.writeFileSync(p, "");
    return p;
  },

  stat: (p: string | URL) =>
    fsp.stat(p).then(toFileInfo).catch((e) => Promise.reject(remap(e))),
  statSync: (p: string | URL) => {
    try {
      return toFileInfo(fs.statSync(p));
    } catch (e) {
      throw remap(e);
    }
  },
  lstat: (p: string | URL) =>
    fsp.lstat(p).then(toFileInfo).catch((e) => Promise.reject(remap(e))),

  readDir: async function* (p: string | URL): AsyncIterable<DirEntry> {
    let ents: fs.Dirent[];
    try {
      ents = await fsp.readdir(p, { withFileTypes: true });
    } catch (e) {
      throw remap(e);
    }
    for (const e of ents) {
      yield {
        name: e.name,
        isFile: e.isFile(),
        isDirectory: e.isDirectory(),
        isSymlink: e.isSymbolicLink(),
      };
    }
  },

  copyFile: (from: string | URL, to: string | URL): Promise<void> =>
    fsp.copyFile(from, to),
  rename: (from: string | URL, to: string | URL): Promise<void> =>
    fsp.rename(from, to),
  symlink: (target: string | URL, p: string | URL): Promise<void> =>
    fsp.symlink(target, p),
  chmod: (p: string | URL, mode: number): Promise<void> => fsp.chmod(p, mode),
  realPath: (p: string | URL): Promise<string> => fsp.realpath(p),

  Command: DenoCommand,

  serve: denoServe,
};

interface ServeOptions {
  port?: number;
  hostname?: string;
  signal?: AbortSignal;
  onListen?: (params: { hostname: string; port: number }) => void;
}

interface DenoServer {
  addr: { transport: "tcp"; hostname: string; port: number };
  finished: Promise<void>;
  shutdown: () => Promise<void>;
  ref: () => void;
  unref: () => void;
}

// Minimal Deno.serve over node:http. Supports both call shapes used here:
//   Deno.serve(handler) and Deno.serve(options, handler). The handler receives
// a web Request and returns a (possibly async) web Response, matching Deno.
// Returns a server with addr/finished/shutdown so tests can read the bound
// port and tear the server down. This is a runtime-adapter shim for tests /
// local run; the production serving path is unchanged.
function denoServe(
  optionsOrHandler:
    | ServeOptions
    | ((req: Request) => Response | Promise<Response>),
  maybeHandler?: (req: Request) => Response | Promise<Response>,
): DenoServer {
  const options: ServeOptions = typeof optionsOrHandler === "function"
    ? {}
    : optionsOrHandler;
  const handler =
    (typeof optionsOrHandler === "function" ? optionsOrHandler : maybeHandler)!;
  const hostname = options.hostname ?? "0.0.0.0";
  const port = options.port ?? 8000;

  const server: Server = createServer((nodeReq, nodeRes) => {
    void (async () => {
      try {
        const host = nodeReq.headers.host ?? `${hostname}:${addrPort()}`;
        const url = `http://${host}${nodeReq.url ?? "/"}`;
        const method = nodeReq.method ?? "GET";
        const headers = new Headers();
        for (const [k, v] of Object.entries(nodeReq.headers)) {
          if (v === undefined) continue;
          headers.set(k, Array.isArray(v) ? v.join(", ") : v);
        }
        let body: BodyInit | undefined;
        if (method !== "GET" && method !== "HEAD") {
          body = Readable.toWeb(nodeReq) as unknown as ReadableStream<
            Uint8Array
          >;
        }
        const request = new Request(url, {
          method,
          headers,
          body,
          // @ts-ignore duplex is required by undici/Bun when streaming a body
          duplex: body ? "half" : undefined,
        });
        const response = await handler(request);
        nodeRes.statusCode = response.status;
        response.headers.forEach((value, key) => nodeRes.setHeader(key, value));
        if (response.body) {
          const reader = response.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            nodeRes.write(value);
          }
        }
        nodeRes.end();
      } catch (err) {
        nodeRes.statusCode = 500;
        nodeRes.end(String((err as Error)?.message ?? err));
      }
    })();
  });

  let resolveFinished!: () => void;
  const finished = new Promise<void>((res) => {
    resolveFinished = res;
  });
  server.on("close", () => resolveFinished());

  server.listen(port, hostname === "0.0.0.0" ? undefined : hostname, () => {
    options.onListen?.({ hostname, port: addrPort() });
  });

  function addrPort(): number {
    const a = server.address();
    return a && typeof a === "object" ? a.port : port;
  }

  if (options.signal) {
    options.signal.addEventListener("abort", () => server.close(), {
      once: true,
    });
  }

  return {
    get addr() {
      return { transport: "tcp" as const, hostname, port: addrPort() };
    },
    finished,
    shutdown: () =>
      new Promise<void>((res) => {
        server.close(() => res());
      }),
    ref: () => server.ref?.(),
    unref: () => server.unref?.(),
  };
}

function toFileInfo(s: fs.Stats) {
  return {
    isFile: s.isFile(),
    isDirectory: s.isDirectory(),
    isSymlink: s.isSymbolicLink(),
    size: s.size,
    mtime: s.mtime,
    atime: s.atime,
    birthtime: s.birthtime,
    mode: s.mode,
  };
}

// Idempotent install: merge onto any pre-existing partial Deno (e.g. real Deno,
// or the test preload that adds Deno.test on top of this runtime).
const g = globalThis as unknown as { Deno?: Record<string, unknown> };
g.Deno = Object.assign({}, DenoCompat, g.Deno ?? {});

export {};
