import { format } from "date-fns";
import type { CheckInReviewInput } from "@/types/check-in-review-input";
import type { CheckInExerciseHighlight } from "@/types/check-in";
import { sanitizeForAIPrompt } from "./ai-prompt-sanitizer";
import { describeDay, type ReviewDay } from "./ai-prompt-day";
import { weekFigures, weightAndGoal } from "./ai-prompt-week";
import { describeReviewShape } from "./ai-analysis-format";
import { formatLoad, type UnitSystem } from "./unit-conversions";
import { AI_PROMPT_TEXT_LIMIT } from "@/lib/constants";

/**
 * The week as the check-in AI reads it (owner decision 2026-09-18): the
 * client's weight and goal as the ribbon and the goal strip show them, the
 * week's figures as the ribbon and the cards show them, then every day in
 * turn with what was prescribed and what was logged against it, then the
 * client's own words, then the shape the card renders. Every figure is the
 * review page's own, from the same code, in the coach's units; no count of
 * days logged, no rule and no cap. Pure over `CheckInReviewInput`; the two
 * headline blocks are utils/ai-prompt-week.ts, one day is utils/ai-prompt-day.ts.
 */

const text = (value: string) => sanitizeForAIPrompt(value, AI_PROMPT_TEXT_LIMIT);
const longDate = (date: string) => format(new Date(`${date}T12:00:00`), "EEEE d MMMM yyyy");
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

function header(input: CheckInReviewInput): string[] {
  const { dates, comparison } = input;
  const week =
    dates.length > 0 ? `Week ${longDate(dates[0])} to ${longDate(dates[dates.length - 1])}.` : "Week unknown.";
  const gap = comparison
    ? comparison.comparison.previous
      ? `, ${plural(comparison.comparison.timeBetweenCheckIns ?? 0, "day")} since the last check-in`
      : ", their first check-in"
    : "";
  return [`Check-in review for ${text(input.clientName)}`, `${week} Submitted ${longDate(input.submittedOn)}${gap}.`];
}

function dayByDay(input: CheckInReviewInput): string[] {
  const workoutsByDate = new Map<string, CheckInReviewInput["workouts"]>();
  for (const workout of input.workouts) {
    const list = workoutsByDate.get(workout.date) ?? [];
    list.push(workout);
    workoutsByDate.set(workout.date, list);
  }
  const nutritionByDate = new Map(input.nutrition.days.map((day) => [day.date, day]));
  const logsByDate = new Map(input.dailyLogs.map((log) => [log.date, log]));
  const logged = input.loggedDates ? new Set(input.loggedDates) : null;

  const blocks = input.dates.map((date, index) => {
    const day: ReviewDay = {
      date,
      logged: logged ? logged.has(date) : null,
      workouts: workoutsByDate.get(date) ?? [],
      exerciseLines: input.exerciseLines,
      nutrition: nutritionByDate.get(date) ?? null,
      dailyLog: logsByDate.get(date) ?? null,
      // Before its effective date the habit did not exist: null, never a miss.
      habits: input.habits.flatMap((habit) => {
        const ticked = habit.rail[index];
        return ticked == null ? [] : [{ name: habit.name, ticked }];
      }),
    };
    return describeDay(day);
  });

  return [
    "DAY BY DAY",
    "Wellness scores: mood out of 5; energy, sleep, stress and soreness out of 10, where higher stress or soreness is worse.",
    "",
    ...blocks.flatMap((block, index) => (index === 0 ? [block] : ["", block])),
  ];
}

function highlightLine(highlight: CheckInExerciseHighlight, viewer: UnitSystem): string {
  const type =
    highlight.highlightType === "pr" ? "PR" : highlight.highlightType === "struggle" ? "Struggle" : "Note";
  // A PR is a barbell load, so formatLoad — it snaps an imperial conversion to
  // something loadable.
  const load = highlight.weightValue
    ? ` @ ${formatLoad(highlight.weightValue, viewer).value} ${formatLoad(highlight.weightValue, viewer).unit}`
    : "";
  const reps = highlight.reps ? ` x ${highlight.reps}` : "";
  const details = highlight.details ? `, ${text(highlight.details)}` : "";
  return `[${type}] ${text(highlight.exerciseName)}${load}${reps}${details}`;
}

function clientsOwnWords(input: CheckInReviewInput): string[] {
  const { checkIn, viewer } = input;
  const lines = ["CLIENT'S OWN WORDS"];
  if (checkIn.notes) lines.push(`Reflection: "${text(checkIn.notes)}"`);
  if (checkIn.prs) lines.push(`Wins: "${text(checkIn.prs)}"`);
  if (checkIn.challenges) lines.push(`Challenges: "${text(checkIn.challenges)}"`);
  const highlights = checkIn.exerciseHighlights ?? [];
  if (highlights.length > 0) {
    lines.push("Exercise highlights:");
    for (const highlight of highlights) lines.push(`  ${highlightLine(highlight, viewer)}`);
  }
  const answers = checkIn.customAnswers ?? [];
  if (answers.length > 0) {
    // Both halves sanitised: the prompt is coach-authored and the answer
    // client-authored, and neither is trusted input to a model.
    lines.push("Your questions:");
    for (const answer of answers) {
      lines.push(`  Q: ${text(answer.prompt)}`);
      lines.push(`  A: "${text(answer.answer)}"`);
    }
  }
  if (lines.length === 1) lines.push("The client wrote nothing this check-in.");
  return lines;
}

export function buildCheckInReviewPrompt(input: CheckInReviewInput): string {
  return [
    ...header(input),
    "",
    ...weightAndGoal(input),
    "",
    ...weekFigures(input),
    "",
    ...dayByDay(input),
    "",
    ...clientsOwnWords(input),
    "",
    describeReviewShape(input.clientName),
  ].join("\n");
}
