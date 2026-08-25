// File-type icon and size wording, shared by the documents table and the version history panel.
// The icon is decided by the filename's extension only — it is a hint for the eye, never a check.
// The real trust decision happens on the server, where the bytes themselves are inspected.

const FAMILY_BY_EXTENSION: Record<string, FileFamily> = {
  pdf: "pdf",
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  gif: "image",
  xlsx: "sheet",
  xls: "sheet",
  csv: "sheet",
  docx: "doc",
  doc: "doc",
  txt: "doc",
  pptx: "slides",
  ppt: "slides",
  zip: "archive",
  dwg: "drawing",
  dxf: "drawing",
};

const FAMILY_COLOR: Record<FileFamily, string> = {
  pdf: "var(--status-blocked)",
  image: "var(--olng-sail)",
  sheet: "var(--status-completed)",
  doc: "var(--olng-blue)",
  slides: "var(--olng-sand)",
  archive: "var(--olng-gray)",
  drawing: "var(--olng-navy)",
  file: "var(--olng-gray)",
};

const FAMILY_LABEL: Record<FileFamily, string> = {
  pdf: "PDF file",
  image: "Image file",
  sheet: "Spreadsheet file",
  doc: "Document file",
  slides: "Slide deck file",
  archive: "Zip file",
  drawing: "Drawing file",
  file: "File",
};

export type FileFamily =
  | "pdf"
  | "image"
  | "sheet"
  | "doc"
  | "slides"
  | "archive"
  | "drawing"
  | "file";

/** "vendor-datasheet.PDF" → "pdf". Empty when the name carries no extension. */
export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot < 0 || dot === filename.length - 1) return "";
  return filename.slice(dot + 1).toLowerCase();
}

export function familyOf(filename: string): FileFamily {
  return FAMILY_BY_EXTENSION[extensionOf(filename)] ?? "file";
}

/** "1.4 MB" / "812 KB" / "640 bytes" — plain English, no long decimals. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

function Glyph({ family }: { family: FileFamily }) {
  const stroke = { stroke: "currentColor", strokeWidth: 1.2, fill: "none" } as const;
  switch (family) {
    case "image":
      return (
        <>
          <circle cx="7.5" cy="11" r="1.2" {...stroke} />
          <path d="M5 16l3-3 2 2 2.5-3 2.5 4z" {...stroke} />
        </>
      );
    case "sheet":
      return (
        <>
          <path d="M5 11h10M5 14h10M8.5 9.5v7M11.5 9.5v7" {...stroke} />
        </>
      );
    case "slides":
      return <path d="M5.5 10.5h9v5h-9z" {...stroke} />;
    case "archive":
      return <path d="M10 3v2M10 6v2M10 9v2M10 12v2" {...stroke} />;
    case "drawing":
      return <path d="M5 16l5-6 5 6z" {...stroke} />;
    case "pdf":
      return <path d="M5.5 11h4M5.5 14h9M5.5 17h6" {...stroke} />;
    default:
      return <path d="M5.5 12h9M5.5 15h6" {...stroke} />;
  }
}

/** The small type icon shown at the start of every document row. */
export function FileTypeIcon({ filename }: { filename: string }) {
  const family = familyOf(filename);
  return (
    <span
      className="relative inline-flex shrink-0 items-center"
      style={{ color: FAMILY_COLOR[family] }}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <path
          d="M4.5 1.5h6.5l4.5 4.5v12a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <path d="M11 1.5V6h4.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <Glyph family={family} />
      </svg>
      <span className="sr-only">{FAMILY_LABEL[family]}</span>
    </span>
  );
}
