import { mkdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export type NativeContainerProofOptions = {
  root: string;
  layout: string;
  reference: string;
  sourceCommit: string;
  expectedManifestDigest: string;
  image: string;
  sidecarImage: string;
  bun: string;
  outputDir: string;
  callbackHost: string;
  listenHost: string;
  port: number;
  callbackUrl: string;
};

export const NATIVE_CONTAINER_PROOF_USAGE = "node scripts/prove-agent-container-native-recovery.mjs --layout <absolute-OCI-layout> --reference <OCI-tag> --source-commit <40-hex> --expected-manifest-digest sha256:<64-hex> --image <preloaded-local-image> --sidecar-image <preloaded-image@sha256:digest> --bun <absolute-pinned-Bun> --output-dir <fresh-child-of-checkout/tmp/native-container-recovery-proof> --callback-host <Docker-reachable-host> --listen-host <local-interface> --port <1024-65535>";

function ensure(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

export function parseNativeContainerProofArgs(args: readonly string[], repositoryRoot: string): NativeContainerProofOptions {
  const flags = new Set(["--layout", "--reference", "--source-commit", "--expected-manifest-digest", "--image", "--sidecar-image", "--bun", "--output-dir", "--callback-host", "--listen-host", "--port"]);
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    ensure(flag && flags.has(flag) && value && !value.startsWith("--") && !values.has(flag), NATIVE_CONTAINER_PROOF_USAGE);
    values.set(flag, value);
  }
  for (const flag of flags) ensure(values.has(flag), `missing ${flag}; ${NATIVE_CONTAINER_PROOF_USAGE}`);
  const root = resolve(repositoryRoot);
  const absolute = (flag: string) => {
    const value = values.get(flag)!;
    ensure(isAbsolute(value), `${flag} must be absolute`);
    return resolve(value);
  };
  const layout = absolute("--layout");
  const bun = absolute("--bun");
  const outputDir = absolute("--output-dir");
  const outputRoot = join(root, "tmp/native-container-recovery-proof");
  const child = relative(outputRoot, outputDir);
  ensure(child && child !== ".." && !child.startsWith("../") && !isAbsolute(child) && !child.includes("/"),
    "--output-dir must be a fresh direct child of this checkout's tmp/native-container-recovery-proof");
  const reference = values.get("--reference")!;
  ensure(/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/u.test(reference), "--reference must be an OCI tag");
  const sourceCommit = values.get("--source-commit")!;
  ensure(/^[a-f0-9]{40}$/u.test(sourceCommit), "--source-commit must be a full commit SHA");
  const expectedManifestDigest = values.get("--expected-manifest-digest")!;
  ensure(/^sha256:[a-f0-9]{64}$/u.test(expectedManifestDigest), "--expected-manifest-digest must be sha256:<64 hex>");
  const image = values.get("--image")!;
  ensure(/^[a-zA-Z0-9][a-zA-Z0-9_.:/@-]*$/u.test(image), "invalid local --image reference");
  const sidecarImage = values.get("--sidecar-image")!;
  ensure(/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]*@sha256:[a-f0-9]{64}$/u.test(sidecarImage), "--sidecar-image must be digest-pinned");
  const host = (flag: string) => {
    const value = values.get(flag)!;
    ensure(/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/u.test(value), `${flag} must be a bare DNS name or IPv4 address`);
    return value;
  };
  const callbackHost = host("--callback-host");
  const listenHost = host("--listen-host");
  ensure(callbackHost.toLowerCase() !== "localhost" && !callbackHost.startsWith("127.") && callbackHost !== "0.0.0.0",
    "--callback-host must be reachable from the Docker Container, not loopback or an unspecified address");
  const portValue = values.get("--port")!;
  const port = Number(portValue);
  ensure(/^[0-9]+$/u.test(portValue) && Number.isSafeInteger(port) && port >= 1024 && port <= 65535, "invalid --port");
  return { root, layout, reference, sourceCommit, expectedManifestDigest, image, sidecarImage, bun, outputDir, callbackHost, listenHost, port, callbackUrl: `http://${callbackHost}:${port}` };
}

export async function createNativeProofEvidenceDirectory(options: NativeContainerProofOptions): Promise<void> {
  const physicalRoot = await realpath(options.root);
  const temporaryRoot = join(options.root, "tmp");
  const base = join(options.root, "tmp/native-container-recovery-proof");
  ensure(dirname(resolve(options.outputDir)) === base, "proof output is outside the owned base");
  await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
  ensure(await realpath(temporaryRoot) === join(physicalRoot, "tmp"),
    "checkout tmp resolves outside the owning checkout; refusing writes");
  await mkdir(base, { recursive: true, mode: 0o700 });
  ensure(await realpath(base) === join(physicalRoot, "tmp/native-container-recovery-proof"),
    "proof output base resolves outside the owning checkout; refusing writes");
  await mkdir(options.outputDir, { mode: 0o700 }); // EEXIST must refuse, never adopt existing evidence.
}
