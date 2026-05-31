import YAML from "yaml";
import { computeSHA256 } from "../../../shared/utils/hash.ts";
import type { BundleDoc } from "./app-manifest-types.ts";
import { normalizeRepoPath } from "./app-manifest-utils.ts";

function toManifestDocYaml(doc: BundleDoc): string {
  return YAML.stringify(doc).trimEnd();
}

function toUint8Array(content: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof content === "string") {
    return new TextEncoder().encode(content);
  }
  if (content instanceof Uint8Array) {
    return content;
  }
  return new Uint8Array(content);
}

export async function buildBundlePackageData(
  docs: BundleDoc[],
  files: Map<string, ArrayBuffer | Uint8Array | string>,
): Promise<ArrayBuffer> {
  const manifestYaml = `${docs.map(toManifestDocYaml).join("\n---\n")}\n`;
  const entries = new Map<string, Uint8Array>();
  entries.set("manifest.yaml", new TextEncoder().encode(manifestYaml));

  for (const [filePathRaw, content] of files.entries()) {
    const filePath = normalizeRepoPath(filePathRaw);
    if (!filePath) continue;
    entries.set(filePath, toUint8Array(content));
  }

  const checksums: string[] = [];
  for (const [filePath, content] of entries.entries()) {
    checksums.push(`${await computeSHA256(content)} ${filePath}`);
  }
  entries.set(
    "checksums.txt",
    new TextEncoder().encode(`${checksums.sort().join("\n")}\n`),
  );

  const jszip = await import("jszip");
  const JSZip = "default" in jszip ? jszip.default : jszip;
  const zip = new JSZip();
  for (const [filePath, content] of entries.entries()) {
    zip.file(filePath, content);
  }
  return zip.generateAsync({ type: "arraybuffer" });
}

export async function buildParsedPackageFromDocs(
  docs: BundleDoc[],
  files: Map<string, ArrayBuffer | Uint8Array | string>,
): Promise<
  {
    manifestYaml: string;
    normalizedFiles: Map<string, ArrayBuffer>;
    checksums: Map<string, string>;
  }
> {
  const manifestYaml = `${docs.map(toManifestDocYaml).join("\n---\n")}\n`;
  const normalizedFiles = new Map<string, ArrayBuffer>();
  normalizedFiles.set(
    "manifest.yaml",
    new TextEncoder().encode(manifestYaml).buffer as ArrayBuffer,
  );

  for (const [filePathRaw, content] of files.entries()) {
    const filePath = normalizeRepoPath(filePathRaw);
    if (!filePath) continue;
    const bytes = toUint8Array(content);
    normalizedFiles.set(filePath, bytes.buffer as ArrayBuffer);
  }

  const checksums = new Map<string, string>();
  for (const [filePath, content] of normalizedFiles.entries()) {
    checksums.set(filePath, await computeSHA256(new Uint8Array(content)));
  }

  return { manifestYaml, normalizedFiles, checksums };
}
