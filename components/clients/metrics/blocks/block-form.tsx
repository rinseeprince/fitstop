"use client";

import { useEffect, useMemo } from "react";
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
  MONO_INPUT_CLASS,
  MONO_LABEL_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { useUnits } from "@/contexts/units-context";
import { useCanonicalInput } from "@/hooks/use-unit-inputs";
import { formatWeight } from "@/utils/unit-conversions";
import { addDaysToDateString, getTodayDateString } from "@/lib/date-helpers";
import {
  DAYS_PER_BLOCK_WEEK,
  inclusiveDays,
  weeksSpanned,
} from "@/lib/blocks/block-chain";
import type { ClientBlockView } from "@/lib/blocks/block-derivations";
import {
  BLOCK_FOCUS_MAX,
  BLOCK_NAME_MAX,
  BLOCK_WEEKS_MAX,
  WEIGHT_KG_MAX,
  WEIGHT_KG_MIN,
} from "@/lib/constants";
import { formatBlockDate, formatBlockLength } from "@/lib/blocks/block-format";

// One inline form for both adding and editing a block (the habits
// manage-drawer swap precedent for the SHELL only — its raw-useState
// internals predate the react-hook-form rule). Lengths are picked as an END
// DATE (day-granular, 3.6-B); the start is derived from the chain, so the
// coach never enters a date pair — except the chain's very first block while
// nothing is lived, where the anchor itself is theirs to move. Elapsed edits
// are fields-only: their dates render as fixed text. Target weight collects
// in the VIEWER's unit through useCanonicalInput and commits canonical kg;
// the RHF field holds the canonical number so zodResolver validates what
// will actually be stored (the add-client-manual-form pattern).

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const baseSchema = z.object({
  startsOn: z.string().regex(DATE_RE, "Pick a start date").optional(),
  name: z.string().trim().min(1, "Name the block").max(BLOCK_NAME_MAX),
  endsOn: z
    .string()
    .regex(DATE_RE, "Pick an end date")
    .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
      message: "Not a real calendar date",
    })
    .optional(),
  focus: z.string().trim().max(BLOCK_FOCUS_MAX).optional(),
  targetWeightKg: z
    .number()
    .min(WEIGHT_KG_MIN, "Too low")
    .max(WEIGHT_KG_MAX, "Too high")
    .optional(),
});

type SchemaOptions = {
  needsStartField: boolean;
  requiresEnd: boolean;
  fixedStart: string | null;
  /** The current block's end floor (the client's today) — the window floor
   *  expressed as validation instead of a server 422. */
  minEnd: string | null;
  /** The anchor's floor (the client's today) — the journey can't start in
   *  the past. Belt behind the input's `min`, which only greys the picker. */
  minStart: string | null;
};

// Cross-field checks live in the schema: a zodResolver replaces RHF
// field-level `validate`, and the end is judged against the DERIVED start.
function makeBlockSchema(opts: SchemaOptions) {
  return baseSchema.superRefine((data, ctx) => {
    if (opts.needsStartField && !data.startsOn) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startsOn"],
        message: "Pick a start date",
      });
    }
    if (
      opts.needsStartField &&
      data.startsOn &&
      opts.minStart &&
      data.startsOn < opts.minStart
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startsOn"],
        message: "Can't start in the past",
      });
    }
    if (!opts.requiresEnd) return;
    if (!data.endsOn || !DATE_RE.test(data.endsOn)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endsOn"],
        message: "Pick an end date",
      });
      return;
    }
    const nextStart =
      opts.fixedStart ??
      (data.startsOn && DATE_RE.test(data.startsOn) ? data.startsOn : null);
    if (!nextStart) return;
    const floor =
      opts.minEnd && opts.minEnd > nextStart ? opts.minEnd : nextStart;
    if (data.endsOn < floor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endsOn"],
        message:
          floor === opts.minEnd
            ? "The block in progress can't end before today"
            : "Ends before the block starts",
      });
    } else if (
      data.endsOn >
      addDaysToDateString(nextStart, BLOCK_WEEKS_MAX * DAYS_PER_BLOCK_WEEK - 1)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endsOn"],
        message: `At most ${BLOCK_WEEKS_MAX} weeks`,
      });
    }
  });
}

type SchemaValues = z.infer<typeof baseSchema>;

/** Normalized submission — the parent builds the PUT payload from these. */
export interface BlockFormValues {
  name: string;
  endsOn?: string;
  focus: string | null;
  targetWeightKg: number | null;
  startsOn?: string;
}

export type BlockFormMode =
  | { kind: "add"; appendAfterEndsOn: string | null }
  | {
      kind: "edit";
      block: ClientBlockView;
      /** True only for the chain's first block while nothing is lived. */
      startEditable: boolean;
      /** The client's today when editing the CURRENT block; null otherwise. */
      minEnd: string | null;
    };

type BlockFormProps = {
  mode: BlockFormMode;
  /** The client's today (their timezone, off the wire) — floors the Starts
   *  field whenever it renders. Null only while the wire hasn't answered. */
  minStart?: string | null;
  /** Sum of every OTHER block's weeks, for the live journey-total sentence. */
  otherBlocksWeeks: number;
  /** Edit-mode push-forward preview: the moved-blocks clause for an end. */
  shiftPreview?: (endsOn: string) => string | null;
  onSubmit: (values: BlockFormValues) => Promise<void>;
  onCancel: () => void;
};

const FIELD_LABEL = "text-[11px] text-[#5a7d82]";
const FIELD_INPUT = "bg-white";

export function BlockForm({
  mode,
  minStart = null,
  otherBlocksWeeks,
  shiftPreview,
  onSubmit,
  onCancel,
}: BlockFormProps) {
  const { preference } = useUnits();
  const weightUnit = formatWeight(0, preference).unit;

  const editing = mode.kind === "edit" ? mode.block : null;
  const isElapsedEdit = editing?.state === "past";
  const needsStartField =
    mode.kind === "add"
      ? mode.appendAfterEndsOn === null
      : mode.startEditable;
  const fixedStart = needsStartField
    ? null
    : mode.kind === "add"
      ? addDaysToDateString(mode.appendAfterEndsOn as string, 1)
      : (editing as ClientBlockView).startsOn;
  const minEnd = mode.kind === "edit" ? mode.minEnd : null;

  const weightInput = useCanonicalInput(
    preference,
    editing?.targetWeightKg ?? null,
    "weight"
  );

  const schema = useMemo(
    () =>
      makeBlockSchema({
        needsStartField,
        requiresEnd: !isElapsedEdit,
        fixedStart,
        minEnd,
        minStart,
      }),
    [needsStartField, isElapsedEdit, fixedStart, minEnd, minStart]
  );
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<SchemaValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      // Seed from the client's today (their tz), not the coach's device day.
      startsOn: needsStartField
        ? (editing?.startsOn ?? minStart ?? getTodayDateString())
        : undefined,
      name: editing?.name ?? "",
      // Adds seed a 4-week block so the live line reads immediately.
      endsOn: isElapsedEdit
        ? undefined
        : (editing?.endsOn ??
          addDaysToDateString(
            fixedStart ?? getTodayDateString(),
            4 * DAYS_PER_BLOCK_WEEK - 1
          )),
      focus: editing?.focus ?? "",
    },
  });

  // The RHF field holds the canonical kg the box currently means, so the
  // schema bounds validate storage, not the typed display string.
  useEffect(() => {
    setValue("targetWeightKg", weightInput.commit ?? undefined, {
      shouldValidate: !weightInput.isPristine,
    });
  }, [weightInput.commit, weightInput.isPristine, setValue]);

  const endsOnValue = watch("endsOn");
  const startsOnValue = watch("startsOn");
  const nextStart =
    fixedStart ??
    (startsOnValue && DATE_RE.test(startsOnValue) ? startsOnValue : null);
  const maxEnd = nextStart
    ? addDaysToDateString(nextStart, BLOCK_WEEKS_MAX * DAYS_PER_BLOCK_WEEK - 1)
    : undefined;
  const endValid =
    !isElapsedEdit &&
    nextStart != null &&
    endsOnValue != null &&
    DATE_RE.test(endsOnValue) &&
    endsOnValue >= (minEnd && minEnd > nextStart ? minEnd : nextStart) &&
    (maxEnd === undefined || endsOnValue <= maxEnd);
  const journeyTotal =
    otherBlocksWeeks +
    (isElapsedEdit
      ? editing.weeks
      : endValid && nextStart
        ? weeksSpanned(nextStart, endsOnValue)
        : 0);
  const shiftClause =
    endValid && shiftPreview && endsOnValue !== editing?.endsOn
      ? shiftPreview(endsOnValue)
      : null;

  const submit = handleSubmit(async (values) => {
    if (weightInput.hasParseError) return;
    await onSubmit({
      name: values.name.trim(),
      ...(isElapsedEdit ? {} : { endsOn: values.endsOn }),
      focus: values.focus?.trim() ? values.focus.trim() : null,
      targetWeightKg: values.targetWeightKg ?? null,
      ...(needsStartField ? { startsOn: values.startsOn } : {}),
    });
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

        {needsStartField && (
          <div className="space-y-1.5">
            <Label htmlFor="block-starts" className={FIELD_LABEL}>
              Starts
            </Label>
            <Input
              id="block-starts"
              type="date"
              min={minStart ?? undefined}
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

        {isElapsedEdit ? (
          <div className="space-y-1.5">
            <Label className={FIELD_LABEL}>Dates</Label>
            {/* A past block's window is history — fields edit, dates don't. */}
            <p className={cn(MONO_LABEL_CLASS, "normal-case tracking-normal pt-2.5")}>
              {formatBlockDate(editing.startsOn)} –{" "}
              {formatBlockDate(editing.endsOn)}
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="block-ends" className={FIELD_LABEL}>
              Ends
            </Label>
            <Input
              id="block-ends"
              type="date"
              min={minEnd && nextStart && minEnd > nextStart ? minEnd : nextStart ?? undefined}
              max={maxEnd}
              className={cn(FIELD_INPUT, MONO_INPUT_CLASS, "h-9 w-[150px] text-xs")}
              {...register("endsOn")}
            />
            {errors.endsOn && (
              <p className="text-[11px] text-[#c06060]">{errors.endsOn.message}</p>
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

      {nextStart && endValid && (
        // A sentence, therefore 100% sans — the prose rule.
        <p className="text-xs text-[#5a7d82]">
          Starts {formatBlockDate(nextStart)}, ends {formatBlockDate(endsOnValue)}{" "}
          — {formatBlockLength(inclusiveDays(nextStart, endsOnValue))}.
          {shiftClause ? ` ${shiftClause}` : ""} Journey becomes {journeyTotal}{" "}
          {journeyTotal === 1 ? "week" : "weeks"}.
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
          {mode.kind === "add" ? "Add block" : "Save block"}
        </Button>
      </div>
    </form>
  );
}
