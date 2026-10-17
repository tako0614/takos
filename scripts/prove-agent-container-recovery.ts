#!/usr/bin/env bun

/** Local OCI qualification of the same Worker/tool-ACK recovery assertions as the binary proof. */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { imageIdentity, type Options as OciImageIdentityOptions } from "./lib/oci-image-identity.ts";
import { proveAgentWorkerRecovery, safeChildEnv, type RecoveryInstance, type RecoveryRuntime } from "./prove-agent-worker-recovery.ts";

type Json = Record<string, unknown>;
export type Options = { layout: string; reference: string; umoci: string; runc: string; sourceCommit: string; root: string; expectedManifestDigest?: string };
type PidSnapshot = { pid: number; startTicks: string; state: string };
type InitRecord = { pid: number; witness?: PidSnapshot; absentAtCapture: boolean };
type OwnedContainer = RecoveryInstance & { id: string; pidFile: string; init?: InitRecord; createAttempted: boolean; createSucceeded: boolean; cancelled: boolean; startup?: Promise<void>; stopPromise?: Promise<number> };
type RunCommand = (argv: string[], label: string, allowFailure?: boolean, sink?: { value: string }, inheritedPipes?: boolean) => Promise<{ code: number; output: string; stderr?: string }>;
type RuntimeDependencies = { runCommand: RunCommand; readPid: (pid: number) => Promise<PidSnapshot | undefined>; sleep: (ms: number) => Promise<void>; now: () => number };

const COMMAND_MS = 20_000;
const START_MS = 45_000;
const LOG_LIMIT = 24_000;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function ensure(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new Error(detail);
}

function record(value: unknown, detail: string): Json {
  ensure(value && typeof value === "object" && !Array.isArray(value), `${detail} must be an object`);
  return value as Json;
}

function parseArgs(args: readonly string[]): Options {
  const values = new Map<string, string>();
  const allowed = new Set(["--layout", "--reference", "--umoci", "--runc", "--source-commit", "--root", "--expected-manifest-digest"]);
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    ensure(flag && allowed.has(flag) && value && !value.startsWith("--") && !values.has(flag),
      "usage: bun scripts/prove-agent-container-recovery.ts --layout <absolute-OCI-layout> --reference <tag> --umoci <absolute-path> --runc <absolute-path> --source-commit <40-hex> [--expected-manifest-digest sha256:<hex>] [--root <Takos-root>]");
    values.set(flag, value);
  }
  const layout = values.get("--layout");
  const reference = values.get("--reference");
  const umoci = values.get("--umoci");
  const runc = values.get("--runc");
  const sourceCommit = values.get("--source-commit");
  ensure(layout && isAbsolute(layout), "--layout must be absolute");
  ensure(reference && /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/u.test(reference), "--reference must be an OCI tag");
  ensure(umoci && isAbsolute(umoci) && runc && isAbsolute(runc), "--umoci and --runc must be absolute paths");
  ensure(sourceCommit && /^[a-f0-9]{40}$/u.test(sourceCommit), "--source-commit must be a full commit SHA");
  const expectedManifestDigest = values.get("--expected-manifest-digest");
  ensure(!expectedManifestDigest || DIGEST.test(expectedManifestDigest), "--expected-manifest-digest must be sha256:<64 hex>");
  return { layout, reference, umoci, runc, sourceCommit, expectedManifestDigest, root: resolve(values.get("--root") ?? join(import.meta.dir, "..")) };
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function command(argv: string[], label: string, allowFailure = false, sink?: { value: string }, inheritedPipes = false): Promise<{ code: number; output: string; stderr: string }> {
  const child = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", HOME: process.env.HOME ?? "/tmp" } });
  const captured = { stdout: "", stderr: "" };
  const drain = async (stream: ReadableStream<Uint8Array> | null, channel: "stdout" | "stderr") => {
    if (!stream) return;
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = new TextDecoder().decode(value);
        captured[channel] = `${captured[channel]}${text}`.slice(-LOG_LIMIT);
        if (sink) sink.value = `${sink.value}${text}`.slice(-LOG_LIMIT);
      }
    } finally {
      reader.releaseLock();
    }
  };
  // runc create can hand its stdio to init. Reap the CLI without waiting for
  // those inherited pipe descriptors to close when the container later exits.
  const outputs = Promise.all([
    drain(child.stdout as ReadableStream<Uint8Array>, "stdout"),
    drain(child.stderr as ReadableStream<Uint8Array>, "stderr"),
  ]);
  if (inheritedPipes) void outputs.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${label} timed out after ${COMMAND_MS}ms`));
    }, COMMAND_MS);
  });
  let code: number;
  try {
    const finished = inheritedPipes ? child.exited : Promise.all([child.exited, outputs]).then(([exit]) => exit);
    code = await Promise.race([finished, timeout]);
  } catch (error) {
    if (timer) clearTimeout(timer);
    await Promise.race([child.exited, Bun.sleep(5_000).then(() => { throw new Error(`${label} CLI did not reap after SIGKILL`); })]);
    throw new Error(`${String(error)}; stdout=${captured.stdout}; stderr=${captured.stderr}`);
  }
  if (timer) clearTimeout(timer);
  if (code !== 0 && !allowFailure) throw new Error(`${label} failed (${code}); stdout=${captured.stdout}; stderr=${captured.stderr}`);
  return { code, output: captured.stdout, stderr: captured.stderr };
}

async function readPid(pid: number): Promise<PidSnapshot | undefined> {
  try {
    const value = await readFile(`/proc/${pid}/stat`, "utf8");
    const end = value.lastIndexOf(") ");
    ensure(end > 0, `invalid /proc/${pid}/stat`);
    const fields = value.slice(end + 2).trim().split(/\s+/u);
    ensure(fields.length > 19 && /^[0-9]+$/u.test(fields[19]!), `invalid /proc/${pid}/stat start ticks`);
    return { pid, state: fields[0]!, startTicks: fields[19]! };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ESRCH") return undefined;
    throw error;
  }
}

function pidStatus(witness: PidSnapshot, current: PidSnapshot | undefined): "absent" | "reused" | "zombie" | "exited" | "live" {
  if (!current) return "absent";
  if (current.startTicks !== witness.startTicks) return "reused";
  if (current.state === "Z") return "zombie";
  if (current.state === "X" || current.state === "x") return "exited";
  return "live";
}

export class OciRuntime implements RecoveryRuntime {
  private bundle?: string;
  private stateRoot?: string;
  private identity?: Json;
  private readonly owned = new Set<OwnedContainer>();
  private closed = false;
  private cleanupPromise?: Promise<void>;
  private preparePromise?: Promise<void>;
  private terminated: Json[] = [];
  readonly limitation = "Local OCI/runc wrapper and image were exercised with host network for loopback fixtures; production proxy-token verification, live Accounts, Cloudflare Container hosting, queue, model and SSE delivery, plus native notifier KV/object-store quota, durability and timed alarms are untested.";

  constructor(private readonly options: Options, private readonly deps: RuntimeDependencies = { runCommand: command, readPid, sleep: Bun.sleep, now: Date.now }) {}

  private runc(args: string[], label: string, allowFailure = false, sink?: { value: string }, inheritedPipes = false) {
    ensure(this.stateRoot, "runc state root was not created");
    return this.deps.runCommand([this.options.runc, "--root", this.stateRoot, "--rootless", "false", ...args], label, allowFailure, sink, inheritedPipes);
  }

  prepare(context: string): Promise<void> {
    ensure(!this.closed && !this.preparePromise, "runtime already prepared or closed");
    const work = this.prepareOwned(context);
    this.preparePromise = work;
    return work;
  }

  private async prepareOwned(context: string): Promise<void> {
    for (const executable of [this.options.umoci, this.options.runc]) {
      ensure((await stat(executable)).isFile(), `${executable} must be an executable file`);
      await access(executable, 1);
      ensure(!this.closed, "runtime cleanup began during preparation");
    }
    const identityOptions: OciImageIdentityOptions = {
      layout: this.options.layout,
      reference: this.options.reference,
      sourceCommit: this.options.sourceCommit,
      expectedManifestDigest: this.options.expectedManifestDigest,
    };
    this.identity = await imageIdentity(identityOptions);
    ensure(!this.closed, "runtime cleanup began before state creation");
    this.stateRoot = await mkdtemp(join(tmpdir(), "takos-proof-runc-"));
    ensure(!this.closed, "runtime cleanup began before unpack");
    this.bundle = join(context, "oci-bundle");
    await this.deps.runCommand([this.options.umoci, "unpack", "--image", `${this.options.layout}:${this.options.reference}`, this.bundle], "umoci unpack");
    ensure(!this.closed, "runtime cleanup began during unpack");
    const passwd = await readFile(join(this.bundle, "rootfs/etc/passwd"), "utf8");
    ensure(passwd.split("\n").some((line) => /^takos:[^:]*:10001:10001:/u.test(line)), "rootfs takos user does not resolve to uid/gid 10001");
    const bundleConfig = record(JSON.parse(await readFile(join(this.bundle, "config.json"), "utf8")), "OCI runtime config");
    const processConfig = record(bundleConfig.process, "OCI process config");
    const user = record(processConfig.user, "OCI process user");
    ensure(user.uid === 10001 && user.gid === 10001, "umoci did not retain image uid/gid 10001");
    ensure(JSON.stringify(processConfig.args) === JSON.stringify(["/usr/local/bin/takos-agent"]) && processConfig.cwd === "/app", "umoci changed image command or working directory");
    ensure(Array.isArray(bundleConfig.mounts) && Array.isArray(record(bundleConfig.linux, "OCI Linux config").namespaces), "bundle lacks Linux mount/namespace config");
    const namespaces = record(bundleConfig.linux, "OCI Linux config").namespaces as Json[];
    ensure(namespaces.some((ns) => ns.type === "mount") && namespaces.some((ns) => ns.type === "pid") && namespaces.some((ns) => ns.type === "network"), "bundle lacks mount, PID, or network namespace");
    ensure((await stat(join(this.bundle, "rootfs/app"))).isDirectory(), "image workdir /app is missing");
    const binarySHA256 = await sha256(join(this.bundle, "rootfs/usr/local/bin/takos-agent"));
    this.identity.binarySHA256 = binarySHA256;
    this.identity.resolvedUid = 10001;
    this.identity.resolvedGid = 10001;
  }

  evidence(): Json {
    ensure(this.identity, "image identity unavailable");
    return { ...this.identity, terminated: this.terminated, limitation: this.limitation };
  }

  async launch(port: number, token: string, register: (instance: RecoveryInstance) => void, isTimedOut: () => boolean): Promise<RecoveryInstance> {
    ensure(!this.closed && this.bundle && this.stateRoot, "OCI runtime is unavailable");
    const id = `takos-proof-${randomUUID()}`;
    const log = { value: "" };
    const instance: OwnedContainer = {
      id, log, pidFile: join(this.stateRoot, `${id}.pid`), createAttempted: false, createSucceeded: false, cancelled: false,
      isAlive: async () => {
        if (!instance.init) return false;
        const current = await this.deps.readPid(instance.init.pid);
        return instance.init.witness ? pidStatus(instance.init.witness, current) === "live" : Boolean(current);
      },
      stop: () => this.stop(instance),
    };
    this.owned.add(instance);
    register(instance); // Watchdog owns this ID before create/start can await or leave a container behind.
    instance.startup = this.startContainer(instance, port, token, isTimedOut);
    try {
      await instance.startup;
      return instance;
    } catch (error) {
      await instance.stop();
      throw error;
    }
  }

  private async startContainer(instance: OwnedContainer, port: number, token: string, isTimedOut: () => boolean): Promise<void> {
    ensure(this.bundle && this.stateRoot, "runtime was not prepared");
    ensure(!instance.cancelled && !isTimedOut(), "OCI startup cancelled");
    ensure(await sha256(join(this.bundle, "rootfs/usr/local/bin/takos-agent")) === this.identity?.binarySHA256, "unpacked executable changed between instances");
    ensure(!instance.cancelled && !isTimedOut(), "OCI startup cancelled before config write");
    const configPath = join(this.bundle, "config.json");
    const config = record(JSON.parse(await readFile(configPath, "utf8")), "OCI runtime config");
    const proc = record(config.process, "OCI process config");
    // umoci retains the image command and uid but can emit terminal=true.
    // A noninteractive proof has no console socket and uses pipe-backed logs.
    proc.terminal = false;
    const childEnv = safeChildEnv(port, token);
    childEnv.HOME = "/home/takos";
    childEnv.PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
    childEnv.SSL_CERT_FILE = "/etc/ssl/certs/ca-certificates.crt";
    delete childEnv.SSL_CERT_DIR;
    proc.env = Object.entries(childEnv).map(([key, value]) => `${key}=${value}`);
    const linux = record(config.linux, "OCI Linux config");
    const namespaces = linux.namespaces;
    ensure(Array.isArray(namespaces), "OCI namespaces missing");
    linux.namespaces = namespaces.filter((item) => record(item, "OCI namespace").type !== "network");
    await writeFile(configPath, `${JSON.stringify(config)}\n`, { mode: 0o600 });
    ensure(!instance.cancelled && !isTimedOut(), "OCI startup cancelled before create");
    try {
      instance.createAttempted = true;
      await this.runc(["create", "--bundle", this.bundle, "--pid-file", instance.pidFile, instance.id], "runc create", false, instance.log, true);
      instance.createSucceeded = true;
      // Capture init even when abort arrived during create. The stop barrier
      // needs a PID identity/death witness before it can release the lease.
      await this.captureInit(instance);
      ensure(instance.init, "runc create succeeded without a recoverable init PID");
      ensure(!instance.cancelled && !isTimedOut(), "OCI startup cancelled after create");
      ensure(await instance.isAlive(), "runc did not record a live init PID");
      await this.runc(["start", instance.id], "runc start", false, instance.log);
      ensure(!instance.cancelled && !isTimedOut(), "OCI startup cancelled after start");
      const deadline = this.deps.now() + START_MS;
      while (this.deps.now() < deadline) {
        ensure(!instance.cancelled && !isTimedOut(), "OCI startup cancelled during health wait");
        ensure(await instance.isAlive(), `OCI init ${instance.init.pid} exited before health`);
        try {
          const health = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(800) });
          if (health.ok) return;
        } catch { /* listener is starting */ }
        await this.deps.sleep(100);
      }
      throw new Error(`OCI wrapper did not bind loopback port ${port}`);
    } catch (error) {
      instance.log.value = `${instance.log.value}\n${String(error)}`.slice(-LOG_LIMIT);
      throw error;
    }
  }

  private async captureInit(instance: OwnedContainer): Promise<void> {
    if (instance.init) return;
    let pid: number | undefined;
    try {
      const fromFile = Number((await readFile(instance.pidFile, "utf8")).trim());
      if (Number.isSafeInteger(fromFile) && fromFile > 1) pid = fromFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!pid) {
      const state = await this.runc(["state", instance.id], `runc state ${instance.id}`, true);
      if (state.code === 0) {
        const parsed = record(JSON.parse(state.output), "runc state");
        ensure(parsed.id === instance.id, "runc state returned a different container ID");
        if (Number.isSafeInteger(parsed.pid) && Number(parsed.pid) > 1) pid = Number(parsed.pid);
      }
    }
    if (!pid) return;
    const witness = await this.deps.readPid(pid);
    instance.init = { pid, witness, absentAtCapture: !witness };
  }

  private stop(instance: OwnedContainer): Promise<number> {
    instance.cancelled = true; // Synchronous cancellation barrier before awaiting create/start.
    return instance.stopPromise ??= (async () => {
      try { await instance.startup; } catch { /* cleanup also handles partial create */ }
      const failures: string[] = [];
      let stateAbsent = !instance.createAttempted;
      if (this.stateRoot && instance.createAttempted) {
        try { await this.captureInit(instance); } catch (error) { failures.push(`init identity: ${String(error)}`); }
        const before = instance.init ? await this.deps.readPid(instance.init.pid) : undefined;
        const beforeStatus = instance.init?.witness ? pidStatus(instance.init.witness, before) : before ? "unknown" : "absent";
        let killed: { code: number; output: string; stderr?: string } | undefined;
        let deleted: { code: number; output: string; stderr?: string } | undefined;
        try { killed = await this.runc(["kill", instance.id, "KILL"], `runc kill ${instance.id}`, true); }
        catch (error) { failures.push(`runc kill ${instance.id}: ${String(error)}`); }
        try { deleted = await this.runc(["delete", "--force", instance.id], `runc delete ${instance.id}`, true); }
        catch (error) { failures.push(`runc delete ${instance.id}: ${String(error)}`); }
        try {
          const listed = await this.runc(["list", "--format", "json"], "runc list");
          const parsed: unknown = JSON.parse(listed.output);
          // runc 1.4 serializes its empty Go slice as JSON null.
          const state = parsed === null ? [] : parsed;
          ensure(Array.isArray(state), "runc list did not return an array or null");
          stateAbsent = !state.some((item) => item.id === instance.id);
          if (!stateAbsent) failures.push(`owned runc ID ${instance.id} remains after delete`);
        } catch (error) { failures.push(`runc list after ${instance.id}: ${String(error)}`); }
        if (instance.createSucceeded && deleted?.code !== 0) failures.push(`runc delete failed for created ${instance.id}: stdout=${deleted?.output ?? "no result"}; stderr=${deleted?.stderr ?? "no result"}`);
        if (beforeStatus === "live" && killed?.code !== 0) failures.push(`runc kill failed for live init ${instance.init?.pid}: stdout=${killed?.output ?? "no result"}; stderr=${killed?.stderr ?? "no result"}`);
      }
      if (instance.createAttempted && !instance.init) failures.push(`created or partially created ${instance.id} has no init PID witness`);
      let finalStatus: string = "no-init";
      if (instance.init) {
        const deadline = this.deps.now() + 5_000;
        while (true) {
          const current = await this.deps.readPid(instance.init.pid);
          finalStatus = instance.init.witness ? pidStatus(instance.init.witness, current) : current ? "unknown" : "absent";
          if (finalStatus === "absent" || finalStatus === "reused") break;
          if (this.deps.now() >= deadline) break;
          await this.deps.sleep(25);
        }
        if (finalStatus !== "absent" && finalStatus !== "reused") failures.push(`OCI init PID ${instance.init.pid} remains or its identity is unknown (${finalStatus})`);
      }
      if (failures.length) throw new Error(failures.join("; "));
      this.terminated.push({ id: instance.id, initPid: instance.init?.pid ?? null, initStartTicks: instance.init?.witness?.startTicks ?? null, initAbsentAtCapture: instance.init?.absentAtCapture ?? null, initStatus: finalStatus, stateAbsent });
      return 0;
    })();
  }

  cleanup(): Promise<void> {
    this.closed = true;
    return this.cleanupPromise ??= (async () => {
      try { await this.preparePromise; } catch { /* preparation failure still owns partial state */ }
      const stops = await Promise.allSettled([...this.owned].map((item) => item.stop()));
      const failures = stops.flatMap((result) => result.status === "rejected" ? [String(result.reason)] : []);
      if (failures.length) throw new Error(failures.join("; "));
      if (this.stateRoot) await rm(this.stateRoot, { recursive: true, force: true });
    })();
  }
}

export async function proveAgentContainerRecovery(options: Options): Promise<Json> {
  const runtime = new OciRuntime(options);
  return proveAgentWorkerRecovery({ root: options.root, runtime });
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(await proveAgentContainerRecovery(parseArgs(Bun.argv.slice(2)))));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
