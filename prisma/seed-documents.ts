// Seed: the demo project's documents, written the same way the app writes them.
//
// The files are real bytes (a valid PDF, a valid PNG, a real CSV) stored under DATA_DIR/uploads with
// storeFile(), and every revision goes through the document service — so the demo data has real audit
// rows, real revision numbers and a real, half-satisfied document checklist. Nothing here completes or
// changes a task: the seeded statuses and derived progress stay exactly as prisma/seed.ts left them.

import { deflateSync } from "node:zlib";
import { prisma } from "@/lib/db";
import { storeFile, validateUpload } from "@/lib/upload";
import type { UploadMeta } from "@/lib/zod-schemas";
import { actorForUser, type ActorContext } from "@/server/actor";
import { uploadDocumentVersion } from "@/server/services/documents";

export type SeedDocumentsContext = {
  /** The demo project the documents belong to. */
  projectId: string;
  /** The seeded people, keyed by email — the same map prisma/seed.ts builds. */
  userIdByEmail: Map<string, string>;
};

export type SeedDocumentsResult = { documents: number; revisions: number };

/* ------------------------------------------------------------------ */
/* Fixture files                                                       */
/* ------------------------------------------------------------------ */

/** A small but genuinely valid PDF: one A4 page of Helvetica lines. */
function makePdf(title: string, lines: string[]): Buffer {
  const escape = (line: string) => line.replace(/([\\()])/g, "\\$1");
  const text = [
    "BT",
    "/F1 16 Tf",
    "72 780 Td",
    `(${escape(title)}) Tj`,
    "/F1 11 Tf",
    "0 -28 Td",
    ...lines.flatMap((line) => [`(${escape(line)}) Tj`, "0 -16 Td"]),
    "ET",
  ].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(text, "latin1")} >>\nstream\n${text}\nendstream`,
  ];

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const startxref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;

  return Buffer.from(body, "latin1");
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A real PNG: a pale drawing sheet with a red mark-up box, the way a marked-up drawing looks. */
function makeMarkupPng(width = 200, height = 140): Buffer {
  const raw = Buffer.alloc(height * (width * 3 + 1));
  let at = 0;
  for (let y = 0; y < height; y += 1) {
    raw[at] = 0; // no filter on this scanline
    at += 1;
    for (let x = 0; x < width; x += 1) {
      const onGrid = x % 20 === 0 || y % 20 === 0;
      const inMarkup =
        (x >= 40 && x <= 150 && (y === 40 || y === 100)) ||
        (y >= 40 && y <= 100 && (x === 40 || x === 150));
      const [r, g, b] = inMarkup ? [200, 30, 30] : onGrid ? [200, 205, 210] : [246, 247, 248];
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
      at += 3;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // truecolour RGB
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function registerCsv(revision: number, rows: string[]): Buffer {
  const header = [
    `Master Engineering Review Register — Rev ${revision}`,
    "Item,Discipline,Comment,Raised by,Status",
  ];
  return Buffer.from([...header, ...rows, ""].join("\n"), "utf8");
}

/* ------------------------------------------------------------------ */
/* The seed                                                            */
/* ------------------------------------------------------------------ */

const MASTER_REGISTER = "Master Engineering Review Register.csv";

export async function seedDocuments(ctx: SeedDocumentsContext): Promise<SeedDocumentsResult> {
  const actors = new Map<string, ActorContext>();
  const actorFor = async (email: string): Promise<ActorContext> => {
    const cached = actors.get(email);
    if (cached) return cached;
    const userId = ctx.userIdByEmail.get(email);
    if (!userId) throw new Error(`The seed has no person with the email ${email}.`);
    const actor = await actorForUser(userId);
    actors.set(email, actor);
    return actor;
  };

  const mainTaskId = async (title: string): Promise<string> => {
    const task = await prisma.mainTask.findFirst({
      where: { projectId: ctx.projectId, title, deletedAt: null },
      select: { id: true },
    });
    if (!task) throw new Error(`The seed has no main task called "${title}".`);
    return task.id;
  };

  const disciplineTask = async (title: string) => {
    const task = await prisma.disciplineTask.findFirst({
      where: { title, deletedAt: null, mainTask: { projectId: ctx.projectId } },
      select: { id: true, requiredDocuments: { select: { id: true, name: true } } },
    });
    if (!task) throw new Error(`The seed has no discipline task called "${title}".`);
    return task;
  };

  /** Stores real bytes and records them through the service, exactly as the upload route does. */
  const upload = async (
    email: string,
    meta: Omit<UploadMeta, "projectId">,
    filename: string,
    bytes: Buffer,
  ) => {
    const checked = validateUpload(bytes, filename);
    if (!checked.ok) throw new Error(`The seed built an unacceptable file (${filename}): ${checked.error}`);
    const stored = await storeFile(bytes, checked.ext);

    return uploadDocumentVersion(await actorFor(email), { ...meta, projectId: ctx.projectId }, {
      buffer: bytes,
      originalName: filename,
      mimeType: checked.mimeType,
      ext: checked.ext,
      sizeBytes: stored.sizeBytes,
      checksumSha256: stored.checksumSha256,
      storedFilename: stored.storedFilename,
    });
  };

  let documents = 0;
  let revisions = 0;

  /* The shared review register on the design review, at three revisions from three people. */
  const designReviewId = await mainTaskId("Complete Engineering Design Review");

  const rev0 = await upload(
    "khalid.alfarsi@omanlng.example",
    { mainTaskId: designReviewId, title: "Master Engineering Review Register", category: "Register", note: "First issue for comment." },
    MASTER_REGISTER,
    registerCsv(0, [
      "1,MECH,Confirm nozzle loads on the suction drum,Khalid al-Farsi,Open",
      "2,ELEC,Single line diagram missing the new feeder,Fatma al-Zadjali,Open",
      "3,CIVIL,Foundation load case to be reissued,Yousuf al-Amri,Open",
    ]),
  );
  documents += 1;
  revisions += 1;

  await upload(
    "fatma.alzadjali@omanlng.example",
    { documentId: rev0.documentId, note: "Electrical comments closed out." },
    MASTER_REGISTER,
    registerCsv(1, [
      "1,MECH,Confirm nozzle loads on the suction drum,Khalid al-Farsi,Open",
      "2,ELEC,Single line diagram missing the new feeder,Fatma al-Zadjali,Closed",
      "3,CIVIL,Foundation load case to be reissued,Yousuf al-Amri,Open",
      "4,INST,Loop drawing numbering to follow the new standard,Sarah Whitmore,Open",
    ]),
  );
  revisions += 1;

  await upload(
    "sarah.whitmore@omanlng.example",
    { documentId: rev0.documentId, note: "Instrumentation comments added and mechanical closed." },
    MASTER_REGISTER,
    registerCsv(2, [
      "1,MECH,Confirm nozzle loads on the suction drum,Khalid al-Farsi,Closed",
      "2,ELEC,Single line diagram missing the new feeder,Fatma al-Zadjali,Closed",
      "3,CIVIL,Foundation load case to be reissued,Yousuf al-Amri,Open",
      "4,INST,Loop drawing numbering to follow the new standard,Sarah Whitmore,Closed",
    ]),
  );
  revisions += 1;

  /* One of the civil task's two mandatory documents — the other stays outstanding on purpose,
     so the completion gate is visible in the demo. */
  const civil = await disciplineTask("Civil foundation load check");
  const loadCalculation = civil.requiredDocuments.find(
    (item) => item.name === "Foundation load calculation report",
  );
  if (!loadCalculation) throw new Error("The civil task has no foundation load calculation requirement.");

  await upload(
    "yousuf.alamri@omanlng.example",
    {
      disciplineTaskId: civil.id,
      requiredDocumentId: loadCalculation.id,
      title: "Foundation Load Calculation Report",
      category: "Calculation",
      note: "Issued for review. Soil investigation summary still to follow.",
    },
    "Foundation Load Calculation Report.pdf",
    makePdf("Foundation load calculation report", [
      "Project: Sur LNG Expansion Project (SUR-EXP)",
      "Subject: Fourth train compressor foundation — load check",
      "",
      "Governing load case: operating + wind, per the project design basis.",
      "Bearing pressure: 178 kPa against an allowable of 220 kPa.",
      "Settlement: 11 mm total, 4 mm differential — within the equipment limit.",
      "",
      "Conclusion: the foundation as drawn is adequate for the revised nozzle loads.",
      "Outstanding: the soil investigation summary is still with the geotechnical contractor.",
    ]),
  );
  documents += 1;
  revisions += 1;

  /* A marked-up drawing on the overdue vendor review. */
  const motorDataSheets = await disciplineTask("Motor data sheets reviewed");
  await upload(
    "ahmed.albalushi@omanlng.example",
    {
      disciplineTaskId: motorDataSheets.id,
      title: "Motor Data Sheet Markup",
      category: "Markup",
      note: "Vendor data sheet marked up — rated power and insulation class to be confirmed.",
    },
    "Motor Data Sheet Markup.png",
    makeMarkupPng(),
  );
  documents += 1;
  revisions += 1;

  /* The close-out report on the overridden HAZOP task. */
  const hazopId = await mainTaskId("HAZOP Action Close-out");
  await upload(
    "salim.alhinai@omanlng.example",
    {
      mainTaskId: hazopId,
      title: "HAZOP Close-out Report",
      category: "Report",
      note: "Issued to support the close-out. The remaining action sits with operations under MOC-1182.",
    },
    "HAZOP Close-out Report.pdf",
    makePdf("HAZOP close-out report", [
      "Project: Sur LNG Expansion Project (SUR-EXP)",
      "Workshop: Expansion train HAZOP, held over four sessions in April 2026.",
      "",
      "Actions raised: 34. Closed: 33. Transferred to operations: 1 (MOC-1182).",
      "All safety-critical actions are closed and verified by the HSE lead.",
      "",
      "The relief scenario was recalculated and the revised set points are in the",
      "process safeguarding memorandum issued with this report.",
    ]),
  );
  documents += 1;
  revisions += 1;

  return { documents, revisions };
}
