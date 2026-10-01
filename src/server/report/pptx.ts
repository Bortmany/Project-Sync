// The status report as a PowerPoint: 16:9 widescreen, one slide per page of the shared plan, every
// slide with a real title (so outline view and screen readers work). Built in memory with pptxgenjs
// — no browser, nothing written to disk. Text is left as typed: PowerPoint picks a font that can draw
// any script, so unlike the PDF there is no Latin-only limit here.

import PptxGenJS from "pptxgenjs";
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

// LAYOUT_WIDE is 13.33 x 7.5 inches = 960 x 540 points.
const GEO: Geometry = { pageW: 960, pageH: 540, margin: 36, bodyFont: 14 };
const BODY_TOP = GEO.margin + 52;
const CONTENT_W = GEO.pageW - GEO.margin * 2;
const DAY_MS = 24 * 60 * 60 * 1000;
const FONT = "Arial";

type Slide = PptxGenJS.Slide;
type TextOpts = { size: number; color: string; bold?: boolean; align?: "left" | "right" | "center"; valign?: "top" | "middle" };

const inch = (pt: number): number => pt / 72;
const hex = (color: string): string => color.replace("#", "");

function text(slide: Slide, s: string, x: number, y: number, w: number, h: number, o: TextOpts): void {
  slide.addText(s, {
    x: inch(x),
    y: inch(y),
    w: inch(w),
    h: inch(h),
    fontFace: FONT,
    fontSize: o.size,
    color: hex(o.color),
    bold: o.bold ?? false,
    align: o.align ?? "left",
    valign: o.valign ?? "middle",
    margin: 0,
    wrap: true,
    fit: "none",
  });
}

/** PowerPoint cannot be asked how wide a string is, so shorten by an average character width. */
function clip(s: string, widthPt: number, size: number, bold = false): string {
  const perChar = size * (bold ? 0.56 : 0.5);
  const max = Math.max(4, Math.floor(widthPt / perChar));
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

function box(slide: Slide, pptx: PptxGenJS, x: number, y: number, w: number, h: number, fill: string, o: { round?: boolean; outline?: string; outlineW?: number } = {}): void {
  slide.addShape(o.round ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, {
    x: inch(x),
    y: inch(y),
    w: inch(w),
    h: inch(h),
    fill: { color: hex(fill) },
    line: o.outline ? { color: hex(o.outline), width: o.outlineW ?? 1 } : { type: "none" },
    ...(o.round ? { rectRadius: inch(Math.min(h / 2, 6)) } : {}),
  });
}

function outline(slide: Slide, pptx: PptxGenJS, x: number, y: number, w: number, h: number, color: string, width: number): void {
  slide.addShape(pptx.ShapeType.rect, {
    x: inch(x),
    y: inch(y),
    w: inch(w),
    h: inch(h),
    fill: { type: "none" },
    line: { color: hex(color), width },
  });
}

function rule(slide: Slide, pptx: PptxGenJS, x1: number, y1: number, x2: number, y2: number, color: string, width = 0.75, dash?: boolean): void {
  slide.addShape(pptx.ShapeType.line, {
    x: inch(Math.min(x1, x2)),
    y: inch(Math.min(y1, y2)),
    w: inch(Math.abs(x2 - x1)),
    h: inch(Math.abs(y2 - y1)),
    line: { color: hex(color), width, ...(dash ? { dashType: "dash" as const } : {}) },
  });
}

/* ------------------------------------------------------------------ */

function drawCover(slide: Slide, pptx: PptxGenJS, data: ReportData): void {
  const { pageW, pageH, margin } = GEO;
  text(slide, "Tielora", margin, margin, 200, 22, { size: 14, color: COLOR.white, bold: true });

  // The project name is the slide's real title (the master's title placeholder).
  slide.addText(clip(data.project.name, 2 * 440, 36, true), { placeholder: "title" });

  const pill = Math.min(300, data.project.code.length * 9 + 28);
  box(slide, pptx, margin, 296, pill, 28, COLOR.accent, { round: true });
  text(slide, data.project.code, margin, 296, pill, 28, { size: 14, color: COLOR.ink, bold: true, align: "center" });
  text(slide, `Status report · ${reportDate(data.generatedAt, data.timeZone)}`, margin, 338, 470, 24, {
    size: 14,
    color: COLOR.white,
  });

  const rx = 590;
  const rw = pageW - margin - rx;
  text(slide, `${data.progress.pct}%`, rx, 150, rw, 96, { size: 72, color: COLOR.accent, bold: true });
  box(slide, pptx, rx, 260, rw, 10, COLOR.mid);
  if (data.progress.pct > 0) box(slide, pptx, rx, 260, Math.max(6, (rw * data.progress.pct) / 100), 10, COLOR.accent);
  text(slide, `${data.progress.completed} of ${data.progress.total} main tasks complete`, rx, 280, rw, 22, {
    size: 14,
    color: COLOR.white,
  });

  box(slide, pptx, 0, 424, pageW, 64, COLOR.mid);
  text(slide, coverLine(data), margin, 424, CONTENT_W, 64, { size: 16, color: COLOR.white, bold: true });
  text(slide, FOOTER_TEXT(data), margin, pageH - margin - 4, CONTENT_W, 16, { size: 9, color: COLOR.white });
}

function drawTimeline(slide: Slide, pptx: PptxGenJS, data: ReportData, plan: Extract<PagePlan, { kind: "timeline" }>): void {
  if (plan.empty) {
    text(slide, "This project has no dates yet, so there is no timeline to draw.", GEO.margin, BODY_TOP + 120, CONTENT_W, 30, {
      size: 16,
      color: COLOR.text,
      align: "center",
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
  const rowsBottom = rowsTop + plan.blocks.reduce((sum, block) => sum + block.h, 0);

  let y = rowsTop;
  for (const block of plan.blocks) {
    if (block.band % 2 === 1) box(slide, pptx, GEO.margin, y, CONTENT_W, block.h, COLOR.pageBg);
    y += block.h;
  }

  for (const tick of monthTicks(range.start, range.end, x1 - x0)) {
    const x = x0 + tick.at * (x1 - x0);
    rule(slide, pptx, x, BODY_TOP + 22, x, rowsBottom, COLOR.border, 0.5);
    if (tick.label) text(slide, tick.label, x + 2, BODY_TOP, 80, 12, { size: 9, color: COLOR.text });
  }

  const mainH = timelineRowH(GEO);
  const subH = timelineSubH(GEO);
  const bar = (start: Date | null, deadline: Date, cy: number, h: number, status: string, late: boolean, daysLate: number | null) => {
    const xs = xOf(start ?? deadline);
    const w = Math.max(5, xOf(new Date(deadline.getTime() + DAY_MS)) - xs);
    box(slide, pptx, xs, cy - h / 2, w, h, STATUS_COLOR[status as ReportStatus] ?? COLOR.gray);
    if (late) {
      outline(slide, pptx, xs, cy - h / 2, w, h, COLOR.blocked, 1.5);
      if (daysLate !== null) {
        text(slide, `+${daysLateText(daysLate)}`, xs + w + 3, cy - 6, 40, 12, { size: 9, color: COLOR.blocked, bold: true });
      }
    }
  };

  y = rowsTop;
  for (const block of plan.blocks) {
    let by = y;
    if (block.bandLabel) {
      text(slide, clip(block.bandLabel, labelW, 9, true), GEO.margin + 2, by, labelW, 12, { size: 9, color: COLOR.text, bold: true });
      by += 12;
    }
    const task = block.task;
    text(slide, clip(task.title, labelW - 2, 11, true), GEO.margin + 2, by, labelW - 2, mainH, { size: 11, color: COLOR.ink, bold: true });
    bar(task.startDate, task.deadline, by + mainH / 2, 10, task.status, task.late, task.daysLate);
    by += mainH;
    for (const sub of block.shown) {
      text(slide, clip(sub.title, labelW - 16, 9), GEO.margin + 14, by, labelW - 16, subH, { size: 9, color: COLOR.text });
      bar(sub.startDate, sub.deadline, by + subH / 2, 6, sub.status, sub.late, sub.daysLate);
      by += subH;
    }
    if (block.moreDisciplines > 0) {
      text(slide, `+${block.moreDisciplines} more`, GEO.margin + 14, by, 120, subH, { size: 9, color: COLOR.text });
    }
    y += block.h;
  }

  if (plan.moreNote) text(slide, plan.moreNote, GEO.margin + 2, rowsBottom + 2, CONTENT_W, 16, { size: 11, color: COLOR.text });

  const now = data.generatedAt;
  if (now.getTime() >= range.start.getTime() && now.getTime() <= range.end.getTime()) {
    const tx = xOf(now);
    rule(slide, pptx, tx, BODY_TOP + 22, tx, rowsBottom, COLOR.ink, 1, true);
    text(slide, "Today", tx - 20, BODY_TOP + 11, 40, 11, { size: 9, color: COLOR.ink, bold: true, align: "center" });
  }

  // Legend.
  const ly = GEO.pageH - GEO.margin - 30 - 14;
  let lx = GEO.margin;
  for (const status of STATUS_ORDER) {
    box(slide, pptx, lx, ly + 1, 12, 8, STATUS_COLOR[status]);
    text(slide, STATUS_LABEL[status], lx + 16, ly - 1, 90, 12, { size: 9, color: COLOR.text });
    lx += 16 + STATUS_LABEL[status].length * 4.6 + 14;
  }
  outline(slide, pptx, lx, ly + 1, 12, 8, COLOR.blocked, 1.5);
  text(slide, "Late (+ days)", lx + 16, ly - 1, 80, 12, { size: 9, color: COLOR.text });
  lx += 16 + 13 * 4.6 + 14;
  rule(slide, pptx, lx + 6, ly - 1, lx + 6, ly + 11, COLOR.ink, 1, true);
  text(slide, "Today", lx + 16, ly - 1, 50, 12, { size: 9, color: COLOR.text });
}

type Col = { label: string; x: number; w: number; right?: boolean };

function columns(widths: number[], labels: string[], rightLast = false): Col[] {
  let x = GEO.margin;
  return widths.map((w, index) => {
    const col = { label: labels[index], x, w, right: rightLast && index === widths.length - 1 };
    x += w;
    return col;
  });
}

function tableHeader(slide: Slide, pptx: PptxGenJS, y: number, cols: Col[]): void {
  box(slide, pptx, GEO.margin, y, CONTENT_W, TABLE_HEADER_H, COLOR.ink);
  for (const col of cols) {
    text(slide, col.label, col.x + 6, y, col.w - 12, TABLE_HEADER_H, {
      size: 12,
      color: COLOR.white,
      bold: true,
      align: col.right ? "right" : "left",
    });
  }
}

function drawLate(slide: Slide, pptx: PptxGenJS, plan: Extract<PagePlan, { kind: "late" }>): void {
  if (plan.empty) {
    text(slide, "Nothing is late. Everything open is on schedule.", GEO.margin, BODY_TOP + 120, CONTENT_W, 30, {
      size: 16,
      color: COLOR.text,
      align: "center",
    });
    return;
  }
  const cols = columns([290, 80, 90, 170, 120, 138], ["Task", "Type", "Discipline", "Assigned to", "Deadline", "Days late"], true);
  tableHeader(slide, pptx, BODY_TOP, cols);
  const rowH = tableRowH(GEO);
  let y = BODY_TOP + TABLE_HEADER_H;
  plan.rows.forEach((row, index) => {
    if (index % 2 === 1) box(slide, pptx, GEO.margin, y, CONTENT_W, rowH, COLOR.pageBg);
    const cell = (i: number, s: string) =>
      text(slide, clip(s, cols[i].w - 12, 14), cols[i].x + 6, y, cols[i].w - 12, rowH, { size: 14, color: COLOR.text });
    cell(0, row.title);
    cell(1, row.kind);
    cell(2, row.disciplineCode ?? "-");
    cell(3, row.assigneeName ?? "Not assigned");
    cell(4, reportDate(row.deadline));
    text(slide, `${row.daysLate} ${row.daysLate === 1 ? "day" : "days"}`, cols[5].x + 6, y, cols[5].w - 12, rowH, {
      size: 14,
      color: COLOR.blocked,
      bold: true,
      align: "right",
    });
    y += rowH;
  });
}

function drawFlowItem(slide: Slide, pptx: PptxGenJS, item: FlowItem, y: number): void {
  const rowH = tableRowH(GEO);
  const line = Math.round(GEO.bodyFont * 1.4);
  switch (item.kind) {
    case "heading":
      text(slide, item.text, GEO.margin, y + 8, CONTENT_W, item.h - 12, { size: 16, color: COLOR.ink, bold: true });
      break;
    case "text":
      text(slide, item.text, GEO.margin, y, CONTENT_W, item.h - 4, { size: 14, color: COLOR.text });
      break;
    case "card": {
      const h = item.h - 8;
      box(slide, pptx, GEO.margin, y, CONTENT_W, h, COLOR.white, { outline: COLOR.border, outlineW: 0.75 });
      box(slide, pptx, GEO.margin, y, 4, h, COLOR.blocked);
      text(slide, clip(item.title, CONTENT_W - 120, 14, true), GEO.margin + 14, y + 6, CONTENT_W - 120, line, { size: 14, color: COLOR.ink, bold: true });
      text(slide, "Blocked", GEO.margin + CONTENT_W - 80, y + 6, 70, line, { size: 12, color: COLOR.blocked, bold: true, align: "right" });
      text(slide, `Assigned to: ${item.assignee}`, GEO.margin + 14, y + 6 + line, CONTENT_W - 30, line, { size: 14, color: COLOR.text });
      const wy = y + 6 + line * 2;
      if (item.blockers.length === 0) {
        text(slide, "Waiting on: nothing named", GEO.margin + 14, wy, CONTENT_W - 30, line, { size: 14, color: COLOR.text });
      } else {
        text(slide, "Waiting on:", GEO.margin + 14, wy, 90, line, { size: 14, color: COLOR.text, bold: true });
        item.blockers.forEach((blocker, index) => {
          text(slide, clip(`${blocker.title} - ${blocker.assignee}`, CONTENT_W - 140, 14), GEO.margin + 108, wy + index * line, CONTENT_W - 140, line, {
            size: 14,
            color: COLOR.text,
          });
        });
      }
      break;
    }
    case "docSummary":
      text(slide, `Required documents in place: ${item.inPlace} of ${item.required}`, GEO.margin, y, CONTENT_W, 26, {
        size: 16,
        color: COLOR.ink,
        bold: true,
      });
      box(slide, pptx, GEO.margin, y + 30, 420, 12, COLOR.border);
      if (item.required > 0 && item.inPlace > 0) {
        box(slide, pptx, GEO.margin, y + 30, Math.max(6, (420 * item.inPlace) / item.required), 12, COLOR.completed);
      }
      text(slide, "On discipline tasks that are still open.", GEO.margin, y + 46, CONTENT_W, 14, { size: 10, color: COLOR.text });
      break;
    case "tableHeader":
      tableHeader(slide, pptx, y, item.cols.length === 3 ? columns([300, 220, 368], item.cols) : columns([330, 250, 120, 188], item.cols));
      break;
    case "discRow":
      rule(slide, pptx, GEO.margin, y + rowH, GEO.margin + CONTENT_W, y + rowH, COLOR.border, 0.5);
      text(slide, clip(item.code, 280, 14), GEO.margin + 6, y, 290, rowH, { size: 14, color: COLOR.text });
      text(slide, `${item.inPlace} of ${item.required}`, GEO.margin + 306, y, 200, rowH, { size: 14, color: COLOR.ink, bold: true });
      box(slide, pptx, GEO.margin + 520, y + rowH / 2 - 4, 160, 8, COLOR.border);
      if (item.required > 0 && item.inPlace > 0) {
        box(slide, pptx, GEO.margin + 520, y + rowH / 2 - 4, Math.max(4, (160 * item.inPlace) / item.required), 8, COLOR.completed);
      }
      break;
    case "missingRow": {
      const cols = columns([330, 250, 120, 188], ["", "", "", ""]);
      rule(slide, pptx, GEO.margin, y + rowH, GEO.margin + CONTENT_W, y + rowH, COLOR.border, 0.5);
      const cell = (i: number, s: string) =>
        text(slide, clip(s, cols[i].w - 12, 14), cols[i].x + 6, y, cols[i].w - 12, rowH, { size: 14, color: COLOR.text });
      cell(0, item.doc.name);
      cell(1, item.doc.taskTitle);
      cell(2, item.doc.disciplineCode);
      cell(3, item.doc.assigneeName ?? "Not assigned");
      break;
    }
  }
}

/* ------------------------------------------------------------------ */

/** Draws the whole report and returns the .pptx bytes. */
export async function renderPptx(data: ReportData): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = `${data.project.name} - status report`;
  pptx.author = "Tielora";
  pptx.company = "Tielora";

  const { margin, pageW, pageH } = GEO;
  const footer = FOOTER_TEXT(data);
  const titleBox = (color: string, size: number, h: number, y: number, w: number) => ({
    placeholder: {
      options: {
        name: "title",
        type: "title" as const,
        x: inch(margin),
        y: inch(y),
        w: inch(w),
        h: inch(h),
        fontFace: FONT,
        fontSize: size,
        bold: true,
        color: hex(color),
        align: "left" as const,
        valign: "top" as const,
        margin: 0,
      },
      text: "",
    },
  });

  pptx.defineSlideMaster({
    title: "TIELORA_COVER",
    background: { color: hex(COLOR.ink) },
    objects: [titleBox(COLOR.white, 36, 120, 150, 470)],
  });
  pptx.defineSlideMaster({
    title: "TIELORA_CONTENT",
    background: { color: hex(COLOR.white) },
    objects: [
      titleBox(COLOR.primary, 22, 32, margin, pageW - margin * 2),
      {
        line: {
          x: inch(margin),
          y: inch(margin + 34),
          w: inch(pageW - margin * 2),
          h: 0,
          line: { color: hex(COLOR.border), width: 1 },
        },
      },
      {
        text: {
          text: footer,
          options: {
            x: inch(margin),
            y: inch(pageH - margin + 4),
            w: inch(pageW - margin * 2 - 80),
            h: inch(14),
            fontFace: FONT,
            fontSize: 9,
            color: hex(COLOR.text),
            margin: 0,
            valign: "middle",
          },
        },
      },
    ],
    slideNumber: { x: inch(pageW - margin - 60), y: inch(pageH - margin + 4), w: inch(60), h: inch(14), fontFace: FONT, fontSize: 9, color: hex(COLOR.text), align: "right" },
  });

  for (const plan of planReport(data, GEO)) {
    if (plan.kind === "cover") {
      drawCover(pptx.addSlide({ masterName: "TIELORA_COVER" }), pptx, data);
      continue;
    }
    const slide = pptx.addSlide({ masterName: "TIELORA_CONTENT" });
    slide.addText(plan.title, { placeholder: "title" });
    if (plan.kind === "timeline") drawTimeline(slide, pptx, data, plan);
    else if (plan.kind === "late") drawLate(slide, pptx, plan);
    else {
      let y = BODY_TOP;
      for (const item of plan.items) {
        drawFlowItem(slide, pptx, item, y);
        y += item.h;
      }
    }
  }

  const out = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.from(out as Uint8Array);
}
