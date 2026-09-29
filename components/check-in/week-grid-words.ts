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
 * partial, rose missed; a day with nothing to judge, or nothing logged, wears
 * a hollow dot. "No food logged" rather than "Not logged" because the header
 * chip counts days with ANY log and this column counts food.
 */
export const DAY_STANDING: Record<NutritionDayStatus, { label: string; text: string; dot: string; bar: string }> = {
  hit: { label: "On target", text: "text-[#0d9488]", dot: "bg-[#0d9488]", bar: "bg-[#0d9488]" },
  partial: { label: "Partial", text: "text-[#d97706]", dot: "bg-[#d97706]", bar: "bg-[#d97706]" },
  missed: { label: "Missed", text: "text-[#c06060]", dot: "bg-[#c06060]", bar: "bg-[#c06060]" },
  not_logged: { label: "No food logged", text: "text-[#93b0b4]", dot: "border border-[#93b0b4]", bar: "" },
  no_target: { label: "No target", text: "text-[#93b0b4]", dot: "border border-[#93b0b4]", bar: "bg-[#c2d0cc]" },
};

/**
 * The three words a WORKOUT is described in — "completed" is reserved for
 * counts (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md, §4.7 M8) — in the rail's
 * colours: teal full, amber partial, rose missed. A full workout shows its
 * tick alone; the word is written out where something went short.
 */
export const WORKOUT_STATUS: Record<
  TrainingAdherenceStatus,
  { label: string; icon: LucideIcon; tone: string; wordShown: boolean }
> = {
  full: { label: "Full", icon: CheckCircle2, tone: "text-[#0d9488]", wordShown: false },
  partial: { label: "Partial", icon: CircleDashed, tone: "text-[#d97706]", wordShown: true },
  missed: { label: "Missed", icon: XCircle, tone: "text-[#c06060]", wordShown: true },
};

/** A day's row holds two workouts; a third and more open from "+N more" (owner, 2026-09-29). */
export const SESSIONS_SHOWN = 2;

/** The tick at a day's calorie target on its bar. */
export const TARGET_TICK = "bg-[#0c1a1e]";

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
  { name: "Protein", eaten: "actualProteinG", target: "targetProteinG", average: "proteinG" },
  { name: "Carbs", eaten: "actualCarbsG", target: "targetCarbsG", average: "carbsG" },
  { name: "Fats", eaten: "actualFatG", target: "targetFatG", average: "fatG" },
] as const;
