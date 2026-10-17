import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createGunzip } from "node:zlib";

type Json = Record<string, unknown>;
type Descriptor = { mediaType: string; digest: string; size: number; annotations?: Record<string, string> };

export type Options = {
  layout: string;
  reference: string;
  sourceCommit: string;
  expectedManifestDigest?: string;
};

export type ImageIdentity = {
  sourceCommit: string;
  sourceCommitEvidence: string;
  manifestDigest: string;
  configDigest: string;
  layerDigests: string[];
  rootfsDiffIds: string[];
  platform: "linux/amd64";
  imageUser: "takos";
  imageCmd: unknown;
  imageWorkdir: "/app";
};

const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function ensure(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new Error(detail);
}

function record(value: unknown, detail: string): Json {
  ensure(value && typeof value === "object" && !Array.isArray(value), `${detail} must be an object`);
  return value as Json;
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function descriptor(value: unknown, detail: string): Descriptor {
  const parsed = record(value, detail);
  ensure(typeof parsed.mediaType === "string" && typeof parsed.digest === "string" && DIGEST.test(parsed.digest) && Number.isSafeInteger(parsed.size) && Number(parsed.size) >= 0,
    `${detail} has invalid media type, digest, or size`);
  return parsed as Descriptor;
}

async function verifiedBlob(layout: string, item: Descriptor): Promise<Json> {
  const file = join(layout, "blobs", "sha256", item.digest.slice(7));
  const info = await stat(file);
  ensure(info.isFile() && info.size === item.size, `OCI blob ${item.digest} size mismatch`);
  ensure(`sha256:${await sha256(file)}` === item.digest, `OCI blob ${item.digest} digest mismatch`);
  return record(JSON.parse(await readFile(file, "utf8")), `OCI blob ${item.digest}`);
}

export async function imageIdentity(options: Options): Promise<ImageIdentity> {
  ensure((await stat(options.layout)).isDirectory(), "--layout must name a directory");
  ensure(record(JSON.parse(await readFile(join(options.layout, "oci-layout"), "utf8")), "oci-layout").imageLayoutVersion === "1.0.0", "unsupported OCI layout version");
  const index = record(JSON.parse(await readFile(join(options.layout, "index.json"), "utf8")), "OCI index");
  ensure(Array.isArray(index.manifests), "OCI index has no manifests");
  const matches = index.manifests.map((item, i) => descriptor(item, `index descriptor ${i}`)).filter((item) => item.annotations?.["org.opencontainers.image.ref.name"] === options.reference);
  ensure(matches.length === 1, `OCI reference ${options.reference} must resolve to exactly one manifest`);
  const selected = matches[0]!;
  ensure(!options.expectedManifestDigest || options.expectedManifestDigest === selected.digest, "selected manifest differs from expected digest");
  ensure(selected.mediaType === "application/vnd.oci.image.manifest.v1+json", "selected reference is not an OCI image manifest");
  const manifest = await verifiedBlob(options.layout, selected);
  ensure(manifest.schemaVersion === 2 && Array.isArray(manifest.layers), "invalid OCI manifest");
  const configDescriptor = descriptor(manifest.config, "image config descriptor");
  ensure(configDescriptor.mediaType === "application/vnd.oci.image.config.v1+json", "unexpected OCI config type");
  const config = await verifiedBlob(options.layout, configDescriptor);
  const layers = manifest.layers.map((item, i) => descriptor(item, `layer ${i}`));
  const rootfs = record(config.rootfs, "image rootfs");
  ensure(rootfs.type === "layers" && Array.isArray(rootfs.diff_ids) && rootfs.diff_ids.length === layers.length, "image rootfs diff IDs do not match layer count");
  for (const layer of layers) {
    ensure(layer.mediaType === "application/vnd.oci.image.layer.v1.tar+gzip" || layer.mediaType === "application/vnd.oci.image.layer.v1.tar", `unsupported OCI layer type ${layer.mediaType}`);
    const file = join(options.layout, "blobs", "sha256", layer.digest.slice(7));
    const info = await stat(file);
    ensure(info.isFile() && info.size === layer.size && `sha256:${await sha256(file)}` === layer.digest, `OCI layer ${layer.digest} does not match manifest`);
  }
  for (const [index, layer] of layers.entries()) {
    const file = join(options.layout, "blobs", "sha256", layer.digest.slice(7));
    const hash = createHash("sha256");
    const unpacked = layer.mediaType.endsWith("+gzip") ? createReadStream(file).pipe(createGunzip()) : createReadStream(file);
    for await (const chunk of unpacked) hash.update(chunk);
    ensure(`sha256:${hash.digest("hex")}` === rootfs.diff_ids[index], `uncompressed OCI layer ${index} differs from image config`);
  }
  const imageConfig = record(config.config, "image execution config");
  ensure(config.os === "linux" && config.architecture === "amd64", "image must be Linux amd64");
  ensure(imageConfig.User === "takos" && imageConfig.WorkingDir === "/app" && JSON.stringify(imageConfig.Cmd) === JSON.stringify(["/usr/local/bin/takos-agent"]), "image User, Workdir, or Cmd differs from reviewed Dockerfile");
  const labels = config.config && typeof config.config === "object" ? record(imageConfig.Labels ?? {}, "image labels") : {};
  const revision = labels["org.opencontainers.image.revision"];
  ensure(!revision || revision === options.sourceCommit, "embedded source revision differs from asserted commit");
  return {
    sourceCommit: options.sourceCommit,
    sourceCommitEvidence: revision === options.sourceCommit ? "image config revision label" : "operator-supplied build identity; image has no revision label",
    manifestDigest: selected.digest,
    configDigest: configDescriptor.digest,
    layerDigests: layers.map((item) => item.digest),
    rootfsDiffIds: rootfs.diff_ids as string[],
    platform: "linux/amd64",
    imageUser: "takos",
    imageCmd: imageConfig.Cmd,
    imageWorkdir: "/app",
  };
}

/** Assert that a Docker inspect result names and executes the verified OCI image. */
export function assertDockerImageIdentity(
  raw: unknown,
  verified: ImageIdentity,
  expectedDockerImageId: string,
): void {
  const image = record(raw, "Docker image inspect result");
  ensure(DIGEST.test(expectedDockerImageId), "expected Docker image ID must be a sha256 digest");
  ensure(image.Id === expectedDockerImageId, "Docker image ID differs from expected identity");
  ensure(expectedDockerImageId === verified.configDigest || expectedDockerImageId === verified.manifestDigest,
    "expected Docker image ID is not bound to verified OCI config or manifest");

  let hasManifestWitness = false;
  if (Object.hasOwn(image, "Descriptor") && image.Descriptor !== null) {
    const descriptor = record(image.Descriptor, "Docker image descriptor");
    ensure(descriptor.digest === verified.manifestDigest, "Docker descriptor digest differs from verified manifest");
    hasManifestWitness = true;
  } else {
    const repoDigests = Array.isArray(image.RepoDigests) ? image.RepoDigests : [];
    hasManifestWitness = repoDigests.some((item) => {
      if (typeof item !== "string") return false;
      const separator = item.lastIndexOf("@");
      return separator > 0 && item.slice(separator + 1) === verified.manifestDigest;
    });
  }
  ensure(hasManifestWitness, "Docker inspect result does not witness the verified manifest digest");

  ensure(image.Os === "linux" && image.Architecture === "amd64", "Docker image must be Linux amd64");
  const config = record(image.Config, "Docker image config");
  ensure(config.User === verified.imageUser && config.WorkingDir === verified.imageWorkdir &&
    JSON.stringify(config.Cmd) === JSON.stringify(verified.imageCmd),
  "Docker image User, Workdir, or Cmd differs from verified OCI config");
  const rootfs = record(image.RootFS, "Docker image rootfs");
  ensure(rootfs.Type === "layers" && Array.isArray(rootfs.Layers) &&
    JSON.stringify(rootfs.Layers) === JSON.stringify(verified.rootfsDiffIds),
  "Docker image rootfs diff IDs differ from verified OCI config");
}
