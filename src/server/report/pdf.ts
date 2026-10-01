// The status report as a PDF: A4 landscape, drawn with pdfkit's own built-in Helvetica — no browser,
// no font files of ours, nothing downloaded, nothing written to disk. Built in memory and returned.
//
// KNOWN LIMIT: the built-in font covers Latin letters only. A project or task title typed in another
// script (Arabic, Chinese, ...) would come out as blanks, so every string is cleaned first and any
// character the font cannot draw becomes "?". The PowerPoint has no such limit (PowerPoint picks a
// font that can). Embedding a wider font is a separate, later decision.

import PDFDocument from "pdfkit";
import {
  FOOTER_TEXT,
  TABLE_HEADER_H,
  TIMELINE_AXIS_H,
  axisRange,
  coverLine,
  daysLateText,
  monthTicks,
  planReport,
  tableRowH,
  timelineRowH,
  timelineSubH,
  type FlowItem,
  type Geometry,
  type PagePlan,
} from "@/server/report/layout";
import { COLOR, STATUS_COLOR, STATUS_LABEL, STATUS_ORDER, type ReportStatus } from "@/server/report/theme";
import { reportDate, type ReportData } from "@/server/services/report";

type Doc = InstanceType<typeof PDFDocument>;

const GEO: Geometry = { pageW: 842, pageH: 595, margin: 36, bodyFont: 12 };
const BODY_TOP = GEO.margin + 52;
const CONTENT_W = GEO.pageW - GEO.margin * 2;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The built-in font cannot draw non-Latin characters: make typographic ones plain, blank out the rest. */
export function pdfSafe(text: string): string {
  return text
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

type TextOptions = { size: number; color: string; bold?: boolean; align?: "left" | "right" | "center"; width?: number };

function write(doc: Doc, text: string, x: number, y: number, o: TextOptions): void {
  const s = pdfSafe(text);
  doc.font(o.bold ? "Helvetica-Bold" : "Helvetica").fontSize(o.size).fillColor(o.color);
  let left = x;
  if (o.align && o.width !== undefined) {
    const w = doc.widthOfString(s);
    left = o.align === "right" ? x + o.width - w : o.align === "center" ? x + (o.width - w) / 2 : x;
  }
  doc.text(s, left, y, { lineBreak: false });
}

/** Shortens text to a width, ending in "..." when it had to. */
function fit(doc: Doc, text: string, maxW: number, size: number, bold = false): string {
  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
  let s = pdfSafe(text);
  if (doc.widthOfString(s) <= maxW) return s;
  while (s.length > 1 && doc.widthOfString(`${s}...`) > maxW) s = s.slice(0, -1);
  return `${s.trimEnd()}...`;
}

/** Word-wraps to at most `maxLines` lines, the last one shortened if the text still does not fit. */
function wrapLines(doc: Doc, text: string, maxW: number, size: number, maxLines: number, bold = false): string[] {
  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
  const words = pdfSafe(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (let i = 0; i < words.length; i += 1) {
    const candidate = line ? `${line} ${words[i]}` : words[i];
    if (doc.widthOfString(candidate) <= maxW || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = words[i];
      if (lines.length === maxLines - 1) {
        line = words.slice(i).join(" ");
        break;
      }
    }
  }
  if (line) lines.push(line);
  return lines.map((l, index) => (index === lines.length - 1 ? fit(doc, l, maxW, size, bold) : l));
}

function rect(doc: Doc, x: number, y: number, w: number, h: number, fill: string, radius = 0): void {
  if (radius > 0) doc.roundedRect(x, y, w, h, radius).fill(fill);
  else doc.rect(x, y, w, h).fill(fill);
}

function line(doc: Doc, x1: number, y1: number, x2: number, y2: number, color: string, width = 0.75): void {
  doc.moveTo(x1, y1).lineTo(x2, y2).lineWidth(width).strokeColor(color).stroke();
}

/* ------------------------------------------------------------------ */
/* Pages                                                               */
/* ------------------------------------------------------------------ */

function drawCover(doc: Doc, data: ReportData): void {
  const { pageW, pageH, margin } = GEO;
  rect(doc, 0, 0, pageW, pageH, COLOR.ink);
  write(doc, "Tielora", margin, margin, { size: 14, color: COLOR.white, bold: true });

  const titleLines = wrapLines(doc, data.project.name, 470, 36, 2, true);
  let y = 170;
  for (const row of titleLines) {
    write(doc, row, margin, y, { size: 36, color: COLOR.white, bold: true });
    y += 44;
  }
  y += 8;
  doc.font("Helvetica-Bold").fontSize(14);
  const code = fit(doc, data.project.code, 300, 14, true);
  const pillW = doc.widthOfString(code) + 24;
  rect(doc, margin, y, pillW, 26, COLOR.accent, 13);
  write(doc, code, margin + 12, y + 6, { size: 14, color: COLOR.ink, bold: true });
  write(doc, `Status report · ${reportDate(data.generatedAt, data.timeZone)}`, margin, y + 40, {
    size: 14,
    color: COLOR.white,
  });

  // The big figure, right side.
  const rx = 560;
  const rw = pageW - margin - rx;
  write(doc, `${data.progress.pct}%`, rx, 170, { size: 72, color: COLOR.accent, bold: true });
  rect(doc, rx, 268, rw, 10, COLOR.mid, 5);
  if (data.progress.pct > 0) rect(doc, rx, 268, Math.max(10, (rw * data.progress.pct) / 100), 10, COLOR.accent, 5);
  write(doc, `${data.progress.completed} of ${data.progress.total} main tasks complete`, rx, 288, {
    size: 12,
    color: COLOR.white,
  });

  // The one line that matters, along the bottom.
  rect(doc, 0, 448, pageW, 64, COLOR.mid);
  write(doc, fit(doc, coverLine(data), CONTENT_W, 15, true), margin, 471, { size: 15, color: COLOR.white, bold: true });

  write(doc, FOOTER_TEXT(data), margin, pageH - margin + 6, { size: 9, color: COLOR.white });
}

function titleBar(doc: Doc, title: string): void {
  write(doc, title, GEO.margin, GEO.margin, { size: 22, color: COLOR.primary, bold: true });
  line(doc, GEO.margin, GEO.margin + 34, GEO.pageW - GEO.margin, GEO.margin + 34, COLOR.border, 1);
}

function drawTimeline(doc: Doc, data: ReportData, plan: Extract<PagePlan, { kind: "timeline" }>): void {
  titleBar(doc, plan.title);
  if (plan.empty) {
    write(doc, "This project has no dates yet, so there is no timeline to draw.", GEO.margin, BODY_TOP + 140, {
      size: 14,
      color: COLOR.text,
      align: "center",
      width: CONTENT_W,
    });
    return;
  }
  const range = axisRange(data);
  if (!range) return;

  const labelW = Math.round(CONTENT_W * 0.25);
  const x0 = GEO.margin + labelW + 8;
  const x1 = GEO.pageW - GEO.margin;
  const span = range.end.getTime() - range.start.getTime();
  const xOf = (date: Date) => x0 + ((date.getTime() - range.start.getTime()) / span) * (x1 - x0);

  const rowsTop = BODY_TOP + TIMELINE_AXIS_H;
  const rowsH = plan.blocks.reduce((sum, block) => sum + block.h, 0);
  const rowsBottom = rowsTop + rowsH;

  // Phase bands: alternating stripes behind the rows, the phase name at the top of each band.
  let y = rowsTop;
  for (const block of plan.blocks) {
    if (block.band % 2 === 1) rect(doc, GEO.margin, y, CONTENT_W, block.h, COLOR.pageBg);
    y += block.h;
  }

  // Month lines and labels.
  for (const tick of monthTicks(range.start, range.end, x1 - x0)) {
    const x = x0 + tick.at * (x1 - x0);
    line(doc, x, BODY_TOP + 22, x, rowsBottom, COLOR.border, 0.5);
    if (tick.label) write(doc, tick.label, x + 2, BODY_TOP, { size: 9, color: COLOR.text });
  }

  // Rows.
  const mainH = timelineRowH(GEO);
  const subH = timelineSubH(GEO);
  y = rowsTop;
  const bar = (start: Date | null, deadline: Date, cy: number, h: number, status: string, late: boolean, daysLate: number | null) => {
    const xs = xOf(start ?? deadline);
    const xe = xOf(new Date(deadline.getTime() + DAY_MS));
    const w = Math.max(5, xe - xs);
    rect(doc, xs, cy - h / 2, w, h, STATUS_COLOR[status as ReportStatus] ?? COLOR.gray, 2);
    if (late) {
      doc.roundedRect(xs, cy - h / 2, w, h, 2).lineWidth(1.5).strokeColor(COLOR.blocked).stroke();
      if (daysLate !== null) {
        write(doc, `+${daysLateText(daysLate)}`, xs + w + 3, cy - 5, { size: 9, color: COLOR.blocked, bold: true });
      }
    }
  };

  for (const block of plan.blocks) {
    let by = y;
    if (block.bandLabel) {
      write(doc, fit(doc, block.bandLabel, labelW, 9, true), GEO.margin + 2, by + 1, { size: 9, color: COLOR.text, bold: true });
      by += 12;
    }
    const task = block.task;
    write(doc, fit(doc, task.title, labelW - 2, 11, true), GEO.margin + 2, by + (mainH - 11) / 2, {
      size: 11,
      color: COLOR.ink,
      bold: true,
    });
    bar(task.startDate, task.deadline, by + mainH / 2, 10, task.status, task.late, task.daysLate);
    by += mainH;
    for (const sub of block.shown) {
      write(doc, fit(doc, sub.title, labelW - 16, 9), GEO.margin + 14, by + (subH - 9) / 2, { size: 9, color: COLOR.text });
      bar(sub.startDate, sub.deadline, by + subH / 2, 6, sub.status, sub.late, sub.daysLate);
      by += subH;
    }
    if (block.moreDisciplines > 0) {
      write(doc, `+${block.moreDisciplines} more`, GEO.margin + 14, by + (subH - 9) / 2, { size: 9, color: COLOR.text });
    }
    y += block.h;
  }

  if (plan.moreNote) write(doc, plan.moreNote, GEO.margin + 2, rowsBottom + 4, { size: 10, color: COLOR.text });

  // Today: a dashed line, labelled at the top.
  const now = data.generatedAt;
  if (now.getTime() >= range.start.getTime() && now.getTime() <= range.end.getTime()) {
    const tx = xOf(now);
    doc.moveTo(tx, BODY_TOP + 22).lineTo(tx, rowsBottom).lineWidth(1).dash(3, { space: 3 }).strokeColor(COLOR.ink).stroke().undash();
    write(doc, "Today", tx - 12, BODY_TOP + 12, { size: 9, color: COLOR.ink, bold: true });
  }

  // Legend along the bottom of the body.
  const ly = GEO.pageH - GEO.margin - 30 - 14;
  let lx = GEO.margin;
  for (const status of STATUS_ORDER) {
    rect(doc, lx, ly + 1, 12, 8, STATUS_COLOR[status], 2);
    write(doc, STATUS_LABEL[status], lx + 16, ly, { size: 9, color: COLOR.text });
    lx += 16 + doc.widthOfString(STATUS_LABEL[status]) + 14;
  }
  doc.roundedRect(lx, ly + 1, 12, 8, 2).lineWidth(1.5).strokeColor(COLOR.blocked).stroke();
  write(doc, "Late (+ days)", lx + 16, ly, { size: 9, color: COLOR.text });
  lx += 16 + doc.widthOfString("Late (+ days)") + 14;
  doc.moveTo(lx + 6, ly - 1).lineTo(lx + 6, ly + 11).lineWidth(1).dash(2, { space: 2 }).strokeColor(COLOR.ink).stroke().undash();
  write(doc, "Today", lx + 16, ly, { size: 9, color: COLOR.text });
}

function tableHeader(doc: Doc, y: number, cols: { label: string; x: number; w: number; right?: boolean }[]): void {
  rect(doc, GEO.margin, y, CONTENT_W, TABLE_HEADER_H, COLOR.ink);
  for (const col of cols) {
    write(doc, col.label, col.x + 6, y + 7, {
      size: 11,
      color: COLOR.white,
      bold: true,
      align: col.right ? "right" : "left",
      width: col.w - 12,
    });
  }
}

function columns(widths: number[], labels: string[], rightLast = false) {
  let x = GEO.margin;
  return widths.map((w, index) => {
    const col = { label: labels[index], x, w, right: rightLast && index === widths.length - 1 };
    x += w;
    return col;
  });
}

function drawLate(doc: Doc, plan: Extract<PagePlan, { kind: "late" }>): void {
  titleBar(doc, plan.title);
  if (plan.empty) {
    write(doc, "Nothing is late. Everything open is on schedule.", GEO.margin, BODY_TOP + 140, {
      size: 14,
      color: COLOR.text,
      align: "center",
      width: CONTENT_W,
    });
    return;
  }
  const cols = columns([250, 70, 80, 150, 100, 120], ["Task", "Type", "Discipline", "Assigned to", "Deadline", "Days late"], true);
  tableHeader(doc, BODY_TOP, cols);
  const rowH = tableRowH(GEO);
  let y = BODY_TOP + TABLE_HEADER_H;
  plan.rows.forEach((row, index) => {
    if (index % 2 === 1) rect(doc, GEO.margin, y, CONTENT_W, rowH, COLOR.pageBg);
    const ty = y + (rowH - 12) / 2;
    const cell = (i: number, text: string) =>
      write(doc, fit(doc, text, cols[i].w - 12, 12), cols[i].x + 6, ty, { size: 12, color: COLOR.text });
    cell(0, row.title);
    cell(1, row.kind);
    cell(2, row.disciplineCode ?? "-");
    cell(3, row.assigneeName ?? "Not assigned");
    cell(4, reportDate(row.deadline));
    write(doc, `${row.daysLate} ${row.daysLate === 1 ? "day" : "days"}`, cols[5].x + 6, ty, {
      size: 12,
      color: COLOR.blocked,
      bold: true,
      align: "right",
      width: cols[5].w - 12,
    });
    y += rowH;
  });
}

function drawFlowItem(doc: Doc, item: FlowItem, y: number): void {
  const rowH = tableRowH(GEO);
  switch (item.kind) {
    case "heading":
      write(doc, item.text, GEO.margin, y + 12, { size: 15, color: COLOR.ink, bold: true });
      break;
    case "text":
      write(doc, fit(doc, item.text, CONTENT_W, 12), GEO.margin, y + 4, { size: 12, color: COLOR.text });
      break;
    case "card": {
      const h = item.h - 8;
      rect(doc, GEO.margin, y, CONTENT_W, h, COLOR.white);
      doc.rect(GEO.margin, y, CONTENT_W, h).lineWidth(0.75).strokeColor(COLOR.border).stroke();
      rect(doc, GEO.margin, y, 4, h, COLOR.blocked);
      write(doc, fit(doc, item.title, CONTENT_W - 120, 12, true), GEO.margin + 14, y + 8, { size: 12, color: COLOR.ink, bold: true });
      write(doc, "Blocked", GEO.margin + CONTENT_W - 70, y + 8, { size: 11, color: COLOR.blocked, bold: true });
      write(doc, `Assigned to: ${item.assignee}`, GEO.margin + 14, y + 8 + 17, { size: 12, color: COLOR.text });
      const wy = y + 8 + 34;
      if (item.blockers.length === 0) {
        write(doc, "Waiting on: nothing named", GEO.margin + 14, wy, { size: 12, color: COLOR.text });
      } else {
        write(doc, "Waiting on:", GEO.margin + 14, wy, { size: 12, color: COLOR.text, bold: true });
        item.blockers.forEach((blocker, index) => {
          write(
            doc,
            fit(doc, `${blocker.title} - ${blocker.assignee}`, CONTENT_W - 120, 12),
            GEO.margin + 92,
            wy + index * 17,
            { size: 12, color: COLOR.text },
          );
        });
      }
      break;
    }
    case "docSummary": {
      write(doc, `Required documents in place: ${item.inPlace} of ${item.required}`, GEO.margin, y + 4, {
        size: 15,
        color: COLOR.ink,
        bold: true,
      });
      rect(doc, GEO.margin, y + 28, 420, 12, COLOR.border, 6);
      if (item.required > 0 && item.inPlace > 0) {
        rect(doc, GEO.margin, y + 28, Math.max(12, (420 * item.inPlace) / item.required), 12, COLOR.completed, 6);
      }
      write(doc, "On discipline tasks that are still open.", GEO.margin, y + 44, { size: 10, color: COLOR.text });
      break;
    }
    case "tableHeader":
      if (item.cols.length === 3) {
        tableHeader(doc, y, columns([260, 200, 310], item.cols));
      } else {
        tableHeader(doc, y, columns([290, 230, 100, 150], item.cols));
      }
      break;
    case "discRow": {
      const ty = y + (rowH - 12) / 2;
      line(doc, GEO.margin, y + rowH, GEO.margin + CONTENT_W, y + rowH, COLOR.border, 0.5);
      write(doc, fit(doc, item.code, 250, 12), GEO.margin + 6, ty, { size: 12, color: COLOR.text });
      write(doc, `${item.inPlace} of ${item.required}`, GEO.margin + 266, ty, { size: 12, color: COLOR.ink, bold: true });
      rect(doc, GEO.margin + 466, y + rowH / 2 - 4, 150, 8, COLOR.border, 4);
      if (item.required > 0 && item.inPlace > 0) {
        rect(doc, GEO.margin + 466, y + rowH / 2 - 4, Math.max(8, (150 * item.inPlace) / item.required), 8, COLOR.completed, 4);
      }
      break;
    }
    case "missingRow": {
      const ty = y + (rowH - 12) / 2;
      const cols = columns([290, 230, 100, 150], ["", "", "", ""]);
      line(doc, GEO.margin, y + rowH, GEO.margin + CONTENT_W, y + rowH, COLOR.border, 0.5);
      const cell = (i: number, text: string) =>
        write(doc, fit(doc, text, cols[i].w - 12, 12), cols[i].x + 6, ty, { size: 12, color: COLOR.text });
      cell(0, item.doc.name);
      cell(1, item.doc.taskTitle);
      cell(2, item.doc.disciplineCode);
      cell(3, item.doc.assigneeName ?? "Not assigned");
      break;
    }
  }
}

function drawFlow(doc: Doc, plan: Extract<PagePlan, { kind: "flow" }>): void {
  titleBar(doc, plan.title);
  let y = BODY_TOP;
  for (const item of plan.items) {
    drawFlowItem(doc, item, y);
    y += item.h;
  }
}

/* ------------------------------------------------------------------ */

/** Draws the whole report and returns the PDF bytes. */
export async function renderPdf(data: ReportData): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: 0,
    bufferPages: true,
    autoFirstPage: true,
    info: {
      Title: pdfSafe(`${data.project.name} - status report`),
      Author: "Tielora",
      Creator: "Tielora",
    },
  });
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const plans = planReport(data, GEO);
  plans.forEach((plan, index) => {
    if (index > 0) doc.addPage();
    switch (plan.kind) {
      case "cover":
        drawCover(doc, data);
        break;
      case "timeline":
        drawTimeline(doc, data, plan);
        break;
      case "late":
        drawLate(doc, plan);
        break;
      case "flow":
        drawFlow(doc, plan);
        break;
    }
  });

  // Footer and page number on every content page (the cover draws its own).
  const total = plans.length;
  for (let index = 1; index < total; index += 1) {
    doc.switchToPage(index);
    const fy = GEO.pageH - GEO.margin + 6;
    write(doc, FOOTER_TEXT(data), GEO.margin, fy, { size: 9, color: COLOR.text });
    write(doc, `Page ${index + 1} of ${total}`, GEO.margin, fy, {
      size: 9,
      color: COLOR.text,
      align: "right",
      width: CONTENT_W,
    });
  }

  doc.end();
  return finished;
}
