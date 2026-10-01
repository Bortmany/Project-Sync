// Draws the two Teams app icons into public/teams/ — run once, and again only if the look changes:
//   node scripts/make-teams-icons.mjs
//
// There is no Tielora logo file in the repo, so the icons are a plain lettermark: a "T" on the
// brand's primary blue. The colours are the brand tokens from src/app/globals.css copied once,
// because a PNG cannot read a stylesheet (the same reasoning as the Microsoft logo file):
//   --brand-primary #2e5aac (background), white (the T), --brand-accent #46c4b0 (the small bar).
// Teams' rules: the colour icon is 192x192 and full colour; the outline icon is 32x32, a single
// colour (white) on a transparent background.
//
// Hand-written PNG (zlib + CRC) so there is no image dependency. The T is all straight edges on
// whole pixels, so no anti-aliasing is needed.

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PRIMARY = [0x2e, 0x5a, 0xac, 255];
const ACCENT = [0x46, 0xc4, 0xb0, 255];
const WHITE = [255, 255, 255, 255];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A size x size RGBA canvas, optionally pre-filled, with a fillRect and a PNG encoder. */
function canvas(size, background) {
  const pixels = Buffer.alloc(size * size * 4);
  if (background) for (let i = 0; i < size * size; i += 1) Buffer.from(background).copy(pixels, i * 4);
  return {
    rect(x0, y0, x1, y1, colour) {
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) Buffer.from(colour).copy(pixels, (y * size + x) * 4);
      }
    },
    png() {
      const header = Buffer.alloc(13);
      header.writeUInt32BE(size, 0);
      header.writeUInt32BE(size, 4);
      header[8] = 8; // bit depth
      header[9] = 6; // RGBA
      const rows = Buffer.alloc(size * (size * 4 + 1));
      for (let y = 0; y < size; y += 1) {
        rows[y * (size * 4 + 1)] = 0; // filter: none
        pixels.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
      }
      return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", header),
        chunk("IDAT", deflateSync(rows, { level: 9 })),
        chunk("IEND", Buffer.alloc(0)),
      ]);
    },
  };
}

// 192x192 colour icon: white T, with a short accent bar under it.
const color = canvas(192, PRIMARY);
color.rect(40, 44, 152, 72, WHITE); // the bar of the T
color.rect(82, 72, 110, 140, WHITE); // the stem
color.rect(66, 152, 126, 160, ACCENT); // the accent underline

// 32x32 outline icon: the same T in white on a transparent background.
const outline = canvas(32, [0, 0, 0, 0]);
outline.rect(7, 8, 25, 12, WHITE);
outline.rect(14, 12, 18, 24, WHITE);

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "teams");
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, "color.png"), color.png());
writeFileSync(path.join(dir, "outline.png"), outline.png());
process.stdout.write(`Wrote ${path.join(dir, "color.png")} and outline.png\n`);
