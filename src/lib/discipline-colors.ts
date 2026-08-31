// The only colours a discipline may be given: eight hues drawn from the Tielora family — the blue
// and teal anchors first (--brand-primary #2E5AAC, --brand-accent #46C4B0, --brand-mid #1F3D77,
// --brand-ink #152647), then four muted supporting hues that stay legible as a dot, a bar and a
// Gantt block on white. There is no free colour picker anywhere in the app — that is how the brand
// stays intact.
//
// These are STORED DATA, not CSS: every value here is written onto a Discipline row, which is why
// they are hexes in this file rather than tokens in globals.css (house rule 7 governs the tokens).
// Changing one changes what existing rows should say, so prisma/seed.ts refreshes the demo
// disciplines and src/server/industry-templates.ts must only ever hand out colours from this list —
// `templatesUsePaletteColorsOnly()` proves it.

export type DisciplineColor = { hex: string; label: string };

export const DISCIPLINE_PALETTE: DisciplineColor[] = [
  { hex: "#2E5AAC", label: "Brand blue" },
  { hex: "#46C4B0", label: "Teal" },
  { hex: "#1F3D77", label: "Deep blue" },
  { hex: "#152647", label: "Navy" },
  { hex: "#7A8450", label: "Olive" },
  { hex: "#2F7D63", label: "Green" },
  { hex: "#A8763C", label: "Bronze" },
  { hex: "#6B5B95", label: "Violet" },
];

/** True when a colour is one of the eight allowed hues (case-insensitive). */
export function isPaletteColor(hex: string): boolean {
  return DISCIPLINE_PALETTE.some((color) => color.hex.toLowerCase() === hex.toLowerCase());
}
