import type { CheckInWithDetails, CheckIn, CheckInTrainingEventDetail } from "@/types/check-in";
import type { DailyLog } from "@/types/daily-log";
import type { HabitLogWithDetails } from "@/types/daily-habit";
import type { WeeklyNutritionSummary } from "@/types/weekly-nutrition";
import type { PeriodSnapshot } from "@/types/schedule";
import { buildDailyContextForAI } from "@/utils/ai-daily-context-builder";
import { sanitizeForAIPrompt } from "@/utils/ai-prompt-sanitizer";
import { summariseSessions } from "@/lib/check-in/adherence";
import { buildAnalysisTaskPrompt } from "@/utils/ai-analysis-format";
import {
  DEFAULT_UNIT_SYSTEM,
  formatLoad,
  formatWeight,
  type UnitSystem,
} from "@/utils/unit-conversions";

export { AI_SYSTEM_PROMPT } from "@/utils/ai-system-prompt";

export function buildCheckInAnalysisPrompt(
  current: CheckInWithDetails,
  previous: CheckIn[],
  clientName: string,
  dailyLogs?: DailyLog[],
  habitLogs?: HabitLogWithDetails[],
  startDate?: Date,
  endDate?: Date,
  weeklySummary?: WeeklyNutritionSummary | null,
  periodSnapshot?: PeriodSnapshot | null,
  trainingEventDetails?: CheckInTrainingEventDetail[],
  exerciseSummaries?: Map<string, string[]>,
  /**
   * The COACH's unit system — they are who reads the generated summary. Required
   * rather than defaulted: a silent fallback here produces a plausible summary
   * in the wrong unit, which is indistinguishable from a correct one.
   */
  viewer: UnitSystem = DEFAULT_UNIT_SYSTEM
): string {
  const weight = (kg: number) => {
    const { value, unit } = formatWeight(kg, viewer);
    return `${Math.round(value * 10) / 10} ${unit}`;
  };
  const load = (kg: number) => {
    const { value, unit } = formatLoad(kg, viewer);
    return `${value}${unit}`;
  };
  let prompt = `Analyze this check-in for ${sanitizeForAIPrompt(clientName)}:\n\n`;

  prompt += "**CURRENT CHECK-IN:**\n";
  prompt += `Date: ${new Date(current.createdAt).toLocaleDateString()}\n`;

  if (current.mood || current.energy || current.sleep || current.stress || current.soreness) {
    prompt += "\nSubjective Metrics:\n";
    if (current.mood) prompt += `- Mood: ${current.mood}/5\n`;
    if (current.energy) prompt += `- Energy: ${current.energy}/10\n`;
    if (current.sleep) prompt += `- Sleep: ${current.sleep}/10\n`;
    if (current.stress) prompt += `- Stress: ${current.stress}/10\n`;
    if (current.soreness) prompt += `- Soreness: ${current.soreness}/10 (higher = more sore)\n`;
  }

  if (current.weight || current.bodyFatPercentage) {
    prompt += "\nBody Metrics:\n";
    if (current.weight)
      prompt += `- Weight: ${weight(current.weight)}\n`;
    if (current.bodyFatPercentage)
      prompt += `- Body Fat: ${current.bodyFatPercentage}%\n`;
  }

  prompt += "\nTraining:\n";
  // Source of truth (Session 6.2): per-event detail derived from training_events
  // (status) left-joined to session_logs (notes/quality). Falls back to the
  // legacy free-text workout count when no event detail is available.
  if (trainingEventDetails?.length) {
    const completed = trainingEventDetails.filter((d) => d.status === "completed").length;
    const total = trainingEventDetails.length;
    prompt += `- Sessions: ${completed}/${total} completed\n`;
    trainingEventDetails.forEach((d) => {
      let status: string;
      if (d.status === "skipped") {
        status = d.notes
          ? `Skipped (reason: ${sanitizeForAIPrompt(d.notes)})`
          : "Skipped";
      } else if (d.logStatus === "not_logged") {
        status = `(${d.status}, not logged)`;
      } else {
        status = `(${d.status})`;
      }
      prompt += `  - ${sanitizeForAIPrompt(d.sessionName)}: ${status}\n`;
      if (d.status !== "skipped" && d.notes) {
        prompt += `    Note: ${sanitizeForAIPrompt(d.notes)}\n`;
      }

      // Session 6.3 enrichment: per-exercise top-set lines + alt-session swap
      // signal. Only logged completed/partial events carry an exercise block;
      // skipped / not-logged events keep their 6.2 line only.
      if (d.status === "completed" || d.status === "partial") {
        const exerciseLines = d.sessionLogId
          ? exerciseSummaries?.get(d.sessionLogId)
          : undefined;
        // Alt-session swap header: prescribed vs performed session name.
        if (
          d.performedSessionName &&
          d.performedSessionName !== d.sessionName
        ) {
          const k = exerciseLines?.length ?? 0;
          prompt += `    Prescribed ${sanitizeForAIPrompt(d.sessionName)} · Performed ${sanitizeForAIPrompt(d.performedSessionName)} — ${k} exercises logged\n`;
        }
        if (exerciseLines?.length) {
          exerciseLines.forEach((line) => {
            // Lines are pre-sanitized in the service (names) but contain a
            // composed em-dash format string; re-sanitizing would strip it.
            prompt += `      ${line}\n`;
          });
        }
      }
    });
  } else if (current.sessionCompletions?.length) {
    // Derived from the period's own sessions (full + PARTIAL over prescribed),
    // the same figure the KPI ribbon and the comparison pane render. It used to
    // read `current.workoutsCompleted`, the stored full-only column, which is
    // how the summary came to say "completed only 2 out of 5" under a strip
    // reading 3/5 for the same week.
    const summary = summariseSessions(current.sessionCompletions);
    prompt += `- Workouts completed: ${summary.completed}/${summary.prescribed}`;
    const detail = [
      summary.partial > 0 ? `${summary.partial} partial` : null,
      summary.missed > 0 ? `${summary.missed} missed` : null,
    ].filter(Boolean);
    prompt += detail.length ? ` (${detail.join(", ")})\n` : "\n";
  }

  if (current.exerciseHighlights?.length) {
    prompt += "\nExercise Highlights:\n";
    current.exerciseHighlights.forEach((h) => {
      const type = h.highlightType === "pr" ? "PR" : h.highlightType === "struggle" ? "Struggle" : "Note";
      prompt += `- [${type}] ${sanitizeForAIPrompt(h.exerciseName)}`;
      // Was `${h.weightValue}${h.weightUnit}` with NO fallback — an unmapped
      // highlight emitted "100undefined" straight into the model's context.
      if (h.weightValue) prompt += ` @ ${load(h.weightValue)}`;
      if (h.reps) prompt += ` x ${h.reps}`;
      prompt += "\n";
      if (h.details) prompt += `  ${sanitizeForAIPrompt(h.details)}\n`;
    });
  }

  // Nutrition.
  //
  // The block leads with INTAKE on the days the client actually logged, and
  // names the whole-period figure as COVERAGE. Both numbers are correct and they
  // answer different questions; presenting only the second one, under a "frame
  // nutrition weekly" instruction, made the model report a client who hit target
  // to the calorie on both days they logged as severely under-eating and warn
  // about their energy and recovery. An unlogged day is unknown, not a zero, and
  // the prompt has to say so — the model cannot infer it from a percentage.
  if (weeklySummary) {
    const s = weeklySummary;
    prompt += `\n**NUTRITION - ${s.daysLogged} of ${s.daysInWeek} days logged:**\n`;

    if (s.daysLogged > 0 && s.loggedDayMeanConsumed != null) {
      // Calories are whole numbers to a coach; the stored mean keeps its decimal.
      const target =
        s.loggedDayMeanTarget != null
          ? ` against a ${Math.round(s.loggedDayMeanTarget)} cal/day target`
          : "";
      const pct =
        s.loggedDayAdherencePercentage != null
          ? ` (${s.loggedDayAdherencePercentage}% of target)`
          : "";
      prompt += `- Intake on the days they logged: ${Math.round(s.loggedDayMeanConsumed)} cal/day${target}${pct}\n`;
      prompt += `- Of those ${s.daysLogged} logged days: ${s.daysOnTarget} on target, ${s.daysOver} over, ${s.daysUnder} under\n`;
    } else {
      prompt += "- No days were logged, so their intake cannot be assessed at all.\n";
    }

    if (s.totalCaloriesConsumed != null && s.totalTargetCalories > 0) {
      prompt += `- Logging coverage: ${s.totalCaloriesConsumed} of ${s.totalTargetCalories} cal targeted across the ${s.daysInWeek}-day period (${s.adherencePercentage?.toFixed(1) ?? "?"}%)\n`;
    } else {
      prompt += `- Whole-period target: ${s.totalTargetCalories} cal\n`;
    }

    const unlogged = s.daysInWeek - s.daysLogged;
    if (unlogged > 0) {
      prompt += `- The ${unlogged} unlogged day${unlogged === 1 ? "" : "s"} hold NO data. They are unknown, not zero.\n`;
      prompt += "- Describe their intake ONLY from the logged-day figures above, and say how many days those rest on. Never infer under-eating, low energy availability or poor recovery from the coverage figure - it measures logging, not eating.\n";
    }
  } else {
    prompt += "\nNutrition:\n";
    if (current.nutritionDaysOnTarget !== undefined) {
      // The period's own length, not a hardcoded week: a first check-in reports
      // on a partial period, and telling the model 3/7 when the period was
      // three days long invites it to describe a shortfall that never existed.
      const periodDays =
        startDate && endDate
          ? Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1
          : 7;
      prompt += `- Days on target: ${current.nutritionDaysOnTarget}/${periodDays}\n`;
      if (current.nutritionNotes) prompt += `- Notes: ${sanitizeForAIPrompt(current.nutritionNotes)}\n`;
    } else if (current.adherencePercentage !== undefined) {
      prompt += `- Adherence: ${current.adherencePercentage}%\n`;
    }
  }

  if (current.prs) prompt += `\nPersonal Records (free text): ${sanitizeForAIPrompt(current.prs)}\n`;
  if (current.challenges) prompt += `\nChallenges (free text): ${sanitizeForAIPrompt(current.challenges)}\n`;
  if (current.notes) prompt += `\nNotes: ${sanitizeForAIPrompt(current.notes)}\n`;

  // The coach's own questions and this client's answers (D4.5). One sanitised
  // line each, beside the other free text, because without them the Summary is
  // blind to the questions the coach wrote — it would analyse a week the client
  // partly described somewhere the model never sees. Both halves are sanitised:
  // the prompt is coach-authored and the answer is client-authored, and neither
  // is trusted input to a model.
  if (current.customAnswers?.length) {
    prompt += "\nCoach questions:\n";
    current.customAnswers.forEach((a) => {
      prompt += `- ${sanitizeForAIPrompt(a.prompt)} — ${sanitizeForAIPrompt(a.answer)}\n`;
    });
  }

  // Prefer frozen snapshot for day-by-day detail when available
  if (periodSnapshot) {
    prompt += "\n**DAY-BY-DAY TRAINING SCHEDULE (from snapshot):**\n";
    for (const day of periodSnapshot.training) {
      const planned = day.plannedSessionName ? ` [Planned: ${sanitizeForAIPrompt(day.plannedSessionName)}]` : "";
      const logged = day.loggedSessionName ? ` [Logged: ${sanitizeForAIPrompt(day.loggedSessionName)}]` : "";
      prompt += `- ${day.date} (${day.dayOfWeek}): ${day.status}${planned}${logged}\n`;
    }

    prompt += "\n**DAY-BY-DAY NUTRITION (from snapshot):**\n";
    for (const day of periodSnapshot.nutrition) {
      const target = day.targetCalories != null ? `target=${day.targetCalories}` : "no target";
      const actual = day.actualCalories != null ? `actual=${day.actualCalories}` : "not logged";
      prompt += `- ${day.date} (${day.dayOfWeek}): ${day.status} (${target}, ${actual})\n`;
    }
  }

  if (dailyLogs && dailyLogs.length > 0 && startDate && endDate) {
    const dailyContext = buildDailyContextForAI(dailyLogs, habitLogs || [], startDate, endDate);
    if (dailyContext) {
      prompt += `\n${dailyContext}\n`;
    }
  }

  if (previous.length > 0) {
    prompt += "\n**PREVIOUS CHECK-INS (for trend analysis):**\n";
    previous.slice(0, 3).forEach((prev, idx) => {
      prompt += `\n${idx + 1}. ${new Date(prev.createdAt).toLocaleDateString()}\n`;
      if (prev.weight) prompt += `   Weight: ${weight(prev.weight)}\n`;
      if (prev.adherencePercentage) prompt += `   Adherence: ${prev.adherencePercentage}%\n`;
      // No `Workouts:` line. These are bare `CheckIn` rows, so the only count on
      // them is the stored full-only column — a different statistic from the
      // current period's derived figure above, and putting both in one prompt is
      // what produced a contradiction. Deriving it per row would be a query per
      // check-in (CONVENTIONS §2 item 7); the current period's training is
      // already described in full by the schedule block.
      if (prev.mood) prompt += `   Mood: ${prev.mood}/5\n`;
    });
  }

  prompt += buildAnalysisTaskPrompt(clientName);

  return prompt;
}
