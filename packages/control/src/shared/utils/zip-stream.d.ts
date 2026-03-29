export type ZipStreamEntry = {
    name: string;
    size: number;
    modifiedAt?: Date;
    stream: () => Promise<ReadableStream<Uint8Array>>;
};
export declare function createZipStream(entries: ZipStreamEntry[]): ReadableStream<Uint8Array>;
//# sourceMappingURL=zip-stream.d.ts.map