"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MONO_INPUT_CLASS } from "@/components/clients/training/program-builder/builder-tokens";
import { GOAL_DESCRIPTION_MAX, GOAL_NAME_MAX } from "@/lib/constants";
import { useUnits } from "@/contexts/units-context";
import { formatWeight } from "@/utils/unit-conversions";
import {
  GOAL_TYPE_SETTINGS,
  GOAL_TYPES,
  isGoalType,
  targetAgainstType,
} from "@/lib/goals/goal-types";
import type { GoalDraftErrors, GoalDraftState } from "./use-goal-draft";

/** The type select's "no goal" choice, on the Add-client form only. */
const NO_GOAL = "none";

const HINT_CLASS = "text-[11px] leading-[1.4] text-[#93b0b4]";
const ERROR_CLASS = "text-[11px] leading-[1.4] text-[#c06060]";
const WARNING_CLASS = "text-[11px] leading-[1.4] text-[#d97706]";

function Field({
  id,
  label,
  children,
  below,
  className,
}: {
  id: string;
  label: string;
  children: ReactNode;
  below?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {below}
    </div>
  );
}

/**
 * A goal's fields: the type, then what that type asks for — a target weight
 * to lose weight or build muscle, a target body fat for a recomp, nothing for
 * the others, and any target the goal already holds — the start day where the
 * form asks for one, the deadline (the event day for event prep), always
 * optional, and the description. A target pointing the other way from the
 * type — a loss above the client's weight, a gain below it, a recomp's body
 * fat above theirs — says so under its box; the save still goes through.
 */
export function GoalFields({
  draft,
  errors,
  readings,
  asksStart,
  startMin,
  deadlineMin,
  allowNoGoal = false,
  idPrefix,
  controlClassName,
}: {
  draft: GoalDraftState;
  errors: GoalDraftErrors;
  /** The client's current readings, kg and %, which the direction warning compares against. */
  readings: { weight: number | null; bodyFat: number | null };
  asksStart: boolean;
  /** The earliest start day: the client's today. */
  startMin: string;
  /** The earliest deadline. */
  deadlineMin: string;
  /** Offer "No goal" as the type — a client can be added without one. */
  allowNoGoal?: boolean;
  /** Distinguishes two forms' fields on one page. */
  idPrefix: string;
  /** The height every control takes, one per row (docs/newdesignsystem.md). */
  controlClassName?: string;
}) {
  const { preference } = useUnits();
  const unit = formatWeight(0, preference).unit;
  const type = draft.type;
  const id = (field: string) => `${idPrefix}-${field}`;

  const shownWeight = (kg: number) => `${formatWeight(kg, preference).value.toFixed(1)} ${unit}`;
  const typedBodyFat = draft.bodyFat.trim() === "" ? null : Number(draft.bodyFat);
  const weightAgainst = type
    ? targetAgainstType(type, "weight", draft.weight.canonical, readings.weight)
    : null;
  const bodyFatAgainst = type
    ? targetAgainstType(
        type,
        "bodyFat",
        typedBodyFat != null && Number.isFinite(typedBodyFat) ? typedBodyFat : null,
        readings.bodyFat
      )
    : null;

  const below = (error: string | undefined, warning: string | null) =>
    error ? (
      <span className={ERROR_CLASS}>{error}</span>
    ) : warning ? (
      <span className={WARNING_CLASS}>{warning}</span>
    ) : undefined;

  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
      <Field id={id("type")} label="Type" below={below(errors.type, null)}>
        <Select
          value={type ?? (allowNoGoal ? NO_GOAL : "")}
          onValueChange={(value) => draft.setType(isGoalType(value) ? value : null)}
        >
          <SelectTrigger id={id("type")} aria-label="Goal type" className={cn(controlClassName, "font-medium")}>
            <SelectValue placeholder="Choose a type" />
          </SelectTrigger>
          <SelectContent>
            {allowNoGoal && <SelectItem value={NO_GOAL}>No goal</SelectItem>}
            {GOAL_TYPES.map((goalType) => (
              <SelectItem key={goalType} value={goalType}>
                {GOAL_TYPE_SETTINGS[goalType].name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {type && (
        <Field id={id("name")} label="Name">
          <Input
            id={id("name")}
            maxLength={GOAL_NAME_MAX}
            value={draft.name}
            onChange={(event) => draft.setName(event.target.value)}
            className={controlClassName}
          />
        </Field>
      )}

      {type && draft.shown.weight && (
        <Field
          id={id("target-weight")}
          label={`Target weight (${unit})`}
          below={below(
            errors.targetWeight,
            weightAgainst && readings.weight != null
              ? `This target is ${weightAgainst} their current weight (${shownWeight(readings.weight)}).`
              : null
          )}
        >
          <Input
            id={id("target-weight")}
            inputMode="decimal"
            value={draft.weight.value}
            onChange={(event) => draft.weight.setValue(event.target.value)}
            className={cn(MONO_INPUT_CLASS, controlClassName)}
          />
        </Field>
      )}

      {type && draft.shown.bodyFat && (
        <Field
          id={id("target-body-fat")}
          label="Target body fat (%)"
          below={below(
            errors.targetBodyFatPercentage,
            bodyFatAgainst && readings.bodyFat != null
              ? `This target is ${bodyFatAgainst} their current body fat (${readings.bodyFat.toFixed(1)}%).`
              : null
          )}
        >
          <Input
            id={id("target-body-fat")}
            inputMode="decimal"
            value={draft.bodyFat}
            onChange={(event) => draft.setBodyFat(event.target.value)}
            className={cn(MONO_INPUT_CLASS, controlClassName)}
          />
        </Field>
      )}

      {type && asksStart && (
        <Field id={id("starts-on")} label="Starts" below={below(errors.startsOn, null)}>
          <Input
            id={id("starts-on")}
            type="date"
            min={startMin}
            value={draft.startsOn}
            onChange={(event) => draft.setStartsOn(event.target.value)}
            className={cn(MONO_INPUT_CLASS, controlClassName)}
          />
        </Field>
      )}

      {type && (
        <Field id={id("deadline")} label={GOAL_TYPE_SETTINGS[type].deadlineLabel}>
          <Input
            id={id("deadline")}
            type="date"
            min={deadlineMin}
            value={draft.deadline}
            onChange={(event) => draft.setDeadline(event.target.value)}
            className={cn(MONO_INPUT_CLASS, controlClassName)}
          />
        </Field>
      )}

      {type && (
        <Field
          id={id("description")}
          label="Description"
          className="sm:col-span-2"
          below={<span className={HINT_CLASS}>Your client sees this with their goal.</span>}
        >
          <Textarea
            id={id("description")}
            rows={2}
            maxLength={GOAL_DESCRIPTION_MAX}
            value={draft.description}
            onChange={(event) => draft.setDescription(event.target.value)}
            className="resize-none"
          />
        </Field>
      )}
    </div>
  );
}
