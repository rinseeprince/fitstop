/**
 * Every check-in copy saved on the linked DEV database, read through
 * `readSentSnapshot` (docs/HABITS-REBUILD-PLAN.md §5, "The drop"; rule 9):
 *
 *   npx tsx scripts/check-in-copies-read-proof.ts
 *
 *   1  every copy reads, whatever version it was saved at — none throws
 *   2  a copy saved at version 1 or 2 draws the review's Habits section with
 *      the habits, figures and day marks it drew before version 3, worked out
 *      here the old way from the copy's own `perHabit`
 *
 * Read-only: it writes nothing, so it leaves nothing to clean up.
 */
import "./env-bootstrap";

import { supabaseAdmin } from "@/services/supabase-admin";
import { readSentSnapshot } from "@/lib/check-in/sent-snapshot";
import { habitSectionNotes, habitSectionRows, type HabitRailMark } from "@/lib/check-in/habit-section-rows";

const PAGE = 500;

/** A version 1 or 2 copy's habits, as it saved them. */
type SavedHabits = {
  perHabit: { id: string; name: string; eligibleDays: number; completedDays: number; rail: (boolean | null)[] }[];
};
type SavedCopy = { version?: unknown; period?: { dates: string[]; habits?: SavedHabits } | null };

/** The section's rows as the component drew them before version 3: a habit never eligible has none. */
function rowsTheOldWay(habits: SavedHabits) {
  return habits.perHabit
    .filter((habit) => habit.eligibleDays > 0)
    .map((habit) => ({
      id: habit.id,
      name: habit.name,
      figure: `${habit.completedDays}/${habit.eligibleDays}`,
      marks: habit.rail.map((day): HabitRailMark => (day === null ? "not_yet_added" : day ? "done" : "missed")),
    }));
}

async function main(): Promise<void> {
  const byVersion = new Map<string, number>();
  const unreadable: { id: string; error: string }[] = [];
  const drawnDifferently: { id: string; what: string }[] = [];
  let compared = 0;

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("check_ins")
      .select("id, sent_snapshot")
      .not("sent_snapshot", "is", null)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`check_ins page at ${from}: ${error.message}`);

    for (const row of data ?? []) {
      const saved = row.sent_snapshot as SavedCopy;
      const version = String(saved?.version);
      byVersion.set(version, (byVersion.get(version) ?? 0) + 1);

      let read: ReturnType<typeof readSentSnapshot>;
      try {
        read = readSentSnapshot(saved);
      } catch (thrown) {
        unreadable.push({ id: row.id, error: thrown instanceof Error ? thrown.message : String(thrown) });
        continue;
      }
      const habitWeek = read?.period?.habitWeek ?? null;
      // What the review draws from it must work for every version.
      const rows = habitSectionRows(habitWeek).map((habit) => ({
        id: habit.id,
        name: habit.name,
        figure: habit.figure,
        marks: habit.cells.map((cell) => cell.mark),
      }));
      const notes = habitSectionNotes(habitWeek);

      if ((version === "1" || version === "2") && saved.period?.habits) {
        compared += 1;
        const { habits } = saved.period;
        if (JSON.stringify(rows) !== JSON.stringify(rowsTheOldWay(habits))) {
          drawnDifferently.push({ id: row.id, what: "the Habits section" });
        }
        // Version 2 saved ticks alone: no note can come out of it.
        if (notes.length > 0) drawnDifferently.push({ id: row.id, what: "the Habits section's notes" });
      }
    }
    if (!data || data.length < PAGE) break;
  }

  const total = [...byVersion.values()].reduce((sum, count) => sum + count, 0);
  const versions = [...byVersion.entries()].sort().map(([version, count]) => `version ${version}: ${count}`).join(", ");
  console.info(`Copies saved: ${total} (${versions}).`);
  console.info(`  ${unreadable.length === 0 ? "✓" : "✗"} every copy reads: ${total - unreadable.length} of ${total}`);
  for (const failure of unreadable.slice(0, 10)) console.error(`      ${failure.id}: ${failure.error}`);
  console.info(
    `  ${drawnDifferently.length === 0 ? "✓" : "✗"} every version 1 or 2 copy with a week draws its habits as before: ${compared} compared`
  );
  for (const difference of drawnDifferently.slice(0, 10)) console.error(`      ${difference.id}: ${difference.what}`);

  if (unreadable.length > 0 || drawnDifferently.length > 0) {
    process.exitCode = 1;
  } else {
    console.info("Every copy holds.");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
