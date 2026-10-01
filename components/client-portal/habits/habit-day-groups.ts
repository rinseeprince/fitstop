import type { ClientHabitDayItem, HabitAnswer, HabitWeekSpan } from "@/types/habits";

/**
 * The client's habits page (docs/HABITS-REBUILD-PLAN.md §2.5): every habit a
 * version covers on the day, in three groups — what the day plans, what the
 * week asks for on any day (a habit done N times a week plans no particular
 * day), and what the day does not plan, which the client may still do and
 * enter (owner, 2026-09-30). Each group keeps the coach's order.
 */
export type HabitGroupKey = "planned" | "any-day" | "not-planned";

type HabitGroup = { key: HabitGroupKey; label: string; items: ClientHabitDayItem[] };

const ORDER: readonly HabitGroupKey[] = ["planned", "any-day", "not-planned"];

/**
 * Whether the client week a day belongs to holds the client's today: its
 * figures are this week's, else that week's. Every habit on a day shares the
 * client week holding the day.
 */
function isThisWeek(week: Pick<HabitWeekSpan, "start" | "end">, today: string): boolean {
  return week.start <= today && today <= week.end;
}

/**
 * Each group's heading. "Today" is said on the client's today alone: another
 * day's page names its date above the groups. A week is "this week" when it
 * holds the client's today, else "that week".
 */
function groupLabel(key: HabitGroupKey, isToday: boolean, thisWeek: boolean): string {
  if (key === "any-day") return thisWeek ? "Any day this week" : "Any day that week";
  if (key === "planned") return isToday ? "Planned today" : "Planned";
  return isToday ? "Not planned today" : "Not planned";
}

/** The group a habit's day puts it in. */
export function habitGroupOf(item: ClientHabitDayItem): HabitGroupKey {
  if (item.day.timesPerWeek !== null) return "any-day";
  return item.day.planned ? "planned" : "not-planned";
}

/**
 * The day's habits in their groups, in the page's order; a group with no habit
 * is left out. `today` is the client's.
 */
export function habitDayGroups(items: readonly ClientHabitDayItem[], date: string, today: string): HabitGroup[] {
  return ORDER.map((key) => {
    const members = items.filter((item) => habitGroupOf(item) === key);
    const thisWeek = members.length > 0 && isThisWeek(members[0].week, today);
    return { key, label: groupLabel(key, date === today, thisWeek), items: members };
  }).filter((group) => group.items.length > 0);
}

/**
 * The words beside a habit on its day: a number habit's target that day ("at
 * least 3 L"), and, where the day does not plan it, the days that are planned
 * first ("Mon, Wed, Fri · at least 3 L"). A habit done N times a week needs
 * neither its days nor a tick's words: its group and its week's figure say it.
 */
export function habitRowWords(item: ClientHabitDayItem, group: HabitGroupKey): string | null {
  const parts = group === "not-planned" ? [item.words.schedule, item.words.target] : [item.words.target];
  const words = parts.filter((part): part is string => part !== null);
  return words.length > 0 ? words.join(" · ") : null;
}

/** The habit's week as its row reads it: "4 of 7 this week", "Nothing planned that week". `today` is the client's. */
export function habitWeekWords(item: ClientHabitDayItem, today: string): string {
  return `${item.words.week} ${isThisWeek(item.week, today) ? "this" : "that"} week`;
}

/**
 * The answer a note is saved with. A note belongs to the day's entry, and an
 * entry is one answer (the entry route takes a note beside `done` or `value`,
 * never alone), so the note rides on the answer as the day shows it: a tick
 * habit's tick — not done until it is ticked — or a number habit's number.
 * Null while a number habit has no number: its note waits for one.
 */
export function noteAnswer(item: ClientHabitDayItem): HabitAnswer | null {
  if (item.habit.measure === "tick") return { done: item.day.entry?.done === true };
  const value = item.day.entry?.value ?? null;
  return value === null ? null : { value };
}
