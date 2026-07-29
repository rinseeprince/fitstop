"use client";

import { Trash2 } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { RowActions } from "@/components/programs/shared/row-actions";
import { formatDateOnlyShort } from "@/components/clients/overview/overview-format";
import {
  FOCUS_RING,
  MONO,
  MONO_INPUT_CLASS,
  MONO_LABEL_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import type { GoalPlanFormValues, WeightUnit } from "./goal-plan-model";

const FIELD = "h-8 text-[13px]";

type BlockRowProps = {
  index: number;
  form: UseFormReturn<GoalPlanFormValues>;
  unit: WeightUnit;
  /** Chained dates for this row, from the live preview. */
  startsOn: string;
  endsOn: string;
  /**
   * Elapsed rows are read-only in EVERY field, not just their dates.
   * `replaceClientPhases` excludes them from the write entirely, so a rename
   * would return 200 and be silently discarded.
   */
  elapsed: boolean;
  /** Persisted rows have no delete here — removing one re-chains the plan and
   * needs the Task 3.2 confirm. Only an unsaved row can be dropped outright. */
  onRemove?: () => void;
};

export function BlockRow({
  index,
  form,
  unit,
  startsOn,
  endsOn,
  elapsed,
  onRemove,
}: BlockRowProps) {
  const errors = form.formState.errors.blocks?.[index];
  const values = form.getValues(`blocks.${index}`);

  const dates = `${formatDateOnlyShort(startsOn)} – ${formatDateOnlyShort(endsOn)}`;

  if (elapsed) {
    return (
      <div className="grid grid-cols-[1fr_72px_96px_28px] items-center gap-2 rounded-[6px] bg-[rgba(0,0,0,0.02)] px-2 py-1.5">
        {/* A block name is user-authored, so its digits belong to the name — sans. */}
        <span className="truncate text-[13px] text-[#93b0b4]">{values.name}</span>
        <span className={cn(MONO, "text-[12px] text-[#93b0b4]")}>{values.weeks} wk</span>
        <span className={cn(MONO, "text-[12px] text-[#93b0b4]")}>
          {values.ratePerWeek} {unit}
        </span>
        <span />
        <span className={cn(MONO_LABEL_CLASS, "col-span-4 normal-case tracking-normal")}>
          {dates} · finished
        </span>
      </div>
    );
  }

  return (
    <div className="group/row rounded-[6px] px-2 py-1.5 hover:bg-[rgba(13,148,136,0.03)]">
      <div className="grid grid-cols-[1fr_72px_96px_28px] items-center gap-2">
        <Input
          aria-label={`Block ${index + 1} name`}
          placeholder="Cut 1"
          {...form.register(`blocks.${index}.name`)}
          className={cn(FOCUS_RING, FIELD)}
        />
        <Input
          aria-label={`Block ${index + 1} length in weeks`}
          type="number"
          step={1}
          min={1}
          inputMode="numeric"
          {...form.register(`blocks.${index}.weeks`)}
          className={cn(MONO_INPUT_CLASS, FOCUS_RING, FIELD)}
        />
        <Input
          aria-label={`Block ${index + 1} rate in ${unit} per week`}
          inputMode="decimal"
          placeholder="0"
          {...form.register(`blocks.${index}.ratePerWeek`)}
          className={cn(MONO_INPUT_CLASS, FOCUS_RING, FIELD)}
        />
        {onRemove ? (
          <RowActions
            actions={[
              { label: "Remove block", icon: Trash2, onClick: onRemove, danger: true },
            ]}
          />
        ) : (
          <span />
        )}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 px-1">
        <span className={cn(MONO_LABEL_CLASS, "normal-case tracking-normal")}>{dates}</span>
        {(errors?.name || errors?.weeks || errors?.ratePerWeek) && (
          <span className="text-[11px] text-[#c06060]">
            {errors.name?.message ?? errors.weeks?.message ?? errors.ratePerWeek?.message}
          </span>
        )}
      </div>
    </div>
  );
}
