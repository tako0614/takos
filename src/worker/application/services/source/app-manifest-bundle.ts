import YAML from "yaml";
import { computeSHA256 } from "../../../shared/utils/hash.ts";
import { safeJsonParseOrDefault } from "../../../shared/utils/index.ts";
import {
  type AppManifest,
  type AppManifestBuildSource,
  BUILD_SOURCE_LABELS,
  type BundleDoc,
} from "./app-manifest-types.ts";
import { normalizeRepoPath } from "./app-manifest-utils.ts";
import { buildBundleDocs } from "./app-manifest-bundle-docs.ts";

export function appManifestToBundleDocs(
  manifest: AppManifest,
  buildSources: Map<string, AppManifestBuildSource>,
): BundleDoc[] {
  return buildBundleDocs(manifest, buildSources);
}

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

export function extractBuildSourcesFromManifestJson(
  manifestJson: string | null | undefined,
): AppManifestBuildSource[] {
  const manifest = safeJsonParseOrDefault<
    {
      objects?: Array<
        {
          type?: string;
          kind?: string;
          name?: string;
          labels?: Record<string, string>;
          metadata?: { name?: string; labels?: Record<string, string> };
        }
      >;
    } | null
  >(manifestJson, null);
  const objects = Array.isArray(manifest?.objects) ? manifest.objects : [];
  return objects
    .filter((item) => (item.type ?? item.kind) === "Workload")
    .map((item) => {
      const labels = {
        ...(item.metadata?.labels || {}),
        ...(item.labels || {}),
      };
      const name = item.name ?? item.metadata?.name;
      const artifactPath = labels[BUILD_SOURCE_LABELS.artifactPath];
      if (!artifactPath || !name) {
        return null;
      }
      return {
        service_name: name,
        artifact_path: artifactPath,
      } satisfies AppManifestBuildSource;
    })
    .filter((item): item is AppManifestBuildSource => item != null)
    .sort((left, right) => left.service_name.localeCompare(right.service_name));
}

export function selectAppManifestPathFromRepo(
  entries: ReadonlyArray<string>,
): string | null {
  if (entries.includes(".takosumi.yml")) return ".takosumi.yml";
  return null;
}
