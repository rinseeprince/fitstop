"use client";

import { useMemo } from "react";
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
import { addDaysToDateString, getTodayDateString } from "@/lib/date-helpers";
import { DAYS_PER_BLOCK_WEEK } from "@/lib/blocks/block-chain";
import type { ClientBlockView } from "@/lib/blocks/block-derivations";
import {
  BLOCK_EXTENSION_REFUSED,
  BLOCK_FOCUS_MAX,
  BLOCK_NAME_MAX,
  BLOCK_WEEKS_MAX,
} from "@/lib/constants";
import { formatBlockDate } from "@/lib/blocks/block-format";

// One inline form for both adding and editing a block (the habits
// manage-drawer swap precedent for the SHELL only — its raw-useState
// internals predate the react-hook-form rule). Both dates are the coach's;
// a stored block's end can move earlier but never later (the Ends field's
// max); elapsed edits are fields-only, their dates rendered as fixed text.
//
// No live summary sentence: the two date fields already say when the block
// starts and ends, and a journey total is the rail's job, not the form's.

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
});

type SchemaOptions = {
  needsStartField: boolean;
  requiresEnd: boolean;
  fixedStart: string | null;
  /** The current block's end floor (the client's today) — the window floor
   *  expressed as validation instead of a server 422. */
  minEnd: string | null;
  /** The start floor (the client's today) — a new block can't open in the
   *  past, because a past-dated block generates nothing. Belt behind the
   *  input's `min`, which only greys the picker. */
  minStart: string | null;
  /** A stored block's end — the ceiling on the Ends field, because a block is
   *  never extended: its end moves earlier or not at all, and more time is a
   *  new block after it. Belt behind the input's `max`, which only greys the
   *  picker. Null on an add. */
  maxEnd: string | null;
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
    } else if (opts.maxEnd && data.endsOn > opts.maxEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endsOn"],
        message: BLOCK_EXTENSION_REFUSED,
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
  startsOn?: string;
}

type BlockFormMode =
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
  onSubmit: (values: BlockFormValues) => Promise<void>;
  onCancel: () => void;
};

const FIELD_LABEL = "text-[11px] text-[#5a7d82]";
const FIELD_INPUT = "bg-white";

export function BlockForm({
  mode,
  minStart = null,
  onSubmit,
  onCancel,
}: BlockFormProps) {
  const editing = mode.kind === "edit" ? mode.block : null;
  const isElapsedEdit = editing?.state === "past";
  // A block owns its own window (migration 164), so the coach picks its start
  // every time they can: always on an add, and on an edit while the block has
  // not begun. A block already under way keeps its start — moving it would
  // re-label days the client has lived — and an elapsed one is pinned history.
  const needsStartField = mode.kind === "add" || mode.startEditable;
  const fixedStart = needsStartField ? null : (editing as ClientBlockView).startsOn;
  const minEnd = mode.kind === "edit" ? mode.minEnd : null;
  // A block is never extended: a stored current or future block's end is the
  // ceiling on its Ends field. More time is a new block after it.
  const storedEnd = editing && !isElapsedEdit ? editing.endsOn : null;

  const schema = useMemo(
    () =>
      makeBlockSchema({
        needsStartField,
        requiresEnd: !isElapsedEdit,
        fixedStart,
        minEnd,
        minStart,
        maxEnd: storedEnd,
      }),
    [needsStartField, isElapsedEdit, fixedStart, minEnd, minStart, storedEnd]
  );
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<SchemaValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      // Seed from the client's today (their tz), not the coach's device day.
      // Seeded, not derived: an add defaults to the day after the block before
      // it so the common "next block follows this one" is still one click, and
      // the coach can move it anywhere from there — including leaving a gap.
      startsOn: needsStartField
        ? (editing?.startsOn ??
          (mode.kind === "add" && mode.appendAfterEndsOn
            ? addDaysToDateString(mode.appendAfterEndsOn, 1)
            : null) ??
          minStart ??
          getTodayDateString())
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

  const startsOnValue = watch("startsOn");
  const nextStart =
    fixedStart ??
    (startsOnValue && DATE_RE.test(startsOnValue) ? startsOnValue : null);
  const maxEnd =
    storedEnd ??
    (nextStart
      ? addDaysToDateString(nextStart, BLOCK_WEEKS_MAX * DAYS_PER_BLOCK_WEEK - 1)
      : undefined);
  const submit = handleSubmit(async (values) => {
    await onSubmit({
      name: values.name.trim(),
      ...(isElapsedEdit ? {} : { endsOn: values.endsOn }),
      focus: values.focus?.trim() ? values.focus.trim() : null,
      ...(needsStartField ? { startsOn: values.startsOn } : {}),
    });
  });

  // noValidate: without it the browser runs its own constraint validation on
  // the bounded date inputs before React Hook Form gets control, and its bubble
  // stands in for the zod belts' sentences under the fields.
  return (
    <form
      noValidate
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
            {errors.endsOn ? (
              <p className="text-[11px] text-[#c06060]">{errors.endsOn.message}</p>
            ) : storedEnd ? (
              // The greyed days past the stored end need a reason (the floor
              // line's pattern): a block is never extended.
              <p className="text-[11px] leading-[1.4] text-[#5a7d82]">
                {BLOCK_EXTENSION_REFUSED}
              </p>
            ) : null}
          </div>
        )}
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

      <div className="flex items-center justify-end gap-2">
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
