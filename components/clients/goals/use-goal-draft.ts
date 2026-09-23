"use client";

import { useState } from "react";
import { useCanonicalInput } from "@/hooks/use-unit-inputs";
import { formatWeight, type UnitSystem } from "@/utils/unit-conversions";
import {
  GOAL_BODY_FAT_MAX,
  GOAL_BODY_FAT_MIN,
  WEIGHT_KG_MAX,
  WEIGHT_KG_MIN,
} from "@/lib/constants";
import { GOAL_TYPE_SETTINGS, type GoalType } from "@/lib/goals/goal-types";
import { goalFormTargets, type GoalDraft } from "@/lib/goals/goal-form";
import type { GoalOnDay } from "@/types/client-goals";

/**
 * A goal form's fields, shared by the goals sheet and the manual Add client:
 * the type, the name — the type's own until the coach types another — the
 * targets the form shows (`goalFormTargets`), the start day, the deadline and
 * the description. The weight target is collected in the coach's unit and
 * kept canonical by `useCanonicalInput`, so an untouched box resubmits exactly
 * what was stored (CONVENTIONS §20).
 */

export type GoalDraftField = "type" | "targetWeight" | "targetBodyFatPercentage" | "startsOn";
export type GoalDraftErrors = Partial<Record<GoalDraftField, string>>;

export type GoalDraftState = ReturnType<typeof useGoalDraft>;

export function useGoalDraft({
  preference,
  stored,
}: {
  preference: UnitSystem;
  /** The goal being edited, as it stands today; null for a new one. */
  stored: GoalOnDay | null;
}) {
  const [type, setTypeValue] = useState<GoalType | null>(stored?.type ?? null);
  const [name, setName] = useState(stored?.name ?? "");
  const [bodyFat, setBodyFat] = useState(
    stored?.targetBodyFatPercentage != null ? String(stored.targetBodyFatPercentage) : ""
  );
  const [startsOn, setStartsOn] = useState(stored?.startsOn ?? "");
  const [deadline, setDeadline] = useState(stored?.deadline ?? "");
  const [description, setDescription] = useState(stored?.description ?? "");
  const weight = useCanonicalInput(preference, stored?.targetWeight ?? null, "weight");

  const shown = goalFormTargets(type, stored);

  /** A new type carries its name along while the name is still the old type's, or blank. */
  const setType = (next: GoalType | null) => {
    const followsType = name.trim() === "" || (type !== null && name === GOAL_TYPE_SETTINGS[type].name);
    setTypeValue(next);
    if (followsType) setName(next ? GOAL_TYPE_SETTINGS[next].name : "");
  };

  /** The targets as the boxes read them: canonical, a hidden or blank box none. */
  const typedBodyFat = bodyFat.trim() === "" ? null : Number(bodyFat.trim());
  const targets = {
    targetWeight: shown.weight ? weight.commit : null,
    targetBodyFatPercentage: shown.bodyFat ? typedBodyFat : null,
  };

  /**
   * The draft to save, or what stops it: no type; a target the type needs
   * left blank; a target that does not read or is out of bounds; a start day
   * the form asks for left blank. `checksTargets` is off for a save that
   * writes no target — a started goal's deadline or labels — so a target it
   * holds as it was, blank or out of today's bounds, never blocks one.
   */
  const toDraft = ({
    asksStart,
    checksTargets = true,
  }: {
    asksStart: boolean;
    checksTargets?: boolean;
  }):
    | { draft: GoalDraft; errors?: undefined }
    | { draft?: undefined; errors: GoalDraftErrors } => {
    const errors: GoalDraftErrors = {};
    if (!type) return { errors: { type: "Choose a type" } };
    const needed = GOAL_TYPE_SETTINGS[type].target;

    const { targetWeight, targetBodyFatPercentage } = targets;
    if (checksTargets && shown.weight) {
      if (weight.hasParseError) errors.targetWeight = "Enter a weight";
      else if (targetWeight == null && needed === "weight") errors.targetWeight = "Enter a target weight";
      else if (targetWeight != null && (targetWeight < WEIGHT_KG_MIN || targetWeight > WEIGHT_KG_MAX)) {
        const min = Math.ceil(formatWeight(WEIGHT_KG_MIN, preference).value);
        const max = Math.floor(formatWeight(WEIGHT_KG_MAX, preference).value);
        errors.targetWeight = `Enter a weight between ${min} and ${max} ${formatWeight(0, preference).unit}`;
      }
    }

    if (checksTargets && shown.bodyFat) {
      if (targetBodyFatPercentage == null) {
        if (needed === "bodyFat") errors.targetBodyFatPercentage = "Enter a target body fat";
      } else if (
        !Number.isFinite(targetBodyFatPercentage) ||
        targetBodyFatPercentage < GOAL_BODY_FAT_MIN ||
        targetBodyFatPercentage > GOAL_BODY_FAT_MAX
      ) {
        errors.targetBodyFatPercentage = `Body fat must be between ${GOAL_BODY_FAT_MIN}% and ${GOAL_BODY_FAT_MAX}%`;
      }
    }

    if (asksStart && startsOn === "") errors.startsOn = "Choose a start day";

    if (Object.keys(errors).length > 0) return { errors };
    return {
      draft: {
        type,
        name,
        targetWeight,
        targetBodyFatPercentage,
        description,
        startsOn: asksStart ? startsOn : null,
        deadline: deadline === "" ? null : deadline,
      },
    };
  };

  return {
    type,
    setType,
    name,
    setName,
    weight,
    bodyFat,
    setBodyFat,
    startsOn,
    setStartsOn,
    deadline,
    setDeadline,
    description,
    setDescription,
    shown,
    targets,
    toDraft,
  };
}
