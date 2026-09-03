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
  /** The day the plan takes effect — the coach's pick, else the client's
   *  today. Null until the resolved inputs have loaded. */
  effectiveFrom: string | null;
  /** The client's today, the field's floor: on the client's calendar, the
   *  same day the server's past-date belt judges. */
  clientToday: string | null;
  /** The earliest queued version's start (the GET's `scheduledFor`). A pick
   *  on or before it ABSORBS that version (migration 144) — one sentence says
   *  so, then the save does what was asked: warn, never block. */
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

      {/* Starts on. The window the deficit is spread over begins here, in the
          preview and in the save alike (docs/MEASUREMENT-LOG-PLAN.md commit
          8bb). `min` is the affordance; the server refuses a past date. */}
      <div className="space-y-1.5">
        <label htmlFor="starts-on" className={SECTION_LABEL_CLASS}>
          Starts on
        </label>
        <Input
          id="starts-on"
          type="date"
          value={effectiveFrom ?? ""}
          min={clientToday ?? undefined}
          onChange={(e) => onEffectiveFromChange(e.target.value)}
          className={cn(MONO, FOCUS_RING, "h-10 bg-white")}
        />
        {queuedChangeDate && effectiveFrom && effectiveFrom <= queuedChangeDate && (
          <p className="text-[11px] leading-[1.4] text-[#b45309]">
            This replaces the change queued for {formatDateOnlyShort(queuedChangeDate)}.
          </p>
        )}
        <p className="text-[11px] text-[#93b0b4] leading-[1.4]">
          Targets take effect from this day, and the deficit is spread from it to the deadline.
        </p>
      </div>
    </div>
  );
}
