// A tiny ZIP writer, written here rather than pulled in as a dependency.
//
// Why hand-written: the app needs exactly one thing — put a set of files side by side in one
// container an administrator can open with the tool their computer already has. That is the
// "stored" (uncompressed) ZIP entry, which is a 30-byte header, the bytes themselves, a CRC and a
// directory at the end. Roughly two hundred lines, no supply chain, and testable in this repo.
//
// Three rules govern this file:
//  1. **Nothing is ever buffered whole.** Entries are written straight through to the output stream,
//     chunk by chunk, with backpressure respected — the same spirit as `readBounded` in
//     src/server/services/graph.ts. The only thing held in memory is the central directory: one
//     small record per entry.
//  2. **Sizes are written AFTER the data** (the ZIP "data descriptor", general-purpose bit 3). That
//     is what lets an entry be streamed without knowing its length or its CRC in advance, which is
//     what lets a database table be written as JSON without first building the whole string.
//  3. **A plain 4 GB ceiling.** This writer is deliberately 32-bit ZIP, not ZIP64: the offsets and
//     sizes in the format are four bytes wide, and 65,535 is as many entries as the directory can
//     count. Both limits are checked, and passing one throws rather than writing a broken archive.
//  4. **A write failure is an ordinary rejection, never a crash.** A Node write stream with no
//     'error' listener turns a full disk, a revoked permission or a disconnected volume into an
//     UNHANDLED 'error' event, which takes the whole server process down — every request in flight
//     with it, for a background job nobody was waiting on. The listener is attached in the
//     constructor, before a single byte is written, and the failure is re-thrown from the next
//     `push()` or `finish()` so the export job's own try/catch sees it like any other error.

import { createReadStream, createWriteStream, type WriteStream } from "node:fs";
import { once } from "node:events";

/** The largest archive this writer will produce. Past this, a ZIP needs the ZIP64 extensions. */
export const ZIP_MAX_BYTES = 4 * 1024 * 1024 * 1024 - 1;

/** The most entries the end-of-directory record can count. */
export const ZIP_MAX_ENTRIES = 65_535;

/** Thrown when an archive would pass one of the two ceilings above. Plain English on purpose. */
export class ZipLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipLimitError";
  }
}

const LOCAL_SIGNATURE = 0x04034b50;
const DESCRIPTOR_SIGNATURE = 0x08074b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;

/** Stored, no compression. */
const METHOD_STORE = 0;

/**
 * Bit 3: the sizes and CRC follow the data instead of preceding it.
 * Bit 11: the file name is UTF-8, so a document called "Rapport été.pdf" survives the round trip.
 */
const FLAGS = 0x0008 | 0x0800;

/** Version 2.0 — all a stored entry with a data descriptor needs. */
const VERSION = 20;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
    table[index] = value;
  }
  return table;
})();

/** Running CRC-32, the checksum every ZIP entry carries. */
export function crc32(chunk: Uint8Array, previous = 0): number {
  let crc = ~previous;
  for (const byte of chunk) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return ~crc >>> 0;
}

/** MS-DOS time and date, which is what the format stores. Seconds have two-second resolution. */
function dosStamp(when: Date): { time: number; date: number } {
  const year = Math.max(1980, when.getFullYear());
  return {
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
  };
}

type Entry = {
  name: Buffer;
  crc: number;
  size: number;
  offset: number;
  time: number;
  date: number;
};

/**
 * Writes one ZIP file to disk, one entry at a time.
 *
 * Usage is always: `add*` for each entry in turn, then exactly one `finish()`. Every method waits
 * on the output stream, so a slow disk slows the export down instead of filling memory up.
 */
export class ZipWriter {
  private readonly out: WriteStream;
  private readonly entries: Entry[] = [];
  private readonly names = new Set<string>();
  private offset = 0;
  private finished = false;
  /** The first failure the output stream reported, kept so the next call can throw it. */
  private failed: Error | null = null;

  constructor(absolutePath: string) {
    // "wx": refuse to overwrite. Every export writes to a fresh random name, so a clash is a bug.
    this.out = createWriteStream(absolutePath, { flags: "wx" });
    // Attached BEFORE anything is written. Without it, a disk that fills up mid-export emits an
    // 'error' nobody is listening for, and an unhandled 'error' event on a stream is a process
    // crash — not a failed export. The first one is remembered; later ones add nothing.
    this.out.on("error", (error: Error) => {
      this.failed = this.failed ?? error;
    });
  }

  /** Throws whatever the stream reported, so the caller learns about it at its next await. */
  private assertHealthy(): void {
    if (this.failed) throw this.failed;
  }

  /**
   * Waits for the file to be closed — and returns at once if it already is.
   *
   * The early return is what stops a failed archive hanging: a stream that has errored destroys
   * itself and emits 'close' straight away, so waiting for a 'close' that has already happened
   * would never return. Only 'close' is listened for, never 'error': the failure is already
   * recorded by the constructor's listener.
   */
  private waitForClose(): Promise<void> {
    if (this.out.closed) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.out.once("close", () => resolve());
    });
  }

  /** How many bytes have been written so far, headers included. */
  get bytesWritten(): number {
    return this.offset;
  }

  get entryCount(): number {
    return this.entries.length;
  }

  private async push(chunk: Buffer): Promise<void> {
    this.assertHealthy();
    if (this.offset + chunk.length > ZIP_MAX_BYTES) {
      throw new ZipLimitError("This export is larger than 4 GB, which is more than one file can hold.");
    }
    this.offset += chunk.length;
    // A stream that fails while we wait for room rejects this `once`; the recorded failure is the
    // better error of the two, so it is swallowed here and re-thrown on the line below.
    if (!this.out.write(chunk)) await once(this.out, "drain").catch(() => undefined);
    this.assertHealthy();
  }

  private beginEntry(name: string): Entry {
    this.assertHealthy();
    if (this.finished) throw new Error("This archive has already been finished.");
    if (this.entries.length >= ZIP_MAX_ENTRIES) {
      throw new ZipLimitError("This export holds more than 65,535 files, which is more than one ZIP file can list.");
    }
    if (this.names.has(name)) throw new Error(`The archive already has an entry called ${name}.`);
    this.names.add(name);

    const stamp = dosStamp(new Date());
    return {
      name: Buffer.from(name, "utf8"),
      crc: 0,
      size: 0,
      offset: this.offset,
      time: stamp.time,
      date: stamp.date,
    };
  }

  private async writeLocalHeader(entry: Entry): Promise<void> {
    const header = Buffer.alloc(30 + entry.name.length);
    header.writeUInt32LE(LOCAL_SIGNATURE, 0);
    header.writeUInt16LE(VERSION, 4);
    header.writeUInt16LE(FLAGS, 6);
    header.writeUInt16LE(METHOD_STORE, 8);
    header.writeUInt16LE(entry.time, 10);
    header.writeUInt16LE(entry.date, 12);
    // CRC and both sizes are zero here and real in the data descriptor below — that is bit 3.
    header.writeUInt32LE(0, 14);
    header.writeUInt32LE(0, 18);
    header.writeUInt32LE(0, 22);
    header.writeUInt16LE(entry.name.length, 26);
    header.writeUInt16LE(0, 28);
    entry.name.copy(header, 30);
    await this.push(header);
  }

  private async writeDescriptor(entry: Entry): Promise<void> {
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(DESCRIPTOR_SIGNATURE, 0);
    descriptor.writeUInt32LE(entry.crc, 4);
    descriptor.writeUInt32LE(entry.size, 8);
    descriptor.writeUInt32LE(entry.size, 12);
    await this.push(descriptor);
    this.entries.push(entry);
  }

  /** Adds an entry whose bytes are already in hand — a small JSON file, a readme. */
  async addBuffer(name: string, data: Buffer): Promise<void> {
    const entry = this.beginEntry(name);
    await this.writeLocalHeader(entry);
    entry.crc = crc32(data);
    entry.size = data.length;
    await this.push(data);
    await this.writeDescriptor(entry);
  }

  /**
   * Adds an entry from anything that yields chunks — a file on disk, or rows arriving from the
   * database a page at a time. Nothing is held: each chunk is checksummed and written straight out.
   */
  async addStream(name: string, chunks: AsyncIterable<Uint8Array | string>): Promise<void> {
    const entry = this.beginEntry(name);
    await this.writeLocalHeader(entry);

    for await (const chunk of chunks) {
      const buffer = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk);
      if (buffer.length === 0) continue;
      entry.crc = crc32(buffer, entry.crc);
      entry.size += buffer.length;
      if (entry.size > ZIP_MAX_BYTES) {
        throw new ZipLimitError("One file in this export is larger than 4 GB.");
      }
      await this.push(buffer);
    }

    await this.writeDescriptor(entry);
  }

  /** Adds a file from disk under the given name inside the archive. */
  async addFile(name: string, absolutePath: string): Promise<void> {
    await this.addStream(name, createReadStream(absolutePath));
  }

  /** Writes the central directory and closes the file. Returns what was produced. */
  async finish(): Promise<{ bytes: number; entries: number }> {
    // Before `finished` is set, so a failed archive can still be aborted and its part file removed.
    this.assertHealthy();
    if (this.finished) throw new Error("This archive has already been finished.");
    this.finished = true;

    const directoryOffset = this.offset;

    for (const entry of this.entries) {
      const record = Buffer.alloc(46 + entry.name.length);
      record.writeUInt32LE(CENTRAL_SIGNATURE, 0);
      record.writeUInt16LE(VERSION, 4);
      record.writeUInt16LE(VERSION, 6);
      record.writeUInt16LE(FLAGS, 8);
      record.writeUInt16LE(METHOD_STORE, 10);
      record.writeUInt16LE(entry.time, 12);
      record.writeUInt16LE(entry.date, 14);
      record.writeUInt32LE(entry.crc, 16);
      record.writeUInt32LE(entry.size, 20);
      record.writeUInt32LE(entry.size, 24);
      record.writeUInt16LE(entry.name.length, 28);
      record.writeUInt16LE(0, 30); // extra field
      record.writeUInt16LE(0, 32); // comment
      record.writeUInt16LE(0, 34); // disk number
      record.writeUInt16LE(0, 36); // internal attributes
      record.writeUInt32LE(0, 38); // external attributes
      record.writeUInt32LE(entry.offset, 42);
      entry.name.copy(record, 46);
      await this.push(record);
    }

    const end = Buffer.alloc(22);
    end.writeUInt32LE(END_SIGNATURE, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(this.offset - directoryOffset, 12);
    end.writeUInt32LE(directoryOffset, 16);
    end.writeUInt16LE(0, 20);
    await this.push(end);

    const bytes = this.offset;
    this.out.end();
    await this.waitForClose();
    // A stream that failed on the final flush has written a truncated file: say so rather than
    // report a size and hand somebody an archive that will not open.
    this.assertHealthy();
    return { bytes, entries: this.entries.length };
  }

  /** Abandons the archive without finishing it — used when the job fails part-way. */
  async abort(): Promise<void> {
    this.finished = true;
    this.out.destroy();
    await this.waitForClose();
  }
}

/* ------------------------------------------------------------------ */
/* Reading one back (the tests, and nothing else)                      */
/* ------------------------------------------------------------------ */

export type ZipEntry = { name: string; data: Buffer };

/**
 * Reads a whole archive back into memory, checking every CRC. Only ever used by the tests, which
 * is why it is allowed to buffer: an exported archive is proved to be readable by parsing its
 * central directory exactly as an unzip tool does — sizes come from the directory, never from the
 * local headers, because a streamed entry's local header carries zeros by design.
 */
export function readZip(buffer: Buffer): ZipEntry[] {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== END_SIGNATURE) end -= 1;
  if (end < 0) throw new Error("That is not a ZIP file — no end-of-directory record.");

  const count = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];

  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new Error("That archive's directory is damaged.");
    }
    const crc = buffer.readUInt32LE(cursor + 16);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);

    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(start, start + size);

    if (crc32(data) !== crc) throw new Error(`The entry ${name} does not match its checksum.`);
    entries.push({ name, data: Buffer.from(data) });

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}
