export type ZipStreamEntry = {
  // Path inside the ZIP (UTF-8), must not start with "/"
  name: string;
  // Expected uncompressed size (used only for progress/metadata; ZIP uses streamed sizes)
  size: number;
  modifiedAt?: Date;
  // Provide the file bytes as a web ReadableStream
  stream: () => Promise<ReadableStream<Uint8Array>>;
};

type CentralDirectoryEntry = {
  nameBytes: Uint8Array;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  modTime: number;
  modDate: number;
};

const ZIP_LOCAL_FILE_HEADER_SIG = 0x04034b50;
const ZIP_CENTRAL_DIR_HEADER_SIG = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIR_SIG = 0x06054b50;
const ZIP_DATA_DESCRIPTOR_SIG = 0x08074b50;

const VERSION_NEEDED = 20; // 2.0
const VERSION_MADE_BY = 20; // 2.0

// GPBF bit 3: data descriptor, bit 11: UTF-8 file names
const GPBF_DATA_DESCRIPTOR = 1 << 3;
const GPBF_UTF8 = 1 << 11;
const GPBF = GPBF_DATA_DESCRIPTOR | GPBF_UTF8;

const COMPRESSION_STORE = 0;

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32Update(crc: number, data: Uint8Array): number {
  let c = crc >>> 0;
  for (let i = 0; i < data.length; i++) {
    c = CRC32_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return c >>> 0;
}

function dosDateTime(date: Date): { modTime: number; modDate: number } {
  const d = date;
  const year = Math.max(1980, d.getUTCFullYear());
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const hours = d.getUTCHours();
  const minutes = d.getUTCMinutes();
  const seconds = d.getUTCSeconds();

  const modTime = ((hours & 0x1f) << 11) | ((minutes & 0x3f) << 5) |
    ((Math.floor(seconds / 2)) & 0x1f);
  const modDate = (((year - 1980) & 0x7f) << 9) | ((month & 0x0f) << 5) |
    (day & 0x1f);
  return { modTime, modDate };
}

function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value & 0xffff, true);
}

function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function buildLocalHeader(
  params: { nameBytes: Uint8Array; modTime: number; modDate: number },
): Uint8Array {
  const { nameBytes, modTime, modDate } = params;
  const buf = new Uint8Array(30 + nameBytes.length);
  const view = new DataView(buf.buffer);

  writeU32(view, 0, ZIP_LOCAL_FILE_HEADER_SIG);
  writeU16(view, 4, VERSION_NEEDED);
  writeU16(view, 6, GPBF);
  writeU16(view, 8, COMPRESSION_STORE);
  writeU16(view, 10, modTime);
  writeU16(view, 12, modDate);
  writeU32(view, 14, 0); // CRC32 (data descriptor)
  writeU32(view, 18, 0); // compressed size
  writeU32(view, 22, 0); // uncompressed size
  writeU16(view, 26, nameBytes.length);
  writeU16(view, 28, 0); // extra length

  buf.set(nameBytes, 30);
  return buf;
}

function buildDataDescriptor(
  params: { crc32: number; compressedSize: number; uncompressedSize: number },
): Uint8Array {
  const buf = new Uint8Array(16);
  const view = new DataView(buf.buffer);
  writeU32(view, 0, ZIP_DATA_DESCRIPTOR_SIG);
  writeU32(view, 4, params.crc32);
  writeU32(view, 8, params.compressedSize);
  writeU32(view, 12, params.uncompressedSize);
  return buf;
}

function buildCentralHeader(entry: CentralDirectoryEntry): Uint8Array {
  const buf = new Uint8Array(46 + entry.nameBytes.length);
  const view = new DataView(buf.buffer);

  writeU32(view, 0, ZIP_CENTRAL_DIR_HEADER_SIG);
  writeU16(view, 4, VERSION_MADE_BY);
  writeU16(view, 6, VERSION_NEEDED);
  writeU16(view, 8, GPBF);
  writeU16(view, 10, COMPRESSION_STORE);
  writeU16(view, 12, entry.modTime);
  writeU16(view, 14, entry.modDate);
  writeU32(view, 16, entry.crc32);
  writeU32(view, 20, entry.compressedSize);
  writeU32(view, 24, entry.uncompressedSize);
  writeU16(view, 28, entry.nameBytes.length);
  writeU16(view, 30, 0); // extra length
  writeU16(view, 32, 0); // comment length
  writeU16(view, 34, 0); // disk number start
  writeU16(view, 36, 0); // internal attrs
  writeU32(view, 38, 0); // external attrs
  writeU32(view, 42, entry.localHeaderOffset);

  buf.set(entry.nameBytes, 46);
  return buf;
}

function buildEndOfCentralDirectory(
  params: { entries: number; centralSize: number; centralOffset: number },
): Uint8Array {
  const buf = new Uint8Array(22);
  const view = new DataView(buf.buffer);

  writeU32(view, 0, ZIP_END_OF_CENTRAL_DIR_SIG);
  writeU16(view, 4, 0); // disk number
  writeU16(view, 6, 0); // disk start
  writeU16(view, 8, params.entries);
  writeU16(view, 10, params.entries);
  writeU32(view, 12, params.centralSize);
  writeU32(view, 16, params.centralOffset);
  writeU16(view, 20, 0); // comment length
  return buf;
}

export function createZipStream(
  entries: ZipStreamEntry[],
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  const normalized = entries
    .map((e) => ({
      ...e,
      name: (e.name || "").replace(/\\/g, "/").replace(/^\/+/, ""),
    }))
    .filter((e) => e.name.length > 0);

  return new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        const central: CentralDirectoryEntry[] = [];
        let offset = 0;

        const enqueue = (chunk: Uint8Array) => {
          controller.enqueue(chunk);
          offset += chunk.byteLength;
        };

        for (const entry of normalized) {
          const nameBytes = encoder.encode(entry.name);
          const { modTime, modDate } = dosDateTime(
            entry.modifiedAt || new Date(),
          );
          const localHeaderOffset = offset;

          enqueue(buildLocalHeader({ nameBytes, modTime, modDate }));

          // Stream file bytes while computing CRC32.
          let crc = 0xffffffff;
          let size = 0;
          const stream = await entry.stream();
          const reader = stream.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const chunk = value instanceof Uint8Array
                ? value
                : new Uint8Array(value);
              crc = crc32Update(crc, chunk);
              size += chunk.byteLength;
              enqueue(chunk);
            }
          } finally {
            reader.releaseLock();
          }

          const crc32 = (crc ^ 0xffffffff) >>> 0;
          enqueue(
            buildDataDescriptor({
              crc32,
              compressedSize: size,
              uncompressedSize: size,
            }),
          );

          central.push({
            nameBytes,
            crc32,
            compressedSize: size,
            uncompressedSize: size,
            localHeaderOffset,
            modTime,
            modDate,
          });
        }

        const centralOffset = offset;
        let centralSize = 0;
        for (const entry of central) {
          const header = buildCentralHeader(entry);
          enqueue(header);
          centralSize += header.byteLength;
        }

        enqueue(
          buildEndOfCentralDirectory({
            entries: central.length,
            centralSize,
            centralOffset,
          }),
        );
        controller.close();
      })().catch((err) => {
        controller.error(err);
      });
    },
  });
}
