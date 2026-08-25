"use client";

import { Copy, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { SetSpec } from "@/utils/exercise-set-specs";
import type { PrescribedField } from "@/utils/prescribed-fields";
import { SET_TYPE_OPTIONS, type SetSpecEdit } from "./use-set-spec-mutations";
import { DropSetEditor } from "./drop-set-editor";
import { useUnits } from "@/contexts/units-context";
import { formatLoad } from "@/utils/unit-conversions";
import { commitNum } from "./commit-input";
import { LoadValueInput, loadOptions } from "./load-value-input";
import { formatRepsRange, parseRepsRange } from "@/utils/reps-range";
import {
  FOCUS_RING,
  MONO,
  MONO_INPUT_CLASS,
  TEXT_MUTED,
  TEXT_SECONDARY,
} from "./builder-tokens";

// One per-set prescription row. Column template is shared with the header row
// exercise-card renders above the set list. Numeric caps mirror setSpecSchema
// (reps ≤100, load ≤2000, RPE ≤10, per-set rest ≤3600 — NOT the exercise-level
// 600) so the client-side safeParse belt never trips on these fields.
// Fractional columns stretch the rows to the full card width (# and the
// duplicate/remove icon column stay fixed); minmax(0,…) lets narrow viewports
// squeeze instead of overflowing.
export const SET_GRID_BASE = "grid items-center gap-1.5";

// The header row and every set row derive their template from the same field
// set, so a hidden column cannot leave the two misaligned. Fractional columns
// stretch to the card width (# and the duplicate/remove column stay fixed);
// minmax(0,…) lets narrow viewports squeeze instead of overflowing.
export function setGridTemplate(
  fields: ReadonlySet<PrescribedField>,
): string {
  const columns = ["20px"];
  if (fields.has("set_type")) columns.push("minmax(0,1.1fr)");
  if (fields.has("reps")) columns.push("minmax(0,0.9fr)");
  if (fields.has("load")) columns.push("minmax(0,1.7fr)");
  if (fields.has("rpe")) columns.push("minmax(0,0.7fr)");
  if (fields.has("rest")) columns.push("minmax(0,0.8fr)");
  columns.push("48px");
  return columns.join(" ");
}

type SetRowEditorProps = {
  spec: SetSpec;
  /** Which prescription columns this exercise uses. */
  fields: ReadonlySet<PrescribedField>;
  index: number;
  disabled: boolean;
  onEdit: (edit: SetSpecEdit) => void;
};

export function SetRowEditor({ spec, fields, index, disabled, onEdit }: SetRowEditorProps) {
  const { preference } = useUnits();
  const loadUnit = formatLoad(0, preference).unit;
  const LOAD_OPTIONS = loadOptions(loadUnit);
  const openReps = spec.set_type === "amrap" || spec.set_type === "failure";
  // Working sets get the teal-wash pill (mockup `.type-pill.work`).
  const isWorking = spec.set_type === "working";
  const update = (patch: Partial<SetSpec>) =>
    onEdit({ kind: "update-set", index, patch });

  return (
    <div>
      <div
        className={SET_GRID_BASE}
        style={{ gridTemplateColumns: setGridTemplate(fields) }}
      >
        <span className={cn(MONO, "text-center text-[11px]", TEXT_MUTED)}>
          {spec.set_number}
        </span>

        {fields.has("set_type") && (
          <Select
            disabled={disabled}
            value={spec.set_type}
            onValueChange={(v) => update({ set_type: v as SetSpec["set_type"] })}
          >
            <SelectTrigger
              aria-label={`Set ${spec.set_number} type`}
              className={cn(
                "h-7 px-2 text-[11px]",
                FOCUS_RING,
                isWorking &&
                  "border-[rgba(13,148,136,0.2)] bg-[rgba(13,148,136,0.05)] font-medium text-[#0a5c55]",
              )}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SET_TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-xs">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {fields.has("reps") && (
          openReps ? (
            // An AMRAP or to-failure set prescribes no rep count — that is what
            // the type means, so the field states the instruction rather than
            // accepting one. Disabled rather than removed, so the column stays
            // aligned with every other row (the same shape the load value uses
            // when no load type is chosen). The client still records the reps
            // they achieved; only the PRESCRIPTION is closed here.
            <Input
              disabled
              readOnly
              value=""
              placeholder={spec.set_type === "amrap" ? "AMRAP" : "To failure"}
              aria-label={`Set ${spec.set_number} reps (not prescribed)`}
              className={cn(MONO_INPUT_CLASS, "h-7 px-1.5 text-[11px]", FOCUS_RING)}
            />
          ) : (
            // ONE input for the whole scheme ("8-12", or "12" when the range
            // collapses), matching how reps are written everywhere else in the
            // app. The stored model is unchanged — utils/reps-range parses on
            // input and formats on display, and a half-open legacy range still
            // round-trips.
            <Input
              disabled={disabled}
              maxLength={9}
              defaultValue={formatRepsRange({
                min: spec.reps_min ?? null,
                max: spec.reps_max ?? null,
              })}
              placeholder="reps"
              aria-label={`Set ${spec.set_number} reps`}
              className={cn(MONO_INPUT_CLASS, "h-7 px-1.5 text-[11px]", FOCUS_RING)}
              onFocus={(e) => {
                // Select-all so a prefilled scheme is typed over, not deleted.
                e.target.select();
              }}
              onBlur={(e) => {
                const seeded = formatRepsRange({
                  min: spec.reps_min ?? null,
                  max: spec.reps_max ?? null,
                });
                const typed = e.target.value.trim();
                // A blur that changed nothing must write nothing, or tabbing
                // through the row dirties the draft.
                if (typed === seeded) return;
                const parsed = parseRepsRange(typed);
                if (parsed === null) {
                  // Not a rep scheme — revert rather than blanking a
                  // prescription on a typo.
                  e.target.value = seeded;
                  return;
                }
                e.target.value = formatRepsRange(parsed);
                update({ reps_min: parsed.min, reps_max: parsed.max });
              }}
            />
          )
        )}

        {fields.has("load") && (
          <div className="flex items-center gap-1">
            <Select
              disabled={disabled}
              value={spec.load_type ?? "none"}
              onValueChange={(v) =>
                update(
                  v === "none"
                    ? { load_type: null, load_value: null }
                    : { load_type: v as NonNullable<SetSpec["load_type"]> },
                )
              }
            >
              <SelectTrigger
                aria-label={`Set ${spec.set_number} load type`}
                className={cn("h-7 min-w-0 flex-1 px-2 text-[11px]", FOCUS_RING)}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="text-xs">
                  —
                </SelectItem>
                {LOAD_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-xs">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <LoadValueInput
              loadType={spec.load_type}
              value={spec.load_value ?? null}
              disabled={disabled}
              ariaLabel={`Set ${spec.set_number} load`}
              className="w-16 shrink-0"
              onCommit={(load_value) => update({ load_value })}
            />
          </div>
        )}

        {fields.has("rpe") && (
          <Input
            type="number"
            min={0}
            max={10}
            step={0.5}
            disabled={disabled}
            defaultValue={spec.rpe_target ?? ""}
            placeholder="RPE"
            aria-label={`Set ${spec.set_number} RPE`}
            className={cn(MONO_INPUT_CLASS, "h-7 px-1 text-[11px]", FOCUS_RING)}
            onBlur={(e) => update({ rpe_target: commitNum(e, { min: 0, max: 10 }) })}
          />
        )}

        {fields.has("rest") && (
          <Input
            type="number"
            min={0}
            max={3600}
            disabled={disabled}
            defaultValue={spec.rest_seconds ?? ""}
            placeholder="rest"
            aria-label={`Set ${spec.set_number} rest seconds`}
            className={cn(MONO_INPUT_CLASS, "h-7 px-1 text-[11px]", FOCUS_RING)}
            onBlur={(e) => update({ rest_seconds: commitNum(e, { min: 0, max: 3600, int: true }) })}
          />
        )}

        {!disabled ? (
          <div className="flex items-center">
            <button
              type="button"
              aria-label={`Duplicate set ${spec.set_number}`}
              className={cn("rounded p-1 hover:bg-[rgba(13,148,136,0.08)]", TEXT_MUTED)}
              // add-set clones the row at afterIndex (drops included) and
              // renumbers — exact duplicate-below semantics.
              onClick={() => onEdit({ kind: "add-set", afterIndex: index })}
            >
              <Copy className="h-3 w-3" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              aria-label={`Remove set ${spec.set_number}`}
              className={cn("rounded p-1 hover:bg-[rgba(13,148,136,0.08)]", TEXT_MUTED)}
              onClick={() => onEdit({ kind: "remove-set", index })}
            >
              <X className="h-3 w-3" strokeWidth={1.5} />
            </button>
          </div>
        ) : (
          <span />
        )}
      </div>

      {spec.set_type === "drop" && (
        <div className={cn("text-[11px]", TEXT_SECONDARY)}>
          <DropSetEditor
            drops={spec.drops ?? []}
            loadType={spec.load_type}
            setIndex={index}
            disabled={disabled}
            onEdit={onEdit}
          />
        </div>
      )}
    </div>
  );
}
