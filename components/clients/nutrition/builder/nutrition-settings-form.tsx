"use client";

import type { DietType } from "@/types/check-in";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { PROTEIN_TARGETS } from "@/utils/nutrition-helpers";
import {
  FOCUS_RING,
  MONO,
  SECTION_LABEL_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { useUnits } from "@/contexts/units-context";
import { KG_PER_LB } from "@/utils/unit-conversions";
import { formatDateOnlyShort } from "@/components/clients/overview/overview-format";
import { BlockStartPicker } from "@/components/clients/metrics/blocks/block-start-picker";
import type { BlockStartOption } from "@/lib/blocks/block-start-options";

/**
 * FULLY CONTROLLED, deliberately. This form used to own a second copy of the
 * three settings in local state, seeded from an `initialSettings` prop that no
 * caller ever passed. The builder hook owns another copy, and the hook's is
 * what the generate request posts — so the two could disagree, and the form
 * could display one thing while the save sent another. One owner now.
 */
// No `client` prop: its only use was client.unitPreference for the protein
// picker's kg/lb labels, and a coach reads their own unit (useUnits()).
type NutritionSettingsFormProps = {
  /** Read-only, from the client profile. */
  tdee: number | null;
  proteinTargetGPerKg: number;
  dietType: DietType;
  onSettingsChange: (settings: {
    proteinTargetGPerKg: number;
    dietType: DietType;
  }) => void;
  /** The Block field: the dash (no block), then the client's blocks whose end
   *  is on or after the client's today, each with its range; and the selected
   *  one. Empty until the resolved inputs have loaded. */
  blockOptions: readonly BlockStartOption[];
  blockValue: string;
  onBlockChange: (value: string) => void;
  /** True while a block is chosen: the start is fixed on the block's first
   *  available day and the date field is disabled. */
  blockSelected: boolean;
  /** The day the plan takes effect — a chosen block's first available day,
   *  else the coach's pick, else the client's today. Null until the resolved
   *  inputs have loaded. */
  effectiveFrom: string | null;
  /** The client's today: on the client's calendar, the same day the server's
   *  past-date belt judges — and the field's floor, the earliest day targets
   *  may start, whatever the client has logged (owner, 2026-09-11). */
  clientToday: string | null;
  /** The earliest queued version's start (the GET's `scheduledFor`). A pick
   *  BEFORE it runs until the day before it; a pick ON it replaces it
   *  (migration 166) — one sentence says which, then the save does what was
   *  asked: inform, never block. */
  queuedChangeDate: string | null;
  onEffectiveFromChange: (date: string) => void;
};

const selectTriggerClass =
  "font-medium [&>svg]:hover:text-[#0d9488]";

const selectItemClass =
  "rounded-[6px] cursor-pointer text-[13px] text-[#0c1a1e] focus:bg-[rgba(13,148,136,0.05)]";

export function NutritionSettingsForm({
  tdee,
  proteinTargetGPerKg,
  dietType,
  onSettingsChange,
  blockOptions,
  blockValue,
  onBlockChange,
  blockSelected,
  effectiveFrom,
  clientToday,
  queuedChangeDate,
  onEffectiveFromChange,
}: NutritionSettingsFormProps) {
  // The COACH's own unit, not the client's. A protein multiplier is expressed
  // per unit of BODY WEIGHT, so it flips with whoever is reading the form.
  const { preference } = useUnits();
  const perUnit = preference === "metric" ? "kg" : "lb";
  // Derived, never hand-tabulated: PROTEIN_TARGETS used to carry rounded gPerLb
  // values (1.6 -> 0.73) computed with the old 2.205 constant.
  const gPer = (gPerKg: number) =>
    (preference === "metric" ? gPerKg : gPerKg * KG_PER_LB).toFixed(
      preference === "metric" ? 1 : 2,
    );

  const handleChange = (field: string, value: number | DietType | string) => {
    onSettingsChange({
      proteinTargetGPerKg:
        field === "proteinTargetGPerKg"
          ? (value as number)
          : proteinTargetGPerKg,
      dietType: field === "dietType" ? (value as DietType) : dietType,
    });
  };

  return (
    <div className="space-y-4">
      {/* Read-only. Activity level is a CLIENT fact set on the client profile
          (Overview -> Client settings); a dropdown here gave it two homes that
          disagreed. This shows the number and nothing else on purpose: naming
          the activity level is WRONG whenever the coach has set a custom TDEE,
          and a "this plan was built at N" line needs plan state this form does
          not have. Both were tried and removed. */}
      <div className="space-y-1.5">
        <label className={SECTION_LABEL_CLASS}>TDEE</label>
        <div className="rounded-[6px] border border-[rgba(13,148,136,0.08)] bg-[rgba(13,148,136,0.03)] px-3 py-2">
          <p className="text-[13px] font-medium text-[#0c1a1e]">
            <span className={MONO}>
              {tdee != null ? tdee.toLocaleString("en-US") : "—"}
            </span>{" "}
            cal/day
          </p>
        </div>
      </div>

      {/* Protein Target */}
      <div className="space-y-1.5">
        <label className={SECTION_LABEL_CLASS}>
          Protein Target
        </label>
        <Select
          value={proteinTargetGPerKg.toString()}
          onValueChange={(value) =>
            handleChange("proteinTargetGPerKg", parseFloat(value))
          }
        >
          <SelectTrigger id="protein-target" className={selectTriggerClass}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={PROTEIN_TARGETS.minimum.gPerKg.toString()} className={selectItemClass}>
              {`${gPer(PROTEIN_TARGETS.minimum.gPerKg)}g per ${perUnit} - Minimum`}
            </SelectItem>
            <SelectItem value={PROTEIN_TARGETS.moderate.gPerKg.toString()} className={selectItemClass}>
              {`${gPer(PROTEIN_TARGETS.moderate.gPerKg)}g per ${perUnit} - Moderate`}
            </SelectItem>
            <SelectItem value={PROTEIN_TARGETS.high.gPerKg.toString()} className={selectItemClass}>
              {`${gPer(PROTEIN_TARGETS.high.gPerKg)}g per ${perUnit} - High`}
            </SelectItem>
            <SelectItem value={PROTEIN_TARGETS.veryHigh.gPerKg.toString()} className={selectItemClass}>
              {`${gPer(PROTEIN_TARGETS.veryHigh.gPerKg)}g per ${perUnit} - Very High`}
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[11px] text-[#93b0b4] leading-[1.4]">
          Protein per {perUnit} of body weight
        </p>
      </div>

      {/* Diet Type */}
      <div className="space-y-1.5">
        <label className={SECTION_LABEL_CLASS}>
          Diet Type
        </label>
        <Select
          value={dietType}
          onValueChange={(value) => handleChange("dietType", value as DietType)}
        >
          <SelectTrigger id="diet-type" className={selectTriggerClass}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="balanced" className={selectItemClass}>Balanced (50/50 carbs/fat)</SelectItem>
            <SelectItem value="high_carb" className={selectItemClass}>
              High Carb (65/35 carbs/fat)
            </SelectItem>
            <SelectItem value="low_carb" className={selectItemClass}>Low Carb (25/75 carbs/fat)</SelectItem>
            <SelectItem value="keto" className={selectItemClass}>Keto (10/90 carbs/fat)</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[11px] text-[#93b0b4] leading-[1.4]">
          Carb/fat split for remaining calories after protein
        </p>
      </div>

      {/* Block. A chosen block fixes the start on its first available day and
          greys the date field under it; the dash hands the date back to the
          coach. The save resolves its own window from the block covering the
          start; this only starts the version where the block the coach means
          begins. */}
      <div className="space-y-1.5">
        <label htmlFor="start-block" className={SECTION_LABEL_CLASS}>
          Block
        </label>
        <BlockStartPicker
          id="start-block"
          options={blockOptions}
          value={blockValue}
          onValueChange={onBlockChange}
          triggerClassName={selectTriggerClass}
          itemClassName={selectItemClass}
        />
      </div>

      {/* Starts on. The window the deficit is spread over begins here, in the
          preview and in the save alike (docs/MEASUREMENT-LOG-PLAN.md commit
          8bb). Fixed and disabled while a block is chosen; the coach's own with
          the dash, floored at the client's today — the server refuses a past
          start, and nothing else bounds it: a today the client has already
          logged is the coach's to replace, and the save re-records their log. */}
      <div className="space-y-1.5">
        <label htmlFor="starts-on" className={SECTION_LABEL_CLASS}>
          Starts on
        </label>
        <Input
          id="starts-on"
          type="date"
          value={effectiveFrom ?? ""}
          min={clientToday ?? undefined}
          disabled={blockSelected}
          onChange={(e) => onEffectiveFromChange(e.target.value)}
          className={cn(MONO, FOCUS_RING, "h-10 bg-white")}
        />
        {queuedChangeDate && effectiveFrom && effectiveFrom < queuedChangeDate && (
          <p className="text-[11px] leading-[1.4] text-[#5a7d82]">
            Targets are already queued for {formatDateOnlyShort(queuedChangeDate)}. These run
            until the day before.
          </p>
        )}
        {queuedChangeDate && effectiveFrom && effectiveFrom === queuedChangeDate && (
          <p className="text-[11px] leading-[1.4] text-[#b45309]">
            This replaces the targets queued for {formatDateOnlyShort(queuedChangeDate)}.
          </p>
        )}
        <p className="text-[11px] text-[#93b0b4] leading-[1.4]">
          Targets take effect from this day, and the deficit is spread from it to the deadline.
        </p>
      </div>
    </div>
  );
}
