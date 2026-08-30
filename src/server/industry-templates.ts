// The discipline sets a brand-new company starts with, one per industry template.
//
// Server-side only and deliberately in one place: signup seeds an organisation's disciplines from
// exactly this list, so what a new customer sees on day one is defined here and nowhere else.
// Every colour is one of the eight in src/lib/discipline-colors.ts — there is no free colour picker
// anywhere in the app, and a template may not invent one.

import { isPaletteColor } from "@/lib/discipline-colors";
import type { IndustryTemplateName } from "@/lib/zod-schemas";

export type DisciplineTemplateRow = {
  code: string;
  name: string;
  colorHex: string;
  sortOrder: number;
};

/**
 * OIL_AND_GAS is the set Project Nexus shipped with (prisma/seed.ts) — codes, names, colours and
 * order copied exactly, so an oil and gas company signing up gets what the original app had.
 */
const OIL_AND_GAS: DisciplineTemplateRow[] = [
  { code: "MECH", name: "Mechanical", colorHex: "#00558C", sortOrder: 1 },
  { code: "ELEC", name: "Electrical", colorHex: "#5BC2E7", sortOrder: 2 },
  { code: "INST", name: "Instrumentation", colorHex: "#004F71", sortOrder: 3 },
  { code: "CIVIL", name: "Civil", colorHex: "#8A8D6A", sortOrder: 4 },
  { code: "PROC", name: "Process", colorHex: "#003E51", sortOrder: 5 },
  { code: "HSE", name: "HSE", colorHex: "#3E7A5E", sortOrder: 6 },
  { code: "REL", name: "Reliability", colorHex: "#B08D57", sortOrder: 7 },
  { code: "INSP", name: "Inspection", colorHex: "#7A6A8A", sortOrder: 8 },
];

const CONSTRUCTION: DisciplineTemplateRow[] = [
  { code: "STRUCT", name: "Structural", colorHex: "#00558C", sortOrder: 1 },
  { code: "ARCH", name: "Architectural", colorHex: "#5BC2E7", sortOrder: 2 },
  { code: "MEP", name: "MEP", colorHex: "#004F71", sortOrder: 3 },
  { code: "CIVIL", name: "Civil", colorHex: "#8A8D6A", sortOrder: 4 },
  { code: "QAQC", name: "QA/QC", colorHex: "#003E51", sortOrder: 5 },
  { code: "HSE", name: "HSE", colorHex: "#3E7A5E", sortOrder: 6 },
  { code: "SURV", name: "Surveying", colorHex: "#B08D57", sortOrder: 7 },
];

const GENERIC: DisciplineTemplateRow[] = [
  { code: "ENG", name: "Engineering", colorHex: "#00558C", sortOrder: 1 },
  { code: "OPS", name: "Operations", colorHex: "#5BC2E7", sortOrder: 2 },
  { code: "QUAL", name: "Quality", colorHex: "#3E7A5E", sortOrder: 3 },
];

export const INDUSTRY_TEMPLATES: Record<IndustryTemplateName, DisciplineTemplateRow[]> = {
  OIL_AND_GAS,
  CONSTRUCTION,
  GENERIC,
};

/** The disciplines a company starting on this template gets. */
export function disciplinesForTemplate(template: IndustryTemplateName): DisciplineTemplateRow[] {
  return INDUSTRY_TEMPLATES[template];
}

/** True when every template only uses brand palette colours — proved by the signup tests. */
export function templatesUsePaletteColorsOnly(): boolean {
  return Object.values(INDUSTRY_TEMPLATES)
    .flat()
    .every((row) => isPaletteColor(row.colorHex));
}

/**
 * A company name turned into a handle: lower case, words joined by hyphens, nothing else.
 * Falls back to "company" when a name has no letters or digits at all, so there is always something
 * to make unique.
 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "company";
}
