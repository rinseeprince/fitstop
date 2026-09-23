import { addDaysToDateString } from "@/lib/date-helpers";
import { goalAsOf, goalOnDay } from "./goal-timeline";
import type { ClientGoal, GoalHistoryLine, GoalHistoryRow } from "@/types/client-goals";

/**
 * The Journey's goals table, composed once (docs/MEASUREMENT-LOG-PLAN.md §6
 * commit 8d3): every goal, newest first — so the planned ones lead — with its
 * last day, whether it is planned, current or ended, and what happened during
 * it, oldest first. Nothing is recorded for it: a goal runs until the next one
 * starts, nutrition versions and programs carry their own dates, and a line
 * belongs to the goal whose days hold it. Pure, over one read of each.
 */

/** A live program's window: live windows never overlap. */
export type ProgramWindow = { name: string; startsOn: string; endsOn: string };

/** An active nutrition version: its window, its calories and the goal it was built for. */
export type NutritionVersionWindow = {
  startsOn: string;
  endsOn: string;
  calories: number;
  builtFor: { goalWeightKg: number | null; deadline: string | null };
};

type ProgramLine = Extract<GoalHistoryLine, { kind: "program" }>;

/**
 * What happened to the programs, read off their windows: a program starts, or
 * replaces the one that ended the day before; it ends when none starts the day
 * after, and otherwise the next one's line says it was replaced.
 */
function programLines(programs: readonly ProgramWindow[]): ProgramLine[] {
  const endingOn = new Map(programs.map((program) => [program.endsOn, program]));
  const startDays = new Set(programs.map((program) => program.startsOn));
  const lines: ProgramLine[] = [];
  for (const program of programs) {
    const before = endingOn.get(addDaysToDateString(program.startsOn, -1));
    lines.push(
      before
        ? { kind: "program", on: program.startsOn, change: "replaces", name: program.name, replaced: before.name }
        : { kind: "program", on: program.startsOn, change: "starts", name: program.name }
    );
    if (!startDays.has(addDaysToDateString(program.endsOn, 1))) {
      lines.push({ kind: "program", on: program.endsOn, change: "ends", name: program.name });
    }
  }
  return lines;
}

/** One day's lines in the order they happen: the calories, a program starting, the deadline, a program ending. */
function rank(line: GoalHistoryLine): number {
  if (line.kind === "nutrition") return 0;
  if (line.kind === "deadline") return 2;
  return line.change === "ends" ? 3 : 1;
}

function byDay(a: GoalHistoryLine, b: GoalHistoryLine): number {
  if (a.on !== b.on) return a.on < b.on ? -1 : 1;
  return rank(a) - rank(b);
}

export function goalHistoryRows({
  goals,
  today,
  programs,
  versions,
}: {
  goals: readonly ClientGoal[];
  /** The client's today. */
  today: string;
  programs: readonly ProgramWindow[];
  versions: readonly NutritionVersionWindow[];
}): GoalHistoryRow[] {
  const ordered = [...goals].sort((a, b) => (a.startsOn < b.startsOn ? -1 : 1));
  const current = goalOnDay(ordered, today);
  const changes = programLines(programs);

  return ordered
    .map((goal, i): GoalHistoryRow => {
      const next = ordered[i + 1];
      const endsOn = next ? addDaysToDateString(next.startsOn, -1) : null;
      const status =
        goal.startsOn > today ? "planned" : goal.id === current?.id ? "current" : "ended";
      const holds = (day: string) => day >= goal.startsOn && (endsOn === null || day <= endsOn);

      const lines: GoalHistoryLine[] = [
        // A change made the day a new goal took over from it never took effect.
        ...goal.deadlines
          .slice(1)
          .map(
            (entry, j): GoalHistoryLine => ({
              kind: "deadline",
              on: entry.effectiveOn,
              from: goal.deadlines[j].deadline,
              to: entry.deadline,
            })
          )
          .filter((line) => holds(line.on)),
        ...versions
          .filter((version) => version.endsOn >= goal.startsOn && (endsOn === null || version.startsOn <= endsOn))
          .map(
            (version): GoalHistoryLine => ({
              kind: "nutrition",
              on: version.startsOn,
              until: version.endsOn,
              calories: version.calories,
              builtFor: version.builtFor,
            })
          ),
        ...changes.filter((line) => holds(line.on)),
      ].sort(byDay);

      return {
        // An ended goal reads the deadline it ended with; the others today's,
        // which a planned goal reads as the one it starts with.
        ...goalAsOf(goal, status === "ended" && endsOn ? endsOn : today),
        endsOn,
        status,
        lines,
      };
    })
    .reverse();
}
