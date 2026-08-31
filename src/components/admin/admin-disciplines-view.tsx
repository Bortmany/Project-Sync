// Admin → Disciplines: the catalogue every project picks from. Colours come from a fixed palette,
// never a free colour picker, so the brand stays intact.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createDiscipline, updateDiscipline } from "@/components/actions";
import { fieldError, useAction } from "@/components/hooks/use-action";
import { DISCIPLINE_PALETTE } from "@/lib/discipline-colors";
import {
  Button,
  DisciplineDot,
  EmptyState,
  ErrorBanner,
  Field,
  Input,
  Modal,
} from "@/components/ui";
import type { DisciplineDTO } from "@/lib/zod-schemas";

function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Colour">
      {DISCIPLINE_PALETTE.map((color) => {
        const selected = color.hex.toLowerCase() === value.toLowerCase();
        return (
          <button
            key={color.hex}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={color.label}
            title={color.label}
            onClick={() => onChange(color.hex)}
            className={`h-8 w-8 rounded-full border-2 ${
              selected ? "border-[var(--brand-ink)]" : "border-transparent"
            }`}
            style={{ backgroundColor: color.hex }}
          />
        );
      })}
    </div>
  );
}

function DisciplineDialog({
  discipline,
  onClose,
}: {
  /** Undefined means "add a new one". */
  discipline?: DisciplineDTO;
  onClose: () => void;
}) {
  const router = useRouter();
  const { run, pending, error, fieldErrors } = useAction();
  const [code, setCode] = useState(discipline?.code ?? "");
  const [name, setName] = useState(discipline?.name ?? "");
  const [colorHex, setColorHex] = useState(discipline?.colorHex ?? DISCIPLINE_PALETTE[0].hex);
  const [sortOrder, setSortOrder] = useState(String(discipline?.sortOrder ?? 0));

  function submit() {
    const order = Number(sortOrder) || 0;
    run(
      () =>
        discipline
          ? updateDiscipline({ id: discipline.id, name: name.trim(), colorHex, sortOrder: order })
          : createDiscipline({
              code: code.trim().toUpperCase(),
              name: name.trim(),
              colorHex,
              sortOrder: order,
            }),
      {
        success: `Discipline “${name.trim()}” saved.`,
        failure: "Couldn't save this discipline. Try again.",
        onSuccess: () => {
          router.refresh();
          onClose();
        },
      },
    );
  }

  return (
    <Modal
      open
      size="sm"
      title={discipline ? `Edit ${discipline.name}` : "Add discipline"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={pending} disabled={!name.trim() || (!discipline && !code.trim())} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? <ErrorBanner message={error} /> : null}
        <Field
          label="Code"
          hint={discipline ? "The code can't change — projects and tasks point at it." : "Short, like MECH."}
          error={fieldError(fieldErrors, "code")}
        >
          <Input
            value={discipline?.code ?? code}
            disabled={Boolean(discipline)}
            readOnly={Boolean(discipline)}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Name" error={fieldError(fieldErrors, "name")}>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Colour" error={fieldError(fieldErrors, "colorHex")}>
          <ColorPicker value={colorHex} onChange={setColorHex} />
        </Field>
        <Field label="Order" hint="Where it sits in every discipline list. Lower shows first.">
          <Input
            type="number"
            min={0}
            max={999}
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}

export function AdminDisciplinesView({ disciplines }: { disciplines: DisciplineDTO[] }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<DisciplineDTO | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-[var(--brand-primary)]">Disciplines</h1>
        <Button onClick={() => setAdding(true)}>+ Add discipline</Button>
      </div>

      {disciplines.length === 0 ? (
        <EmptyState message="No disciplines set up yet. Add the disciplines your projects will use, like Mechanical or Electrical." />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)] bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--brand-gray)]">
              <tr>
                <th className="px-3 py-2 font-semibold">Code</th>
                <th className="px-3 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 font-semibold">Colour</th>
                <th className="px-3 py-2 font-semibold">Order</th>
                <th className="px-3 py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {disciplines.map((discipline) => (
                <tr key={discipline.id} className="h-11 hover:bg-[var(--page-bg)]">
                  <td className="px-3 font-semibold text-[var(--brand-ink)]">{discipline.code}</td>
                  <td className="px-3 text-[var(--brand-text)]">{discipline.name}</td>
                  <td className="px-3">
                    <DisciplineDot
                      colorHex={discipline.colorHex}
                      code={
                        DISCIPLINE_PALETTE.find(
                          (color) => color.hex.toLowerCase() === discipline.colorHex.toLowerCase(),
                        )?.label ?? discipline.colorHex
                      }
                      showCode
                    />
                  </td>
                  <td className="px-3 tabular-nums text-[var(--brand-text)]">
                    {discipline.sortOrder}
                  </td>
                  <td className="px-3">
                    <button
                      type="button"
                      onClick={() => setEditing(discipline)}
                      className="text-xs font-semibold text-[var(--brand-primary)] hover:underline"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding ? <DisciplineDialog onClose={() => setAdding(false)} /> : null}
      {editing ? (
        <DisciplineDialog discipline={editing} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}
