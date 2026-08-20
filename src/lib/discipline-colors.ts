// The only colours a discipline may be given. These are exactly the eight brand-derived hues the
// disciplines already ship with (prisma/seed.ts): the blue family first, then the muted supporting
// hues. There is no free colour picker anywhere in the app — that is how the brand stays intact.

export type DisciplineColor = { hex: string; label: string };

export const DISCIPLINE_PALETTE: DisciplineColor[] = [
  { hex: "#00558C", label: "Oman LNG blue" },
  { hex: "#5BC2E7", label: "Sail blue" },
  { hex: "#004F71", label: "Mid blue" },
  { hex: "#003E51", label: "Navy" },
  { hex: "#8A8D6A", label: "Olive" },
  { hex: "#3E7A5E", label: "Green" },
  { hex: "#B08D57", label: "Bronze" },
  { hex: "#7A6A8A", label: "Plum" },
];

/** True when a colour is one of the eight allowed hues (case-insensitive). */
export function isPaletteColor(hex: string): boolean {
  return DISCIPLINE_PALETTE.some((color) => color.hex.toLowerCase() === hex.toLowerCase());
}
