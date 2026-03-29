import { type AppManifest, type AppDeploymentBuildSource, type BundleDoc } from './app-manifest-types';
export declare function appManifestToBundleDocs(manifest: AppManifest, buildSources: Map<string, AppDeploymentBuildSource>): BundleDoc[];
export declare function buildBundlePackageData(docs: BundleDoc[], files: Map<string, ArrayBuffer | Uint8Array | string>): Promise<ArrayBuffer>;
export declare function buildParsedPackageFromDocs(docs: BundleDoc[], files: Map<string, ArrayBuffer | Uint8Array | string>): Promise<{
    manifestYaml: string;
    normalizedFiles: Map<string, ArrayBuffer>;
    checksums: Map<string, string>;
}>;
export declare function extractBuildSourcesFromManifestJson(manifestJson: string | null | undefined): AppDeploymentBuildSource[];
export declare function selectAppManifestPathFromRepo(entries: ReadonlyArray<string>): string | null;
//# sourceMappingURL=app-manifest-bundle.d.ts.map