export declare function ensureParentDirectory(filePath: string): Promise<void>;
export declare function readJsonFile<T>(filePath: string, fallback: T): Promise<T>;
export declare function writeJsonFile(filePath: string, value: unknown): Promise<void>;
export declare function removeLocalDataDir(dataDir: string): Promise<void>;
//# sourceMappingURL=persistent-shared.d.ts.map