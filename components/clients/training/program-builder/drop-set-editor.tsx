"use client";

import { Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { SetSpec } from "@/utils/exercise-set-specs";
import type { SetSpecEdit } from "./use-set-spec-mutations";
import {
  FOCUS_RING,
  LABEL_CLASS,
  MONO,
  MONO_INPUT_CLASS,
  TEXT_MUTED,
} from "./builder-tokens";
import { useUnits } from "@/contexts/units-context";
import { formatLoad } from "@/utils/unit-conversions";
import { commitLoad, commitNum, displayLoad } from "./commit-input";

// Sub-editor for a drop set's weight/reps pairs, rendered under a set row
// whose set_type === "drop". ≤20 drops (zod cap enforced in the kernel).
type DropSetEditorProps = {
  drops: NonNullable<SetSpec["drops"]>;
  setIndex: number;
  disabled: boolean;
  onEdit: (edit: SetSpecEdit) => void;
};

export function DropSetEditor({ drops, setIndex, disabled, onEdit }: DropSetEditorProps) {
  const { preference } = useUnits();
  return (
    <div className="ml-8 mt-1 space-y-1 border-l border-dashed border-[rgba(13,148,136,0.15)] pl-3">
      {drops.map((drop, dropIndex) => (
        <div
          key={`${setIndex}-${dropIndex}-${drops.length}`}
          className="flex items-center gap-1.5"
        >
          <span className={cn(MONO, "w-10 text-[10px]", TEXT_MUTED)}>Drop {dropIndex + 1}</span>
          <Input
            type="number"
            min={0}
            max={2000}
            disabled={disabled}
            defaultValue={displayLoad(drop.weight, preference)}
            placeholder={formatLoad(0, preference).unit}
            aria-label={`Drop ${dropIndex + 1} weight`}
            className={cn(MONO_INPUT_CLASS, "h-6 w-16 px-1 text-[11px]", FOCUS_RING)}
            onBlur={(e) => {
              // Same guard as set-row-editor: a drop weight is a stored load, so
              // a blur that changed nothing must write nothing.
              const commit = commitLoad(e, drop.weight, preference, {
                min: 0,
                max: 2000,
              });
              if (!commit.changed) return;
              onEdit({
                kind: "update-drop",
                setIndex,
                dropIndex,
                patch: { weight: commit.valueKg },
              });
            }}
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
            className={cn(MONO_INPUT_CLASS, "h-6 w-14 px-1 text-[11px]", FOCUS_RING)}
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
