// A program's session rows read as its days (migration 180). A day of a
// program is its (weekIndex, orderIndex): the rows sharing one are that day's
// sessions, in their dayOrder, and a day whose only row is a rest row is a rest
// day. Placement, the builder's read of a saved program and the save schemas
// all read days through here, so a day means one thing everywhere. Pure, so the
// browser and the server share it.

/** The position fields every program row carries. */
type ProgramRow = {
  weekIndex: number;
  orderIndex: number;
  dayOrder: number;
  isRest: boolean;
};

/** One day of a program: its position and its sessions in order; none is rest. */
export type ProgramDay<T> = {
  weekIndex: number;
  orderIndex: number;
  sessions: T[];
};

const sameDay = (a: ProgramRow, b: { weekIndex: number; orderIndex: number }) =>
  a.weekIndex === b.weekIndex && a.orderIndex === b.orderIndex;

/**
 * The program's days in order — by week, then position — each holding its
 * session rows in the day's order. Rows sharing a place keep the order they were
 * given, so a read ordered by id reads the same every time.
 */
export function programDays<T extends ProgramRow>(rows: readonly T[]): ProgramDay<T>[] {
  const ordered = rows
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) =>
        a.row.weekIndex - b.row.weekIndex ||
        a.row.orderIndex - b.row.orderIndex ||
        a.row.dayOrder - b.row.dayOrder ||
        a.index - b.index,
    );
  const days: ProgramDay<T>[] = [];
  for (const { row } of ordered) {
    let day = days[days.length - 1];
    if (!day || !sameDay(row, day)) {
      day = { weekIndex: row.weekIndex, orderIndex: row.orderIndex, sessions: [] };
      days.push(day);
    }
    if (!row.isRest) day.sessions.push(row);
  }
  return days;
}

/**
 * Why a program's rows don't describe its days unambiguously; null when they
 * do. Two sessions can't share a place on one day, and a rest row is a day of
 * its own.
 */
export function programRowsIssue(rows: readonly ProgramRow[]): string | null {
  const places = new Set<string>();
  const restDays = new Set<string>();
  const sessionDays = new Set<string>();
  for (const row of rows) {
    const day = `${row.weekIndex}:${row.orderIndex}`;
    const place = `${day}:${row.dayOrder}`;
    if (places.has(place)) return "Two sessions share a place on the same day";
    places.add(place);
    (row.isRest ? restDays : sessionDays).add(day);
  }
  for (const day of restDays) {
    if (sessionDays.has(day)) return "A rest day holds no sessions";
  }
  return null;
}
