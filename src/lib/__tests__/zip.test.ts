// The hand-written ZIP writer: what goes in comes back out, byte for byte and checksum for
// checksum. This file exists because the writer is ours rather than a dependency — a container
// format nobody can open is worse than no export at all.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ZipWriter, crc32, readZip } from "@/lib/zip";

const dir = await mkdtemp(path.join(os.tmpdir(), "tielora-zip-"));
let counter = 0;

/** A fresh path inside the scratch folder — the writer refuses to overwrite, on purpose. */
function scratch(name: string): string {
  counter += 1;
  return path.join(dir, `${counter}-${name}`);
}

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("crc32", () => {
  it("matches the published check value", () => {
    // The standard CRC-32 of "123456789" — every implementation agrees on this one.
    expect(crc32(Buffer.from("123456789", "utf8"))).toBe(0xcbf43926);
  });

  it("can be built up chunk by chunk, which is what a streamed entry needs", () => {
    const whole = crc32(Buffer.from("the quick brown fox", "utf8"));
    const piecemeal = crc32(
      Buffer.from(" brown fox", "utf8"),
      crc32(Buffer.from("the quick", "utf8")),
    );
    expect(piecemeal).toBe(whole);
  });
});

describe("writing an archive", () => {
  it("puts back what it was given, from a buffer, a stream and a file", async () => {
    const source = scratch("source.bin");
    const payload = Buffer.alloc(200_000, 7);
    await writeFile(source, payload);

    async function* rows() {
      yield "[\n";
      for (let index = 0; index < 2_000; index += 1) {
        yield `${index ? ",\n" : ""}{"id":"row-${index}"}`;
      }
      yield "\n]\n";
    }

    const target = scratch("out.zip");
    const zip = new ZipWriter(target);
    await zip.addBuffer("README.txt", Buffer.from("A note — with an em dash.\n", "utf8"));
    await zip.addStream("rows.json", rows());
    await zip.addFile("files/source.bin", source);
    const finished = await zip.finish();

    expect(finished.entries).toBe(3);

    const entries = readZip(await readFile(target));
    const byName = new Map(entries.map((entry) => [entry.name, entry.data]));

    expect([...byName.keys()]).toEqual(["README.txt", "rows.json", "files/source.bin"]);
    expect(byName.get("README.txt")?.toString("utf8")).toBe("A note — with an em dash.\n");
    expect(byName.get("files/source.bin")?.equals(payload)).toBe(true);

    const parsed = JSON.parse(byName.get("rows.json")!.toString("utf8")) as { id: string }[];
    expect(parsed).toHaveLength(2_000);
    expect(parsed[1_999]).toEqual({ id: "row-1999" });
  });

  it("keeps a non-ASCII file name readable", async () => {
    const target = scratch("unicode.zip");
    const zip = new ZipWriter(target);
    await zip.addBuffer("files/Rapport été.pdf", Buffer.from("%PDF-1.4\n", "utf8"));
    await zip.finish();

    const entries = readZip(await readFile(target));
    expect(entries[0]?.name).toBe("files/Rapport été.pdf");
  });

  it("refuses to write the same name twice", async () => {
    const zip = new ZipWriter(scratch("twice.zip"));
    await zip.addBuffer("one.json", Buffer.from("{}", "utf8"));
    await expect(zip.addBuffer("one.json", Buffer.from("{}", "utf8"))).rejects.toThrow(
      /already has an entry/,
    );
    await zip.abort();
  });

  it("refuses to add anything after it has been finished", async () => {
    const zip = new ZipWriter(scratch("closed.zip"));
    await zip.addBuffer("one.json", Buffer.from("{}", "utf8"));
    await zip.finish();
    await expect(zip.addBuffer("two.json", Buffer.from("{}", "utf8"))).rejects.toThrow(
      /already been finished/,
    );
  });
});

describe("when the disk says no", () => {
  /**
   * The one that matters most in this file. A Node write stream with no 'error' listener turns a
   * full disk or a revoked permission into an UNHANDLED 'error' event, which takes the whole
   * server process down. This test would have crashed the runner before the listener existed:
   * every failure now arrives as an ordinary rejected promise the export job can catch.
   */
  it("reports a write failure as a rejection rather than an unhandled crash", async () => {
    // A folder that does not exist: the open fails asynchronously, exactly as ENOSPC would.
    const zip = new ZipWriter(path.join(dir, "no-such-folder", "doomed.zip"));
    await new Promise((resolve) => setTimeout(resolve, 50));

    await expect(zip.addBuffer("one.json", Buffer.from("{}", "utf8"))).rejects.toThrow(/ENOENT/);
    // And it stays failed: finishing reports the same problem instead of claiming a size.
    await expect(zip.finish()).rejects.toThrow(/ENOENT/);
    await zip.abort();
  });

  it("surfaces a failure that arrives part-way through, on the next write", async () => {
    const zip = new ZipWriter(scratch("half-written.zip"));
    await zip.addBuffer("one.json", Buffer.from("{}", "utf8"));

    // Whatever went wrong on the way to the disk, the stream reports it the same way.
    (zip as unknown as { out: NodeJS.EventEmitter }).out.emit(
      "error",
      new Error("ENOSPC: no space left on device"),
    );

    await expect(zip.addBuffer("two.json", Buffer.from("{}", "utf8"))).rejects.toThrow(/ENOSPC/);
    await zip.abort();
  });
});
