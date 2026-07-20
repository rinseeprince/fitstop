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
import { SET_TYPE_OPTIONS, type SetSpecEdit } from "./use-set-spec-mutations";
import { DropSetEditor } from "./drop-set-editor";
import { FOCUS_RING, TEXT_MUTED, TEXT_SECONDARY } from "./builder-tokens";

// One per-set prescription row. Column template is shared with the header row
// exercise-card renders above the set list. Numeric caps mirror setSpecSchema
// (reps ≤100, load ≤2000, RPE ≤10, per-set rest ≤3600 — NOT the exercise-level
// 600) so the client-side safeParse belt never trips on these fields.
// Fractional columns stretch the rows to the full card width (# and the
// duplicate/remove icon column stay fixed); minmax(0,…) lets narrow viewports
// squeeze instead of overflowing.
export const SET_GRID =
  "grid grid-cols-[20px_minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,1.7fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_48px] items-center gap-1.5";

type SetRowEditorProps = {
  spec: SetSpec;
  index: number;
  disabled: boolean;
  onEdit: (edit: SetSpecEdit) => void;
};

// Clamp typed values to the zod ceilings at commit time — HTML min/max only
// constrain the spinners, not the keyboard — and write the clamped value back
// so the uncontrolled input shows exactly what entered the draft.
const commitNum = (
  e: React.FocusEvent<HTMLInputElement>,
  opts: { min: number; max: number; int?: boolean },
): number | null => {
  const t = e.target.value.trim();
  let result: number | null = null;
  if (t) {
    const n = Number(t);
    if (Number.isFinite(n)) {
      const clamped = Math.min(opts.max, Math.max(opts.min, n));
      result = opts.int ? Math.round(clamped) : clamped;
    }
  }
  e.target.value = result == null ? "" : String(result);
  return result;
};

const LOAD_OPTIONS = [
  { value: "absolute", label: "kg", suffix: "kg" },
  { value: "pct_1rm", label: "% 1RM", suffix: "%" },
  { value: "pct_top", label: "% top set", suffix: "%" },
] as const;

export function SetRowEditor({ spec, index, disabled, onEdit }: SetRowEditorProps) {
  const openReps = spec.set_type === "amrap" || spec.set_type === "failure";
  // Working sets get the teal-wash pill (mockup `.type-pill.work`).
  const isWorking = spec.set_type === "working";
  const loadSuffix =
    LOAD_OPTIONS.find((o) => o.value === spec.load_type)?.suffix ?? "";
  const update = (patch: Partial<SetSpec>) =>
    onEdit({ kind: "update-set", index, patch });

  return (
    <div>
      <div className={SET_GRID}>
        <span className={cn("text-center font-mono-display text-[11px]", TEXT_MUTED)}>
          {spec.set_number}
        </span>

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

        {openReps ? (
          <Input
            disabled={disabled}
            maxLength={20}
            defaultValue={spec.reps_target ?? ""}
            placeholder={spec.set_type === "amrap" ? "AMRAP" : "To failure"}
            aria-label={`Set ${spec.set_number} rep target`}
            className={cn("h-7 px-1.5 text-center font-mono-display text-[11px]", FOCUS_RING)}
            onBlur={(e) => update({ reps_target: e.target.value.trim() || null })}
          />
        ) : (
          <div className="flex items-center gap-1">
            <Input
              type="number"
              min={0}
              max={100}
              disabled={disabled}
              defaultValue={spec.reps_min ?? ""}
              placeholder="min"
              aria-label={`Set ${spec.set_number} min reps`}
              className={cn("h-7 min-w-0 flex-1 px-1 text-center font-mono-display text-[11px]", FOCUS_RING)}
              onFocus={(e) => {
                // Select-all on focus so a prefilled value is typed over, not
                // deleted (programmatic focus just highlights, never wipes).
                e.target.select();
              }}
              onBlur={(e) => {
                const v = commitNum(e, { min: 0, max: 100, int: true });
                if (v === null) {
                  // Blank reverts to the current value (the prefill on a new
                  // exercise) instead of clearing — reps always keep a value.
                  e.target.value = spec.reps_min == null ? "" : String(spec.reps_min);
                  return;
                }
                update({ reps_min: v });
              }}
            />
            <span className={cn("text-[10px]", TEXT_MUTED)}>–</span>
            <Input
              type="number"
              min={0}
              max={100}
              disabled={disabled}
              defaultValue={spec.reps_max ?? ""}
              placeholder="max"
              aria-label={`Set ${spec.set_number} max reps`}
              className={cn("h-7 min-w-0 flex-1 px-1 text-center font-mono-display text-[11px]", FOCUS_RING)}
              onFocus={(e) => {
                e.target.select();
              }}
              onBlur={(e) => {
                const v = commitNum(e, { min: 0, max: 100, int: true });
                if (v === null) {
                  e.target.value = spec.reps_max == null ? "" : String(spec.reps_max);
                  return;
                }
                update({ reps_max: v });
              }}
            />
          </div>
        )}

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
          <Input
            type="number"
            min={0}
            max={2000}
            disabled={disabled || !spec.load_type}
            defaultValue={spec.load_value ?? ""}
            placeholder={loadSuffix}
            aria-label={`Set ${spec.set_number} load`}
            className={cn("h-7 w-16 shrink-0 px-1 text-center font-mono-display text-[11px]", FOCUS_RING)}
            onBlur={(e) => update({ load_value: commitNum(e, { min: 0, max: 2000 }) })}
          />
        </div>

        <Input
          type="number"
          min={0}
          max={10}
          step={0.5}
          disabled={disabled}
          defaultValue={spec.rpe_target ?? ""}
          placeholder="RPE"
          aria-label={`Set ${spec.set_number} RPE`}
          className={cn("h-7 px-1 text-center font-mono-display text-[11px]", FOCUS_RING)}
          onBlur={(e) => update({ rpe_target: commitNum(e, { min: 0, max: 10 }) })}
        />

        <Input
          type="number"
          min={0}
          max={3600}
          disabled={disabled}
          defaultValue={spec.rest_seconds ?? ""}
          placeholder="rest"
          aria-label={`Set ${spec.set_number} rest seconds`}
          className={cn("h-7 px-1 text-center font-mono-display text-[11px]", FOCUS_RING)}
          onBlur={(e) => update({ rest_seconds: commitNum(e, { min: 0, max: 3600, int: true }) })}
        />

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
            setIndex={index}
            disabled={disabled}
            onEdit={onEdit}
          />
        </div>
      )}
    </div>
  );
}
