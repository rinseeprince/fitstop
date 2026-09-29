import { CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { NutritionDayStatus } from "@/types/schedule";
import type { TrainingAdherenceStatus } from "@/lib/training-adherence";
import { MACRO_OFF_TARGET_PERCENT } from "@/lib/constants";

/**
 * A day's food, in words and colours, from the standing the check-in froze at
 * Send — never re-judged from the day's numbers, so a threshold changed later
 * never rewords a sent week. One meaning per colour, the adherence rail's rule
 * (components/clients/overview/adherence-card.tsx): teal on target, amber
 * partial, rose missed, the faint tint for a targeted day with no food log, and
 * nothing to judge wears no colour. "No food logged" rather than "Not logged"
 * because the header chip counts days with ANY log and this row counts food.
 */
export const DAY_STANDING: Record<
  NutritionDayStatus,
  { label: string; pill: string; bar: string; figure: string }
> = {
  hit: { label: "On target", pill: "bg-[rgba(13,148,136,0.08)] text-[#0d9488]", bar: "bg-[#0d9488]", figure: "text-[#0d9488]" },
  partial: { label: "Partial", pill: "bg-[rgba(245,158,11,0.07)] text-[#d97706]", bar: "bg-[#d97706]", figure: "text-[#d97706]" },
  missed: { label: "Missed", pill: "bg-[rgba(192,96,96,0.08)] text-[#c06060]", bar: "bg-[#c06060]", figure: "text-[#c06060]" },
  not_logged: { label: "No food logged", pill: "bg-[rgba(13,148,136,0.04)] text-[#93b0b4]", bar: "", figure: "text-[#93b0b4]" },
  no_target: { label: "No target", pill: "text-[#93b0b4]", bar: "bg-[#93b0b4]", figure: "text-[#5a7d82]" },
};

/**
 * The three words a WORKOUT is described in — "completed" is reserved for
 * counts, so a chip never says it beside "0/2" (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md,
 * §4.7 M8). Teal Summit's workout colours: teal full, amber partial, muted
 * missed.
 */
export const WORKOUT_STATUS: Record<TrainingAdherenceStatus, { label: string; icon: LucideIcon; chip: string }> = {
  full: { label: "Full", icon: CheckCircle2, chip: "bg-[rgba(13,148,136,0.08)] text-[#0d9488]" },
  partial: { label: "Partial", icon: CircleDashed, chip: "bg-[rgba(245,158,11,0.07)] text-[#d97706]" },
  missed: { label: "Missed", icon: XCircle, chip: "bg-[rgba(13,148,136,0.04)] text-[#93b0b4]" },
};

/** The line at a day's calorie target, and the box a day with no food logged stands in for its bar. */
export const TARGET_LINE = "bg-[rgba(13,148,136,0.25)]";
export const NO_FOOD_BOX = "rounded-[4px] border border-dashed border-[rgba(13,148,136,0.35)]";

type MacroMark = "under" | "over";

/**
 * A macro 10% or more off its target, either side — drawn from the frozen
 * numbers, so it never moves on a sent week. Null when either side is missing:
 * a day no target covered is never marked.
 */
export function macroMark(eaten: number | null, target: number | null): MacroMark | null {
  if (eaten == null || target == null || target <= 0) return null;
  // Whole numbers on both sides, so exactly 10% off is marked: 200 × 1.1 is
  // not 220 in floating point.
  if (Math.abs(eaten - target) * 100 < target * MACRO_OFF_TARGET_PERCENT) return null;
  return eaten < target ? "under" : "over";
}

/** Under in the protein blue, over in the warning amber — a tint behind the number. */
export const MACRO_MARK: Record<MacroMark, { tint: string; words: string }> = {
  under: { tint: "bg-[rgba(45,143,181,0.10)] text-[#2d8fb5]", words: "10% or more under target" },
  over: { tint: "bg-[rgba(245,158,11,0.10)] text-[#d97706]", words: "10% or more over target" },
};

export const MACROS = [
  { name: "Protein", eaten: "actualProteinG", target: "targetProteinG", dot: "bg-protein", average: "proteinG" },
  { name: "Carbs", eaten: "actualCarbsG", target: "targetCarbsG", dot: "bg-carbs", average: "carbsG" },
  { name: "Fats", eaten: "actualFatG", target: "targetFatG", dot: "bg-fat", average: "fatG" },
] as const;
