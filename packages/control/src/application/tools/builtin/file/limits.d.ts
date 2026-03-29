export declare const BINARY_EXTENSIONS: Set<string>;
export declare function isBinaryFile(path: string): boolean;
export type FileCategory = 'source' | 'config' | 'asset' | 'binary' | 'large';
export declare function validateContent(content: string, path: string): void;
export declare function validateBinaryContent(base64Content: string, path: string): void;
//# sourceMappingURL=limits.d.ts.map