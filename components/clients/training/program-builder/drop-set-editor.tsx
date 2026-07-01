"use client";

import { Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { SetSpec } from "@/utils/exercise-set-specs";
import type { SetSpecEdit } from "./use-set-spec-mutations";
import { FOCUS_RING, LABEL_CLASS, TEXT_MUTED } from "./builder-tokens";

// Sub-editor for a drop set's weight/reps pairs, rendered under a set row
// whose set_type === "drop". ≤20 drops (zod cap enforced in the kernel).
type DropSetEditorProps = {
  drops: NonNullable<SetSpec["drops"]>;
  setIndex: number;
  disabled: boolean;
  onEdit: (edit: SetSpecEdit) => void;
};

// Clamp at commit and write the result back so the uncontrolled input shows
// exactly what entered the draft (HTML min/max don't constrain typed values).
const commitNum = (
  e: React.FocusEvent<HTMLInputElement>,
  opts: { min: number; max: number },
): number | null => {
  const t = e.target.value.trim();
  let result: number | null = null;
  if (t) {
    const n = Number(t);
    if (Number.isFinite(n)) result = Math.min(opts.max, Math.max(opts.min, n));
  }
  e.target.value = result == null ? "" : String(result);
  return result;
};

export function DropSetEditor({ drops, setIndex, disabled, onEdit }: DropSetEditorProps) {
  return (
    <div className="ml-8 mt-1 space-y-1 border-l border-dashed border-[rgba(13,148,136,0.15)] pl-3">
      {drops.map((drop, dropIndex) => (
        <div
          key={`${setIndex}-${dropIndex}-${drops.length}`}
          className="flex items-center gap-1.5"
        >
          <span className={cn("w-10 text-[10px]", TEXT_MUTED)}>Drop {dropIndex + 1}</span>
          <Input
            type="number"
            min={0}
            max={2000}
            disabled={disabled}
            defaultValue={drop.weight ?? ""}
            placeholder="kg"
            aria-label={`Drop ${dropIndex + 1} weight`}
            className={cn("h-6 w-16 px-1 text-center font-mono text-[11px]", FOCUS_RING)}
            onBlur={(e) =>
              onEdit({
                kind: "update-drop",
                setIndex,
                dropIndex,
                patch: { weight: commitNum(e, { min: 0, max: 2000 }) },
              })
            }
          />
          <span className={cn("text-[10px]", TEXT_MUTED)}>×</span>
          <Input
            type="number"
            min={0}
            max={100}
            disabled={disabled}
            defaultValue={drop.reps ?? ""}
            placeholder="reps"
            aria-label={`Drop ${dropIndex + 1} reps`}
            className={cn("h-6 w-14 px-1 text-center font-mono text-[11px]", FOCUS_RING)}
            onBlur={(e) =>
              onEdit({
                kind: "update-drop",
                setIndex,
                dropIndex,
                patch: { reps: commitNum(e, { min: 0, max: 100 }) },
              })
            }
          />
          {!disabled && (
            <button
              type="button"
              aria-label={`Remove drop ${dropIndex + 1}`}
              className={cn("rounded p-0.5 hover:bg-[rgba(13,148,136,0.08)]", TEXT_MUTED)}
              onClick={() => onEdit({ kind: "remove-drop", setIndex, dropIndex })}
            >
              <X className="h-3 w-3" strokeWidth={1.5} />
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <button
          type="button"
          className={cn("flex items-center gap-1 py-0.5", LABEL_CLASS, "hover:text-[#0d9488]")}
          onClick={() => onEdit({ kind: "add-drop", setIndex })}
        >
          <Plus className="h-3 w-3" strokeWidth={1.5} /> Add drop
        </button>
      )}
    </div>
  );
}
