"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  FOCUS_RING,
  MONO_INPUT_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { useUnits } from "@/contexts/units-context";
import { useCanonicalInput } from "@/hooks/use-unit-inputs";
import { formatWeight } from "@/utils/unit-conversions";
import { addDaysToDateString, getTodayDateString } from "@/lib/date-helpers";
import { DAYS_PER_BLOCK_WEEK } from "@/lib/blocks/block-chain";
import {
  BLOCK_FOCUS_MAX,
  BLOCK_NAME_MAX,
  BLOCK_WEEKS_MAX,
  WEIGHT_KG_MAX,
  WEIGHT_KG_MIN,
} from "@/lib/constants";
import { formatBlockDate } from "./block-format";
import type { NewBlockEntry } from "./block-chain-payload";

// Inline add-a-block form (the habits manage-drawer swap precedent for the
// SHELL only — its raw-useState internals predate the react-hook-form rule).
// Target weight collects in the VIEWER's unit through useCanonicalInput and
// commits canonical kg; the RHF field holds the canonical number so
// zodResolver validates what will actually be stored (the
// add-client-manual-form pattern).

const addBlockSchema = z.object({
  startsOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date")
    .optional(),
  name: z.string().trim().min(1, "Name the block").max(BLOCK_NAME_MAX),
  weeks: z
    .number({ invalid_type_error: "How many weeks?" })
    .int("Whole weeks only")
    .min(1, "At least 1 week")
    .max(BLOCK_WEEKS_MAX, `At most ${BLOCK_WEEKS_MAX} weeks`),
  focus: z.string().trim().max(BLOCK_FOCUS_MAX).optional(),
  targetWeightKg: z
    .number()
    .min(WEIGHT_KG_MIN, "Too low")
    .max(WEIGHT_KG_MAX, "Too high")
    .optional(),
});

type AddBlockFormValues = z.infer<typeof addBlockSchema>;

type AddBlockFormProps = {
  /** The last stored block's endsOn; null = empty chain (show a start-date
   *  field — the coach anchors the journey). */
  appendAfterEndsOn: string | null;
  /** Sum of the stored chain's weeks, for the live journey-total sentence. */
  journeyWeeksSoFar: number;
  onAdd: (entry: NewBlockEntry, firstStartsOn?: string) => Promise<void>;
  onCancel: () => void;
};

const FIELD_LABEL = "text-[11px] text-[#5a7d82]";
const FIELD_INPUT = cn(
  "bg-white border-[rgba(13,148,136,0.08)] text-[13px]",
  FOCUS_RING
);

export function AddBlockForm({
  appendAfterEndsOn,
  journeyWeeksSoFar,
  onAdd,
  onCancel,
}: AddBlockFormProps) {
  const { preference } = useUnits();
  const weightUnit = formatWeight(0, preference).unit;
  const weightInput = useCanonicalInput(preference, null, "weight");

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<AddBlockFormValues>({
    resolver: zodResolver(addBlockSchema),
    defaultValues: {
      startsOn: appendAfterEndsOn ? undefined : getTodayDateString(),
      name: "",
      focus: "",
    },
  });

  // The RHF field holds the canonical kg the box currently means, so the
  // schema bounds validate storage, not the typed display string.
  useEffect(() => {
    setValue("targetWeightKg", weightInput.commit ?? undefined, {
      shouldValidate: !weightInput.isPristine,
    });
  }, [weightInput.commit, weightInput.isPristine, setValue]);

  const weeksValue = watch("weeks");
  const startsOnValue = watch("startsOn");
  const nextStart = appendAfterEndsOn
    ? addDaysToDateString(appendAfterEndsOn, 1)
    : startsOnValue && /^\d{4}-\d{2}-\d{2}$/.test(startsOnValue)
      ? startsOnValue
      : null;
  const weeksValid =
    Number.isInteger(weeksValue) && weeksValue >= 1 && weeksValue <= BLOCK_WEEKS_MAX;
  const endsOn =
    nextStart && weeksValid
      ? addDaysToDateString(nextStart, weeksValue * DAYS_PER_BLOCK_WEEK - 1)
      : null;
  const journeyTotal = journeyWeeksSoFar + (weeksValid ? weeksValue : 0);

  const submit = handleSubmit(async (values) => {
    if (weightInput.hasParseError) return;
    await onAdd(
      {
        name: values.name.trim(),
        weeks: values.weeks,
        focus: values.focus?.trim() ? values.focus.trim() : null,
        targetWeightKg: values.targetWeightKg ?? null,
      },
      appendAfterEndsOn ? undefined : values.startsOn
    );
  });

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="space-y-3 rounded-[6px] border border-[rgba(13,148,136,0.08)] bg-[#f4f7f6] p-4"
    >
      <div className="flex flex-wrap gap-3">
        <div className="min-w-[180px] flex-1 space-y-1.5">
          <Label htmlFor="block-name" className={FIELD_LABEL}>
            Name
          </Label>
          <Input
            id="block-name"
            placeholder="e.g. Cut 2"
            className={FIELD_INPUT}
            {...register("name")}
          />
          {errors.name && (
            <p className="text-[11px] text-[#c06060]">{errors.name.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="block-weeks" className={FIELD_LABEL}>
            Weeks
          </Label>
          <Input
            id="block-weeks"
            type="number"
            min={1}
            max={BLOCK_WEEKS_MAX}
            className={cn(FIELD_INPUT, MONO_INPUT_CLASS, "h-9 w-20 text-xs")}
            {...register("weeks", { valueAsNumber: true })}
          />
          {errors.weeks && (
            <p className="text-[11px] text-[#c06060]">{errors.weeks.message}</p>
          )}
        </div>

        {!appendAfterEndsOn && (
          <div className="space-y-1.5">
            <Label htmlFor="block-starts" className={FIELD_LABEL}>
              Starts
            </Label>
            <Input
              id="block-starts"
              type="date"
              className={cn(FIELD_INPUT, MONO_INPUT_CLASS, "h-9 w-[150px] text-xs")}
              {...register("startsOn")}
            />
            {errors.startsOn && (
              <p className="text-[11px] text-[#c06060]">
                {errors.startsOn.message}
              </p>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="block-target" className={FIELD_LABEL}>
            Target weight (optional)
          </Label>
          <div className="flex items-center gap-1.5">
            <Input
              id="block-target"
              inputMode="decimal"
              className={cn(FIELD_INPUT, MONO_INPUT_CLASS, "h-9 w-24 text-xs")}
              value={weightInput.value}
              onChange={(event) => weightInput.setValue(event.target.value)}
            />
            <span className="text-[11px] text-[#93b0b4]">{weightUnit}</span>
          </div>
          {weightInput.hasParseError ? (
            <p className="text-[11px] text-[#c06060]">
              Enter a number in {weightUnit}
            </p>
          ) : errors.targetWeightKg ? (
            <p className="text-[11px] text-[#c06060]">
              {errors.targetWeightKg.message}
            </p>
          ) : null}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="block-focus" className={FIELD_LABEL}>
          Focus (optional)
        </Label>
        <Textarea
          id="block-focus"
          placeholder="What's this block for?"
          rows={2}
          className={cn(FIELD_INPUT, "resize-none")}
          {...register("focus")}
        />
        {errors.focus && (
          <p className="text-[11px] text-[#c06060]">{errors.focus.message}</p>
        )}
      </div>

      {nextStart && endsOn && (
        // A sentence, therefore 100% sans — the prose rule.
        <p className="text-xs text-[#5a7d82]">
          Starts {formatBlockDate(nextStart)}, ends {formatBlockDate(endsOn)}.
          Journey becomes {journeyTotal} {journeyTotal === 1 ? "week" : "weeks"}.
        </p>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={isSubmitting}
          className="bg-[#0d9488] text-white hover:bg-[#0b7f75]"
        >
          {isSubmitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          Add block
        </Button>
      </div>
    </form>
  );
}
