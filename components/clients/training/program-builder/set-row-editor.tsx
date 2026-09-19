"use client";

import { Fragment } from "react";
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
import { SET_SPEC_MEASURES, specRange, type SetSpec } from "@/utils/exercise-set-specs";
import { PRESCRIBED_FIELD_LABELS, type PrescribedField } from "@/utils/prescribed-fields";
import { BUILDER_COLUMN_ORDER, orderColumns } from "@/utils/column-presets";
import { SET_TYPE_OPTIONS, type SetSpecEdit } from "./use-set-spec-mutations";
import { DropSetEditor } from "./drop-set-editor";
import { useUnits } from "@/contexts/units-context";
import { formatLoad } from "@/utils/unit-conversions";
import { commitNum, commitTempo } from "./commit-input";
import { LoadRangeInput, loadOptions } from "./load-value-input";
import { MeasureRangeInput } from "./measure-range-input";
import { formatRepsRange, parseRepsRange } from "@/utils/reps-range";
import {
  FOCUS_RING,
  MONO,
  MONO_INPUT_CLASS,
  TEXT_MUTED,
  TEXT_SECONDARY,
} from "./builder-tokens";

// One per-set prescription row: a cell for every column the exercise
// prescribes, in the builder's one column order (utils/column-presets.ts).
// Numeric caps mirror setSpecSchema (SET_SPEC_MEASURES; per-set rest ≤3600 —
// NOT the exercise-level 600) so the client-side safeParse belt never trips on
// these fields. Every numeric target is one value or a range, stored as a
// min/max pair: reps, RPE, RIR and the plain-number measures in the range
// grammar ("8-12", "7-8"), load in its type's unit, and a distance, duration,
// pace, split or zone in the entry grammar at each end, typed and read in the
// viewer's units ("400-800 m", "3:45-3:50 /km"). Tempo is one compound value.
export const SET_GRID_BASE = "grid items-center gap-1.5";

// Each column's track: a floor so a box can show what it holds ("1:52.3 /500m"
// needs more room than "8"), and a share of any spare width. When the columns
// don't fit the card, the grid scrolls sideways with the number cell pinned.
const COLUMN_WIDTHS: Record<PrescribedField, string> = {
  set_type: "minmax(88px,1.1fr)",
  reps: "minmax(56px,0.9fr)",
  load: "minmax(150px,1.7fr)",
  rpe: "minmax(48px,0.7fr)",
  rir: "minmax(48px,0.7fr)",
  tempo: "minmax(72px,0.9fr)",
  distance: "minmax(84px,1fr)",
  duration: "minmax(84px,1fr)",
  pace: "minmax(96px,1.1fr)",
  split: "minmax(104px,1.1fr)",
  calories: "minmax(64px,0.8fr)",
  cadence: "minmax(64px,0.8fr)",
  stroke_rate: "minmax(64px,0.8fr)",
  resistance: "minmax(64px,0.8fr)",
  heart_rate_zone: "minmax(60px,0.8fr)",
  heart_rate: "minmax(72px,0.9fr)",
  power: "minmax(64px,0.8fr)",
  ftp_percent: "minmax(64px,0.8fr)",
  rest: "minmax(56px,0.8fr)",
};

// The header row and every set row derive their template from the same field
// set, so a hidden column cannot leave the two misaligned. The number column
// fits "#" in 20px; rows that are a superset's or circuit's rounds are headed
// "Round", which renders 39px wide, so theirs is 44px — the width of the
// client tracker's number column. The last column holds the duplicate/remove
// icons, and the columns menu above them.
export function setGridTemplate(
  fields: ReadonlySet<PrescribedField>,
  rounds = false,
): string {
  const columns = [rounds ? "44px" : "20px"];
  for (const field of BUILDER_COLUMN_ORDER) {
    if (fields.has(field)) columns.push(COLUMN_WIDTHS[field]);
  }
  columns.push("48px");
  return columns.join(" ");
}

/** The header over each column of the set grid. */
export const COLUMN_HEADERS: Record<PrescribedField, string> = {
  ...PRESCRIBED_FIELD_LABELS,
  set_type: "Type",
  rest: "Rest s",
};

/**
 * The number cell stays put while the boxes scroll sideways: sticky against
 * the grid's scrolling wrapper, opaque so the boxes slide under it.
 */
export const PINNED_CELL_CLASS = "sticky left-0 z-[1] bg-white";

type SetRowEditorProps = {
  spec: SetSpec;
  /** Which prescription columns this exercise uses. */
  fields: ReadonlySet<PrescribedField>;
  index: number;
  disabled: boolean;
  /**
   * The row is one of a superset's or circuit's rounds: it takes the wider
   * number column the Round heading needs, and it has no duplicate or remove —
   * the number of rows is the group's to change.
   */
  isRound?: boolean;
  onEdit: (edit: SetSpecEdit) => void;
};

export function SetRowEditor({
  spec,
  fields,
  index,
  disabled,
  isRound = false,
  onEdit,
}: SetRowEditorProps) {
  const { preference } = useUnits();
  const loadUnit = formatLoad(0, preference).unit;
  const LOAD_OPTIONS = loadOptions(loadUnit);
  const openReps = spec.set_type === "failure";
  // Working sets get the teal-wash pill (mockup `.type-pill.work`).
  const isWorking = spec.set_type === "working";
  const update = (patch: Partial<SetSpec>) =>
    onEdit({ kind: "update-set", index, patch });

  const cell = (field: PrescribedField) => {
    switch (field) {
      case "set_type":
        return (
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
        );

      case "reps":
        return openReps ? (
          // A to-failure set prescribes no rep count — that is what
          // the type means, so the field states the instruction rather than
          // accepting one. Disabled rather than removed, so the column stays
          // aligned with every other row (the same shape the load value uses
          // when no load type is chosen). The client still records the reps
          // they achieved; only the PRESCRIPTION is closed here.
          <Input
            disabled
            readOnly
            value=""
            placeholder="To failure"
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
        );

      case "load":
        return (
          <div className="flex items-center gap-1">
            <Select
              disabled={disabled}
              value={spec.load_type ?? "none"}
              onValueChange={(v) =>
                update(
                  v === "none"
                    ? { load_type: null, load_min: null, load_max: null }
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
            <LoadRangeInput
              loadType={spec.load_type}
              min={spec.load_min ?? null}
              max={spec.load_max ?? null}
              disabled={disabled}
              ariaLabel={`Set ${spec.set_number} load`}
              className="w-20 shrink-0"
              onCommit={({ min, max }) => update({ load_min: min, load_max: max })}
            />
          </div>
        );

      case "tempo":
        return (
          <Input
            disabled={disabled}
            maxLength={11}
            defaultValue={spec.tempo ?? ""}
            placeholder="3-1-X-0"
            aria-label={`Set ${spec.set_number} tempo`}
            className={cn(MONO_INPUT_CLASS, "h-7 px-1 text-[11px]", FOCUS_RING)}
            onFocus={(e) => {
              e.target.select();
            }}
            onBlur={(e) => {
              const commit = commitTempo(e, spec.tempo);
              if (commit.changed) update({ tempo: commit.tempo });
            }}
          />
        );

      case "rest":
        return (
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
        );

      default: {
        // Every other column is a measure with a min/max pair on the spec
        // (SET_SPEC_MEASURES), edited through one box.
        const keys = SET_SPEC_MEASURES[field];
        const range = specRange(spec, field);
        return (
          <MeasureRangeInput
            measure={field}
            min={range.min}
            max={range.max}
            setNumber={spec.set_number}
            disabled={disabled}
            onCommit={({ min, max }) =>
              update({ [keys.min]: min, [keys.max]: max } as Partial<SetSpec>)
            }
          />
        );
      }
    }
  };

  return (
    <div>
      <div
        className={SET_GRID_BASE}
        style={{ gridTemplateColumns: setGridTemplate(fields, isRound) }}
      >
        <span className={cn(MONO, "text-center text-[11px]", TEXT_MUTED, PINNED_CELL_CLASS)}>
          {spec.set_number}
        </span>

        {orderColumns(fields).map((field) => (
          <Fragment key={field}>{cell(field)}</Fragment>
        ))}

        {!disabled && !isRound ? (
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
