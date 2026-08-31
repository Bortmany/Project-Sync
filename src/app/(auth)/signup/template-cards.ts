// The three cards the signup screen's template picker shows.
//
// The names and one-line hints are written here; the discipline lists are NOT — they are read from
// INDUSTRY_TEMPLATES, the same lists signup seeds, so a card can never promise something a new
// company does not get. Server-side: the signup page builds the cards and passes them to the form.
//
// Every value of IndustryTemplateSchema must have a card, or a template the API accepts would have
// no way to be chosen. That is proved in src/server/__tests__/signup.service.test.ts.

import { INDUSTRY_TEMPLATES } from "@/server/industry-templates";
import type { IndustryTemplateName } from "@/lib/zod-schemas";
import type { TemplateOption } from "./signup-form";

/** What each template is called on screen, in the order the cards are shown. */
const CARD_TEXT: { value: IndustryTemplateName; label: string; hint: string }[] = [
  {
    value: "OIL_AND_GAS",
    label: "Oil and gas / energy",
    hint: "Eight disciplines, plant and turnaround work.",
  },
  {
    value: "CONSTRUCTION",
    label: "Construction",
    hint: "Seven disciplines, build and handover work.",
  },
  { value: "GENERIC", label: "Start blank", hint: "Three general disciplines to build on." },
];

export const SIGNUP_TEMPLATE_CARDS: TemplateOption[] = CARD_TEXT.map((card) => ({
  ...card,
  disciplines: INDUSTRY_TEMPLATES[card.value].map((row) => row.name),
}));
