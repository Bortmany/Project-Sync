// The five drawings on the landing page.
//
// Every one of them is static decorative markup: no props, no state, no data fetch, no image file,
// no client JavaScript. They are simplified product frames, never screenshots, and every colour is
// an existing brand or status token — the one red on the page is the blocked sub-task in (a).
//
// The template names and the four dots in (e) are read from the REAL industry templates, so that
// section can never promise a template a new company does not actually get.

import { IntegrationsIcon } from "@/components/shell/icons";
import { INDUSTRY_TEMPLATES } from "@/server/industry-templates";
import { FeatureFrame } from "@/components/public/feature-frame";
import type { IndustryTemplateName } from "@/lib/zod-schemas";

/* ------------------------------------------------------------------ */
/* Small shared pieces                                                 */
/* ------------------------------------------------------------------ */

/** A status chip, drawn the way StatusBadge draws one — decorative, so not the component itself. */
function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
      style={{ backgroundColor: color }}
    >
      {label}
    </span>
  );
}

/** A row of a fake list: a title on the left, anything you like on the right. */
function Row({
  label,
  trailing,
  muted = false,
  indent = false,
}: {
  label: string;
  trailing?: React.ReactNode;
  muted?: boolean;
  indent?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-[var(--radius)] border border-[var(--border)] px-2 py-1.5 ${
        indent ? "ml-4" : ""
      }`}
    >
      <span
        className={`truncate text-[11px] ${
          muted ? "text-[var(--brand-gray)]" : "text-[var(--brand-ink)]"
        }`}
      >
        {label}
      </span>
      {trailing}
    </div>
  );
}

/** A small clock, for the older revisions in (c). */
function ClockGlyph() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0 text-[var(--brand-gray)]"
    >
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 6.5V10l2.4 1.6" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* (a) The golden rule                                                 */
/* ------------------------------------------------------------------ */

export function DerivedStatusVignette() {
  return (
    <FeatureFrame>
      <Row
        label="Foundation design"
        trailing={<Chip label="In progress" color="var(--status-in-progress)" />}
      />
      <div className="flex flex-col gap-2">
        <Row
          indent
          label="Civil — reinforcement"
          trailing={<Chip label="Completed" color="var(--status-completed)" />}
        />
        <Row
          indent
          label="Structural — load check"
          trailing={<Chip label="Completed" color="var(--status-completed)" />}
        />
        <Row
          indent
          label="Process — tie-in data"
          trailing={<Chip label="Blocked" color="var(--status-blocked)" />}
        />
      </div>
    </FeatureFrame>
  );
}

/* ------------------------------------------------------------------ */
/* (b) External contractors                                            */
/* ------------------------------------------------------------------ */

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--page-bg)] p-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--brand-gray)]">
        {title}
      </p>
      {children}
    </div>
  );
}

/** A blank line in the contractor's panel — genuinely empty, never a blurred-out fake. */
function BlankRow() {
  return <div aria-hidden="true" className="h-6 rounded-[var(--radius)] bg-white/60" />;
}

export function ContractorScopeVignette() {
  return (
    <FeatureFrame>
      <div className="flex gap-2">
        <Panel title="Your team">
          <Row label="Cable routing" />
          <Row label="Pump datasheet" />
          <Row label="Vendor review" />
        </Panel>
        <Panel title="Contractor view">
          <Row label="Cable routing" />
          <BlankRow />
          <BlankRow />
        </Panel>
      </div>
      <div className="rounded-[var(--radius)] border border-[var(--border)] p-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--brand-gray)]">
          Awaiting your review
        </p>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="truncate text-[11px] text-[var(--brand-ink)]">Cable routing</span>
          <span className="inline-flex shrink-0 items-center rounded-full border border-[var(--border)] bg-[var(--page-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--brand-text)]">
            Acme Co. · External
          </span>
        </div>
      </div>
    </FeatureFrame>
  );
}

/* ------------------------------------------------------------------ */
/* (c) Document history and the audit trail                            */
/* ------------------------------------------------------------------ */

function TrailStep({ label, last = false }: { label: string; last?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <div className="flex flex-col items-center">
        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[var(--brand-accent)]" />
        {last ? null : <span className="h-6 w-px bg-[var(--border)]" />}
      </div>
      <span className="text-[10px] text-[var(--brand-text)]">{label}</span>
    </div>
  );
}

export function DocumentHistoryVignette() {
  return (
    <FeatureFrame>
      <div className="flex gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="rounded-[var(--radius)] border border-[var(--border)] px-2 py-1.5">
            <p className="truncate text-[11px] font-semibold text-[var(--brand-ink)]">
              Piping isometric — Rev C
            </p>
            <p className="text-[10px] text-[var(--brand-gray)]">Current</p>
          </div>
          <Row label="Rev B" muted trailing={<ClockGlyph />} />
          <Row label="Rev A" muted trailing={<ClockGlyph />} />
        </div>
        <div className="flex shrink-0 flex-col justify-center">
          <TrailStep label="Uploaded" />
          <TrailStep label="Reviewed" />
          <TrailStep label="Approved" last />
        </div>
      </div>
    </FeatureFrame>
  );
}

/* ------------------------------------------------------------------ */
/* (d) The daily brief, copied into chat                               */
/* ------------------------------------------------------------------ */

function BriefLine({ label, count }: { label: string; count: number }) {
  return (
    <Row
      label={label}
      trailing={
        <span className="inline-flex shrink-0 items-center rounded-full bg-[var(--page-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--brand-ink)]">
          {count}
        </span>
      }
    />
  );
}

/** One chat destination: the app's own bubble glyph with a plain-text name — never a brand mark. */
function ChatGlyph({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[var(--brand-primary)]">
        <IntegrationsIcon size={16} />
      </span>
      <span className="text-[9px] text-[var(--brand-text)]">{label}</span>
    </div>
  );
}

export function DailyBriefVignette() {
  return (
    <FeatureFrame>
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-2 rounded-[var(--radius)] border border-[var(--border)] p-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--brand-gray)]">
            Today
          </p>
          <BriefLine label="Due today" count={3} />
          <BriefLine label="Overdue" count={1} />
          <BriefLine label="Mentions" count={2} />
        </div>
        {/* The thin line standing for "the same headlines go over there". */}
        <span aria-hidden="true" className="h-px w-4 shrink-0 bg-[var(--border)]" />
        <div className="flex shrink-0 flex-col gap-2">
          <ChatGlyph label="Slack" />
          <ChatGlyph label="Teams" />
          <ChatGlyph label="Microsoft 365" />
        </div>
      </div>
    </FeatureFrame>
  );
}

/* ------------------------------------------------------------------ */
/* (e) Templates at signup                                             */
/* ------------------------------------------------------------------ */

/** The three cards, with the first four discipline colours of the REAL template behind each. */
const TEMPLATE_CARDS: { template: IndustryTemplateName; label: string }[] = [
  { template: "OIL_AND_GAS", label: "Oil and gas / energy" },
  { template: "CONSTRUCTION", label: "Construction" },
  { template: "GENERIC", label: "Start blank" },
];

export function TemplatesVignette() {
  return (
    <FeatureFrame>
      <div className="flex flex-col gap-2 sm:flex-row">
        {TEMPLATE_CARDS.map((card, index) => (
          <div
            key={card.template}
            className={`flex min-w-0 flex-1 flex-col gap-2 rounded-[var(--radius)] p-2 ${
              index === 0
                ? "border-2 border-[var(--brand-accent)]"
                : "border border-[var(--border)]"
            }`}
          >
            <p className="truncate text-[10px] font-semibold text-[var(--brand-ink)]">
              {card.label}
            </p>
            <div className="flex gap-1">
              {INDUSTRY_TEMPLATES[card.template].slice(0, 4).map((discipline) => (
                <span
                  key={discipline.code}
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: discipline.colorHex }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </FeatureFrame>
  );
}
