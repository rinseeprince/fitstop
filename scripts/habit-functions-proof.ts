/**
 * Proof of every rule of the habit functions (migrations 203 and 206;
 * docs/HABITS-REBUILD-PLAN.md §6 commits 1 and 3), on the linked DEV database,
 * inside ONE transaction that is rolled back — nothing it writes survives.
 *
 *   npx tsx scripts/habit-functions-proof.ts
 *   npx tsx scripts/habit-functions-proof.ts --before-push
 *
 * Each rule is checked twice: against the live function, where it must hold,
 * and against a copy of that function with the rule taken out (a planted bug,
 * loaded as a pg_temp function from the text of the newest migration that
 * defines it), where the same check must FAIL — a check that passes either way
 * proves nothing. The three catalog rules (versions never overlap; the grants;
 * one delete function) are planted by dropping the constraint, adding a grant
 * and adding an overload inside the same transaction. The fixtures are three
 * throwaway clients — two under the perf coach (never in any roster), one
 * under another coach — written as `postgres`; every day is fixed, and "today"
 * is the functions' `p_today`.
 *
 * `--before-push` applies the newest migration that defines habit functions at
 * the start of the same rolled-back transaction, so its functions are proven
 * before `db push` makes them live; run without it once they are.
 *
 * Needs `npx supabase db query --linked` access (no password) and the DEV link.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PERF_COACH_ID } from "./perf-fixtures";

/** The migrations that define habit functions, oldest first: a function's text is its newest definition. */
const MIGRATIONS = ["203_client_habits.sql", "206_client_habits_delete_any.sql"].map((file) =>
  readFileSync(join(process.cwd(), "supabase", "migrations", file), "utf8")
);
/** The migration `--before-push` applies: the newest of them, not yet live when the flag is used. */
const PENDING_MIGRATION = MIGRATIONS[MIGRATIONS.length - 1];

const CREATE_FUNCTION = /CREATE (OR REPLACE )?FUNCTION public\.\w+\(/;

// A Wednesday. 5 Oct and 12 Oct are Mondays.
const TODAY = "2026-10-07";
const C = "0a0a0203-0000-4000-8000-00000000c001";
const OTHER = "0a0a0203-0000-4000-8000-00000000c002";
const FOREIGN = "0a0a0203-0000-4000-8000-00000000c003";
const H1 = "0a0a0203-0000-4000-8000-0000000000a1";
const H2 = "0a0a0203-0000-4000-8000-0000000000a2";
const H3 = "0a0a0203-0000-4000-8000-0000000000a3";
const H4 = "0a0a0203-0000-4000-8000-0000000000a4";

const EVERY_DAY = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const MON_WED_FRI = ["monday", "wednesday", "friday"];

type FunctionName =
  | "add_client_habits"
  | "change_client_habit"
  | "stop_client_habit"
  | "delete_client_habit"
  | "rename_client_habit"
  | "order_client_habits"
  | "set_client_habit_day"
  | "reset_client_habit_day"
  | "coach_habit_choices";

/** One function's text, from CREATE to its closing $$;, in the newest migration that defines it. */
function functionText(name: FunctionName): string {
  const header = new RegExp(`CREATE (OR REPLACE )?FUNCTION public\\.${name}\\(`);
  for (const migration of [...MIGRATIONS].reverse()) {
    const match = header.exec(migration);
    if (!match) continue;
    const end = migration.indexOf("\n$$;", match.index);
    return migration.slice(match.index, end + "\n$$;".length);
  }
  throw new Error(`No ${name} in the habit migrations`);
}

type Edit = { from: string; to: string };
/** One rule taken out of a function: usually one edit, two where a rule has a belt. */
type Bug = { fn: FunctionName; edits: Edit[] };

const bug = (fn: FunctionName, from: string, to: string): Bug => ({ fn, edits: [{ from, to }] });

/** The function finding a habit the coach deleted, as though it were not. */
const deletedGuard = (fn: FunctionName): Bug =>
  bug(
    fn,
    "   WHERE id = p_habit_id AND client_id = p_client_id AND deleted_at IS NULL\n   FOR UPDATE;",
    "   WHERE id = p_habit_id AND client_id = p_client_id\n   FOR UPDATE;"
  );

/** A pg_temp copy of the function with one rule taken out, and its name. */
function plantedCopy(tag: string, planted: Bug): { sql: string; name: string } {
  let text = functionText(planted.fn);
  for (const edit of planted.edits) {
    const count = text.split(edit.from).length - 1;
    if (count !== 1) throw new Error(`${tag}: the planted bug's anchor occurs ${count} times in ${planted.fn}`);
    text = text.replace(edit.from, edit.to);
  }
  const name = `pg_temp.${planted.fn}_${tag.toLowerCase()}`;
  return { name, sql: text.replace(CREATE_FUNCTION, `CREATE FUNCTION ${name}(`) };
}

type Rule = {
  id: string;
  says: string;
  fn: FunctionName;
  /** The check as PL/pgSQL statements: `fn` is the function under test; sets `ok` and `msg`. */
  check: (fn: string) => string;
  bug: Bug;
};

const days = (weekdays: string[]) =>
  weekdays.length === 0 ? "'{}'::text[]" : `ARRAY[${weekdays.map((d) => `'${d}'`).join(", ")}]::text[]`;
const sqlValue = (value: string | number | null) =>
  value === null ? "NULL" : typeof value === "number" ? String(value) : `'${value}'`;

const habit = (
  client: string,
  id: string,
  name: string,
  measure: "tick" | "number" = "tick",
  position = 1
) =>
  `PERFORM pg_temp.put_habit('${client}', '${id}', '${name}', '${measure}', ${position});`;

const version = (
  habitId: string,
  startsOn: string,
  endsOn: string | null,
  target: number | null,
  weekdays: string[],
  timesPerWeek: number | null = null
) =>
  `v_id := pg_temp.put_version('${habitId}', '${startsOn}', ${sqlValue(endsOn)}, ${sqlValue(target)}, ${sqlValue(timesPerWeek)}, ${days(weekdays)});`;

const dayEdit = (habitId: string, date: string, planned: boolean, target: number | null = null) =>
  `PERFORM pg_temp.put_edit('${habitId}', '${date}', ${planned}, ${sqlValue(target)});`;

const entry = (habitId: string, client: string, date: string) =>
  `PERFORM pg_temp.put_entry('${habitId}', '${client}', '${date}', true, NULL);`;

/** A habit the coach has deleted: the mark alone, whatever its versions and entries. */
const markDeleted = (habitId: string) =>
  `UPDATE public.client_habits SET deleted_at = '2026-10-06T09:00:00Z' WHERE id = '${habitId}';`;

const remove = (fn: string, habitId: string, client = C) =>
  `${fn}(p_habit_id => '${habitId}', p_client_id => '${client}', p_today => '${TODAY}')`;

/** Every call must be refused with `code`; `ok` is whether all were. */
const refusals = (calls: string[], code: string) =>
  `ok := true;` +
  calls
    .map(
      (call) => `
  BEGIN
    PERFORM ${call};
    ok := false; msg := 'written, not refused: ${call.replace(/'/g, "''").slice(0, 120)}';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '${code}:%' THEN ok := false; msg := SQLERRM; END IF;
  END;`
    )
    .join("");

const refusal = (call: string, code: string) => refusals([call], code);

/** The habit's versions, oldest first: [starts, ends, target, times a week, weekdays Mon..Sun]. */
const versionsOf = (habitId: string) => `pg_temp.versions('${habitId}')`;
/** The habit's one-date edits, by date: [date, planned, target]. */
const editsOf = (habitId: string) => `pg_temp.edits('${habitId}')`;

const expectVersions = (habitId: string, expected: unknown[][]) =>
  `${versionsOf(habitId)} = '${JSON.stringify(expected)}'::jsonb`;
const expectEdits = (habitId: string, expected: unknown[][]) =>
  `${editsOf(habitId)} = '${JSON.stringify(expected)}'::jsonb`;

const change = (fn: string, habitId: string, startsOn: string, args: string) =>
  `${fn}(p_habit_id => '${habitId}', p_client_id => '${C}', p_today => '${TODAY}', p_starts_on => '${startsOn}', ${args})`;
const setDay = (fn: string, habitId: string, date: string, args: string) =>
  `${fn}(p_habit_id => '${habitId}', p_client_id => '${C}', p_today => '${TODAY}', p_date => '${date}', ${args})`;

const RULES: Rule[] = [
  // ---- add_client_habits ---------------------------------------------------
  {
    id: "A1",
    says: "a habit can't start before today",
    fn: "add_client_habits",
    check: (fn) =>
      refusal(
        `${fn}(p_client_id => '${C}', p_today => '${TODAY}', p_starts_on => '2026-10-06', p_habits => '[{"name": "Walk", "measure": "tick", "weekdays": ["monday"]}]'::jsonb)`,
        "starts_in_past"
      ),
    bug: bug("add_client_habits", "  IF p_starts_on < p_today THEN\n    RAISE EXCEPTION 'starts_in_past: a habit starts today or later';\n  END IF;\n", ""),
  },
  {
    id: "A2",
    says: "a number habit needs a target",
    fn: "add_client_habits",
    check: (fn) =>
      refusal(
        `${fn}(p_client_id => '${C}', p_today => '${TODAY}', p_starts_on => '${TODAY}', p_habits => '[{"name": "Water", "measure": "number", "unit": "L", "direction": "at_least", "weekdays": ["monday"]}]'::jsonb)`,
        "target_required"
      ),
    bug: bug(
      "add_client_habits",
      "    IF v_habit->>'measure' = 'number' AND v_target IS NULL THEN\n      RAISE EXCEPTION 'target_required: a number habit has a target';\n    END IF;\n",
      ""
    ),
  },
  {
    id: "A3",
    says: "a tick habit takes no target",
    fn: "add_client_habits",
    check: (fn) =>
      refusal(
        `${fn}(p_client_id => '${C}', p_today => '${TODAY}', p_starts_on => '${TODAY}', p_habits => '[{"name": "Walk", "measure": "tick", "target": 3, "weekdays": ["monday"]}]'::jsonb)`,
        "target_not_allowed"
      ),
    bug: bug(
      "add_client_habits",
      "    IF v_habit->>'measure' = 'tick' AND v_target IS NOT NULL THEN\n      RAISE EXCEPTION 'target_not_allowed: a tick habit has no target';\n    END IF;\n",
      ""
    ),
  },
  {
    id: "A4",
    says: "habits are appended to the list in the order given, each from the start day with its days",
    fn: "add_client_habits",
    check: (fn) =>
      habit(C, H1, "Existing") +
      `
  v_ids := ${fn}(p_client_id => '${C}', p_today => '${TODAY}', p_starts_on => '2026-10-12', p_habits => '[
    {"name": " Water ", "how_to": "A glass with each meal", "measure": "number", "unit": "L", "direction": "at_least", "target": 3, "weekdays": ["friday", "monday", "wednesday"]},
    {"name": "Sauna", "measure": "tick", "times_per_week": 3}
  ]'::jsonb);
  v_after := (SELECT jsonb_agg(jsonb_build_array(h.name, h.position, h.how_to, h.unit, h.direction) ORDER BY h.position)
                FROM public.client_habits h WHERE h.client_id = '${C}');
  msg := v_after::text || ' ' || pg_temp.versions(v_ids[1])::text;
  ok := v_after = '[["Existing", 1, null, null, null], ["Water", 2, "A glass with each meal", "L", "at_least"], ["Sauna", 3, null, null, null]]'::jsonb
        AND v_ids[1] = (SELECT id FROM public.client_habits WHERE client_id = '${C}' AND name = 'Water')
        AND pg_temp.versions(v_ids[1]) = '[["2026-10-12", null, 3, null, ["monday", "wednesday", "friday"]]]'::jsonb
        AND pg_temp.versions(v_ids[2]) = '[["2026-10-12", null, null, 3, []]]'::jsonb;`,
    bug: bug("add_client_habits", "ORDER BY e.n\n  LOOP", "ORDER BY e.n DESC\n  LOOP"),
  },
  {
    id: "A5",
    says: "a habit runs on chosen weekdays or a number of times a week, not both",
    fn: "add_client_habits",
    check: (fn) =>
      refusal(
        `${fn}(p_client_id => '${C}', p_today => '${TODAY}', p_starts_on => '${TODAY}', p_habits => '[{"name": "Walk", "measure": "tick", "times_per_week": 3, "weekdays": ["monday"]}]'::jsonb)`,
        "invalid_args"
      ),
    bug: bug(
      "add_client_habits",
      "    IF (v_times IS NULL) = (cardinality(v_weekdays) = 0) THEN\n      RAISE EXCEPTION 'invalid_args: a habit runs on chosen weekdays or a number of times a week';\n    END IF;\n",
      ""
    ),
  },

  // ---- change_client_habit -------------------------------------------------
  {
    id: "C1",
    says: "a change can't start before today",
    fn: "change_client_habit",
    check: (fn) =>
      habit(C, H1, "Walk") +
      version(H1, "2026-09-01", null, null, EVERY_DAY) +
      refusal(change(fn, H1, "2026-10-06", `p_weekdays => ${days(["monday"])}`), "starts_in_past"),
    bug: bug("change_client_habit", "  IF p_starts_on < p_today THEN\n    RAISE EXCEPTION 'starts_in_past: a change starts today or later';\n  END IF;\n", ""),
  },
  {
    id: "C2",
    says: "the version running the day before ends then, and the change runs on from its day",
    fn: "change_client_habit",
    check: (fn) =>
      habit(C, H1, "Water", "number") +
      version(H1, "2026-09-01", null, 3, EVERY_DAY) +
      `
  v_changed := ${change(fn, H1, "2026-10-12", `p_target => 3.5, p_weekdays => ${days(EVERY_DAY)}`)};
  msg := ${versionsOf(H1)}::text;
  ok := v_changed AND ${expectVersions(H1, [["2026-09-01", "2026-10-11", 3, null, EVERY_DAY], ["2026-10-12", null, 3.5, null, EVERY_DAY]])};`,
    bug: bug(
      "change_client_habit",
      "      UPDATE client_habit_versions SET ends_on = p_starts_on - 1 WHERE id = v_covering.id;",
      "      UPDATE client_habit_versions SET ends_on = p_starts_on - 2 WHERE id = v_covering.id;"
    ),
  },
  {
    id: "C3",
    says: "a change on a version's first day replaces it",
    fn: "change_client_habit",
    check: (fn) =>
      habit(C, H1, "Water", "number") +
      version(H1, "2026-10-12", null, 3, EVERY_DAY) +
      `
  v_changed := ${change(fn, H1, "2026-10-12", `p_target => 4, p_weekdays => ${days(EVERY_DAY)}`)};
  msg := ${versionsOf(H1)}::text;
  ok := v_changed AND ${expectVersions(H1, [["2026-10-12", null, 4, null, EVERY_DAY]])}
        AND NOT EXISTS (SELECT 1 FROM public.client_habit_versions WHERE id = v_id);`,
    bug: bug("change_client_habit", "    IF v_covering.starts_on = p_starts_on THEN", "    IF false THEN"),
  },
  {
    id: "C4",
    says: "a version queued after the change stands, and the change ends the day before it",
    fn: "change_client_habit",
    check: (fn) =>
      habit(C, H1, "Water", "number") +
      version(H1, "2026-09-01", "2026-10-18", 3, EVERY_DAY) +
      version(H1, "2026-10-19", null, 5, EVERY_DAY) +
      `
  v_changed := ${change(fn, H1, "2026-10-12", `p_target => 4, p_weekdays => ${days(EVERY_DAY)}`)};
  msg := ${versionsOf(H1)}::text;
  ok := v_changed AND ${expectVersions(H1, [
    ["2026-09-01", "2026-10-11", 3, null, EVERY_DAY],
    ["2026-10-12", "2026-10-18", 4, null, EVERY_DAY],
    ["2026-10-19", null, 5, null, EVERY_DAY],
  ])};`,
    bug: bug("change_client_habit", "    v_end := v_covering.ends_on;", "    v_end := NULL;"),
  },
  {
    id: "C5",
    says: "starting a stopped habit again is a version after the gap, on the same habit, until the next version",
    fn: "change_client_habit",
    check: (fn) =>
      habit(C, H1, "Mobility") +
      version(H1, "2026-09-01", "2026-10-04", null, MON_WED_FRI) +
      version(H1, "2026-10-26", null, null, [], 3) +
      `
  v_changed := ${change(fn, H1, "2026-10-12", `p_weekdays => ${days(["thursday", "tuesday"])}`)};
  msg := ${versionsOf(H1)}::text;
  ok := v_changed AND ${expectVersions(H1, [
    ["2026-09-01", "2026-10-04", null, null, MON_WED_FRI],
    ["2026-10-12", "2026-10-25", null, null, ["tuesday", "thursday"]],
    ["2026-10-26", null, null, 3, []],
  ])}
        AND (SELECT count(*) FROM public.client_habits WHERE client_id = '${C}') = 1;`,
    bug: bug("change_client_habit", "    SELECT starts_on - 1 INTO v_end", "    SELECT NULL::DATE INTO v_end"),
  },
  {
    id: "C6",
    says: "a stop dated ahead stands through a change before it",
    fn: "change_client_habit",
    check: (fn) =>
      habit(C, H1, "Water", "number") +
      version(H1, "2026-09-01", "2026-11-01", 3, EVERY_DAY) +
      `
  v_changed := ${change(fn, H1, "2026-10-12", `p_target => 4, p_weekdays => ${days(EVERY_DAY)}`)};
  msg := ${versionsOf(H1)}::text;
  ok := v_changed AND ${expectVersions(H1, [
    ["2026-09-01", "2026-10-11", 3, null, EVERY_DAY],
    ["2026-10-12", "2026-11-01", 4, null, EVERY_DAY],
  ])};`,
    bug: bug("change_client_habit", "    v_end := v_covering.ends_on;", "    v_end := NULL;"),
  },
  {
    id: "C7",
    says: "a change that changes nothing writes nothing",
    fn: "change_client_habit",
    check: (fn) =>
      habit(C, H1, "Water", "number") +
      version(H1, "2026-09-01", null, 3, EVERY_DAY) +
      `
  v_before := (SELECT jsonb_agg(ctid::text ORDER BY starts_on) FROM public.client_habit_versions WHERE client_habit_id = '${H1}');
  v_changed := ${change(fn, H1, "2026-10-12", `p_target => 3, p_weekdays => ${days(["sunday", ...EVERY_DAY])}`)};
  v_after := (SELECT jsonb_agg(ctid::text ORDER BY starts_on) FROM public.client_habit_versions WHERE client_habit_id = '${H1}');
  msg := 'changed: ' || v_changed || ' ' || v_before::text || ' -> ' || v_after::text;
  ok := NOT v_changed AND v_after = v_before;`,
    bug: bug("change_client_habit", "         = v_weekdays THEN\n    RETURN false;", "         = v_weekdays AND false THEN\n    RETURN false;"),
  },
  {
    id: "C8",
    says: "a change back to the version before leaves no copy of it",
    fn: "change_client_habit",
    check: (fn) =>
      habit(C, H1, "Water", "number") +
      version(H1, "2026-09-01", "2026-10-11", 3, EVERY_DAY) +
      version(H1, "2026-10-12", null, 4, EVERY_DAY) +
      `
  v_changed := ${change(fn, H1, "2026-10-12", `p_target => 3, p_weekdays => ${days(EVERY_DAY)}`)};
  msg := ${versionsOf(H1)}::text;
  ok := v_changed AND ${expectVersions(H1, [["2026-09-01", null, 3, null, EVERY_DAY]])};`,
    bug: bug("change_client_habit", "  v_prev_same := v_prev.id IS NOT NULL", "  v_prev_same := false AND v_prev.id IS NOT NULL"),
  },
  {
    id: "C9",
    says: "a queued change brought forward moves that version's start rather than copying it",
    fn: "change_client_habit",
    check: (fn) =>
      habit(C, H1, "Water", "number") +
      version(H1, "2026-09-01", "2026-10-18", 3, EVERY_DAY) +
      version(H1, "2026-10-19", null, 4, EVERY_DAY) +
      `
  v_changed := ${change(fn, H1, "2026-10-12", `p_target => 4, p_weekdays => ${days(EVERY_DAY)}`)};
  msg := ${versionsOf(H1)}::text;
  ok := v_changed AND ${expectVersions(H1, [["2026-09-01", "2026-10-11", 3, null, EVERY_DAY], ["2026-10-12", null, 4, null, EVERY_DAY]])};`,
    bug: bug("change_client_habit", "  v_next_same := v_next.id IS NOT NULL", "  v_next_same := false AND v_next.id IS NOT NULL"),
  },
  {
    id: "C10",
    says: "a number habit keeps a target through a change",
    fn: "change_client_habit",
    check: (fn) =>
      habit(C, H1, "Water", "number") +
      version(H1, "2026-09-01", null, 3, EVERY_DAY) +
      refusal(change(fn, H1, "2026-10-12", `p_weekdays => ${days(EVERY_DAY)}`), "target_required"),
    bug: bug(
      "change_client_habit",
      "  IF v_habit.measure = 'number' AND p_target IS NULL THEN\n    RAISE EXCEPTION 'target_required: a number habit has a target';\n  END IF;\n",
      ""
    ),
  },
  {
    id: "C11",
    says: "a change to N times a week removes the one-date edits in the days it covers",
    fn: "change_client_habit",
    check: (fn) =>
      habit(C, H1, "Mobility") +
      version(H1, "2026-09-01", null, null, EVERY_DAY) +
      dayEdit(H1, "2026-10-09", false) +
      dayEdit(H1, "2026-10-14", false) +
      `
  v_changed := ${change(fn, H1, "2026-10-12", "p_times_per_week => 3")};
  msg := ${editsOf(H1)}::text;
  ok := v_changed AND ${expectEdits(H1, [["2026-10-09", false, null]])};`,
    bug: bug(
      "change_client_habit",
      "  IF p_times_per_week IS NOT NULL THEN\n    DELETE FROM client_habit_day_edits\n     WHERE client_habit_id = p_habit_id\n       AND date >= p_starts_on\n       AND (v_end IS NULL OR date <= v_end);\n  END IF;\n",
      ""
    ),
  },
  {
    id: "C12",
    says: "another client's habit is not found, and stays",
    fn: "change_client_habit",
    check: (fn) =>
      habit(OTHER, H2, "Walk") +
      version(H2, "2026-09-01", null, null, EVERY_DAY) +
      refusal(change(fn, H2, "2026-10-12", "p_times_per_week => 2"), "not_found") +
      `\n  ok := ok AND ${expectVersions(H2, [["2026-09-01", null, null, null, EVERY_DAY]])};`,
    bug: bug(
      "change_client_habit",
      "   WHERE id = p_habit_id AND client_id = p_client_id AND deleted_at IS NULL\n   FOR UPDATE;",
      "   WHERE id = p_habit_id AND deleted_at IS NULL\n   FOR UPDATE;"
    ),
  },

  {
    id: "C13",
    says: "a tick habit takes no target through a change",
    fn: "change_client_habit",
    check: (fn) =>
      habit(C, H1, "Walk") +
      version(H1, "2026-09-01", null, null, EVERY_DAY) +
      refusal(change(fn, H1, "2026-10-12", `p_target => 2, p_weekdays => ${days(EVERY_DAY)}`), "target_not_allowed"),
    bug: bug(
      "change_client_habit",
      "  IF v_habit.measure = 'tick' AND p_target IS NOT NULL THEN\n    RAISE EXCEPTION 'target_not_allowed: a tick habit has no target';\n  END IF;\n",
      ""
    ),
  },
  {
    id: "C14",
    says: "a change runs on chosen weekdays or a number of times a week, not both and not neither",
    fn: "change_client_habit",
    check: (fn) =>
      habit(C, H1, "Walk") +
      version(H1, "2026-09-01", null, null, EVERY_DAY) +
      refusals(
        [
          change(fn, H1, "2026-10-12", `p_times_per_week => 3, p_weekdays => ${days(["monday"])}`),
          change(fn, H1, "2026-10-12", "p_created_by => NULL"),
        ],
        "invalid_args"
      ),
    bug: bug(
      "change_client_habit",
      "  IF (p_times_per_week IS NULL) = (cardinality(v_weekdays) = 0) THEN\n    RAISE EXCEPTION 'invalid_args: a habit runs on chosen weekdays or a number of times a week';\n  END IF;\n",
      ""
    ),
  },
  {
    id: "C15",
    says: "a deleted habit is not found, and never starts again",
    fn: "change_client_habit",
    check: (fn) =>
      habit(C, H1, "Walk") +
      version(H1, "2026-09-01", "2026-10-06", null, EVERY_DAY) +
      markDeleted(H1) +
      refusal(change(fn, H1, TODAY, `p_weekdays => ${days(EVERY_DAY)}`), "not_found") +
      `\n  ok := ok AND ${expectVersions(H1, [["2026-09-01", "2026-10-06", null, null, EVERY_DAY]])};`,
    bug: deletedGuard("change_client_habit"),
  },

  // ---- stop_client_habit ---------------------------------------------------
  {
    id: "S1",
    says: "a habit can't stop before today",
    fn: "stop_client_habit",
    check: (fn) =>
      habit(C, H1, "Walk") +
      version(H1, "2026-09-01", null, null, EVERY_DAY) +
      refusal(`${fn}(p_habit_id => '${H1}', p_client_id => '${C}', p_today => '${TODAY}', p_stops_on => '2026-10-06')`, "stops_in_past"),
    bug: bug("stop_client_habit", "  IF p_stops_on < p_today THEN\n    RAISE EXCEPTION 'stops_in_past: a habit stops today or later';\n  END IF;\n", ""),
  },
  {
    id: "S2",
    says: "a stop ends the running version the day before and removes what is queued after it",
    fn: "stop_client_habit",
    check: (fn) =>
      habit(C, H1, "Walk") +
      version(H1, "2026-09-01", "2026-10-18", null, EVERY_DAY) +
      version(H1, "2026-10-19", null, null, [], 3) +
      `
  v_changed := ${fn}(p_habit_id => '${H1}', p_client_id => '${C}', p_today => '${TODAY}', p_stops_on => '2026-10-14');
  msg := ${versionsOf(H1)}::text;
  ok := v_changed AND ${expectVersions(H1, [["2026-09-01", "2026-10-13", null, null, EVERY_DAY]])};`,
    bug: bug("stop_client_habit", "  DELETE FROM client_habit_versions\n   WHERE client_habit_id = p_habit_id AND starts_on >= p_stops_on;\n", ""),
  },
  {
    id: "S3",
    says: "a stop removes the one-date edits from its day",
    fn: "stop_client_habit",
    check: (fn) =>
      habit(C, H1, "Walk") +
      version(H1, "2026-09-01", null, null, EVERY_DAY) +
      dayEdit(H1, "2026-10-09", false) +
      dayEdit(H1, "2026-10-16", false) +
      `
  PERFORM ${fn}(p_habit_id => '${H1}', p_client_id => '${C}', p_today => '${TODAY}', p_stops_on => '2026-10-14');
  msg := ${editsOf(H1)}::text;
  ok := ${expectEdits(H1, [["2026-10-09", false, null]])};`,
    bug: bug("stop_client_habit", "  DELETE FROM client_habit_day_edits\n   WHERE client_habit_id = p_habit_id AND date >= p_stops_on;\n", ""),
  },
  {
    id: "S4",
    says: "stopping a habit that is not running from that day writes nothing",
    fn: "stop_client_habit",
    check: (fn) =>
      habit(C, H1, "Walk") +
      version(H1, "2026-09-01", "2026-10-04", null, EVERY_DAY) +
      `
  v_before := (SELECT jsonb_agg(ctid::text) FROM public.client_habit_versions WHERE client_habit_id = '${H1}');
  v_changed := ${fn}(p_habit_id => '${H1}', p_client_id => '${C}', p_today => '${TODAY}', p_stops_on => '2026-10-12');
  v_after := (SELECT jsonb_agg(ctid::text) FROM public.client_habit_versions WHERE client_habit_id = '${H1}');
  msg := 'changed: ' || v_changed;
  ok := NOT v_changed AND v_after = v_before;`,
    bug: bug("stop_client_habit", "  ) THEN\n    RETURN false;\n  END IF;", "  ) AND false THEN\n    RETURN false;\n  END IF;"),
  },
  {
    id: "S5",
    says: "another client's habit is not found, and keeps running",
    fn: "stop_client_habit",
    check: (fn) =>
      habit(OTHER, H2, "Walk") +
      version(H2, "2026-09-01", null, null, EVERY_DAY) +
      refusal(`${fn}(p_habit_id => '${H2}', p_client_id => '${C}', p_today => '${TODAY}', p_stops_on => '2026-10-12')`, "not_found") +
      `\n  ok := ok AND ${expectVersions(H2, [["2026-09-01", null, null, null, EVERY_DAY]])};`,
    bug: bug(
      "stop_client_habit",
      "   WHERE id = p_habit_id AND client_id = p_client_id AND deleted_at IS NULL\n   FOR UPDATE;",
      "   WHERE id = p_habit_id AND deleted_at IS NULL\n   FOR UPDATE;"
    ),
  },

  {
    id: "S6",
    says: "a deleted habit is not found",
    fn: "stop_client_habit",
    check: (fn) =>
      habit(C, H1, "Walk") +
      version(H1, "2026-09-01", null, null, EVERY_DAY) +
      markDeleted(H1) +
      refusal(`${fn}(p_habit_id => '${H1}', p_client_id => '${C}', p_today => '${TODAY}', p_stops_on => '2026-10-12')`, "not_found") +
      `\n  ok := ok AND ${expectVersions(H1, [["2026-09-01", null, null, null, EVERY_DAY]])};`,
    bug: deletedGuard("stop_client_habit"),
  },

  // ---- delete_client_habit -------------------------------------------------
  {
    id: "D1",
    says: "a habit with entries is kept when deleted: marked deleted, its entries and its past versions untouched",
    fn: "delete_client_habit",
    check: (fn) =>
      habit(C, H1, "Walk") +
      version(H1, "2026-09-01", null, null, EVERY_DAY) +
      entry(H1, C, "2026-10-05") +
      `
  PERFORM ${remove(fn, H1)};
  msg := ${versionsOf(H1)}::text || ' deleted_at: ' || coalesce((SELECT deleted_at::text FROM public.client_habits WHERE id = '${H1}'), 'none');
  ok := EXISTS (SELECT 1 FROM public.client_habits WHERE id = '${H1}' AND deleted_at IS NOT NULL)
        AND (SELECT count(*) FROM public.client_habit_logs WHERE client_habit_id = '${H1}' AND date = '2026-10-05' AND done) = 1
        AND ${expectVersions(H1, [["2026-09-01", "2026-10-06", null, null, EVERY_DAY]])};`,
    bug: bug(
      "delete_client_habit",
      "  UPDATE client_habits SET deleted_at = NOW() WHERE id = p_habit_id AND client_id = p_client_id;",
      "  PERFORM 1;"
    ),
  },
  {
    id: "D2",
    says: "a habit with no entries is removed with its versions and one-date edits",
    fn: "delete_client_habit",
    check: (fn) =>
      habit(C, H1, "Walk") +
      version(H1, "2026-09-01", null, null, EVERY_DAY) +
      dayEdit(H1, "2026-10-14", false) +
      `
  PERFORM ${remove(fn, H1)};
  ok := NOT EXISTS (SELECT 1 FROM public.client_habits WHERE id = '${H1}')
        AND NOT EXISTS (SELECT 1 FROM public.client_habit_versions WHERE client_habit_id = '${H1}')
        AND NOT EXISTS (SELECT 1 FROM public.client_habit_day_edits WHERE client_habit_id = '${H1}');
  msg := 'habit, versions or edits left';`,
    bug: bug("delete_client_habit", "  DELETE FROM client_habits WHERE id = p_habit_id AND client_id = p_client_id;", "  PERFORM 1;"),
  },
  {
    id: "D3",
    says: "another client's habit is not found, and stays",
    fn: "delete_client_habit",
    check: (fn) =>
      habit(OTHER, H2, "Walk") +
      refusal(remove(fn, H2), "not_found") +
      `\n  ok := ok AND EXISTS (SELECT 1 FROM public.client_habits WHERE id = '${H2}');`,
    bug: {
      fn: "delete_client_habit",
      edits: [
        { from: "   WHERE id = p_habit_id AND client_id = p_client_id AND deleted_at IS NULL\n   FOR UPDATE;", to: "   WHERE id = p_habit_id AND deleted_at IS NULL\n   FOR UPDATE;" },
        {
          from: "  DELETE FROM client_habits WHERE id = p_habit_id AND client_id = p_client_id;",
          to: "  DELETE FROM client_habits WHERE id = p_habit_id;",
        },
      ],
    },
  },
  {
    id: "D4",
    says: "a habit with entries is stopped from today when deleted: the running version ends the day before, what is queued and the one-date edits from today go",
    fn: "delete_client_habit",
    check: (fn) =>
      habit(C, H1, "Walk") +
      version(H1, "2026-09-01", "2026-10-18", null, EVERY_DAY) +
      version(H1, "2026-10-19", null, null, [], 3) +
      dayEdit(H1, "2026-10-05", false) +
      dayEdit(H1, "2026-10-09", false) +
      entry(H1, C, "2026-10-06") +
      `
  PERFORM ${remove(fn, H1)};
  msg := ${versionsOf(H1)}::text || ' ' || ${editsOf(H1)}::text;
  ok := ${expectVersions(H1, [["2026-09-01", "2026-10-06", null, null, EVERY_DAY]])}
        AND ${expectEdits(H1, [["2026-10-05", false, null]])};`,
    bug: bug("delete_client_habit", "  PERFORM stop_client_habit(p_habit_id, p_client_id, p_today, p_today);\n", ""),
  },
  {
    id: "D5",
    says: "a deleted habit is not found by another delete, and stays, even once its entries are cleared",
    fn: "delete_client_habit",
    check: (fn) =>
      habit(C, H1, "Walk") +
      version(H1, "2026-09-01", "2026-10-06", null, EVERY_DAY) +
      markDeleted(H1) +
      refusal(remove(fn, H1), "not_found") +
      `\n  ok := ok AND EXISTS (SELECT 1 FROM public.client_habits WHERE id = '${H1}')
        AND ${expectVersions(H1, [["2026-09-01", "2026-10-06", null, null, EVERY_DAY]])};`,
    bug: deletedGuard("delete_client_habit"),
  },

  // ---- rename_client_habit -------------------------------------------------
  {
    id: "R1",
    says: "a habit's name and how-to change; the same labels write nothing",
    fn: "rename_client_habit",
    check: (fn) =>
      habit(C, H1, "Walk") +
      `
  v_changed := ${fn}(p_habit_id => '${H1}', p_client_id => '${C}', p_name => ' Evening walk ', p_how_to => 'After dinner');
  ok := v_changed AND (SELECT name = 'Evening walk' AND how_to = 'After dinner' FROM public.client_habits WHERE id = '${H1}');
  v_changed := ${fn}(p_habit_id => '${H1}', p_client_id => '${C}', p_name => 'Evening walk', p_how_to => 'After dinner');
  ok := ok AND NOT v_changed;
  msg := 'second rename changed: ' || v_changed;`,
    bug: bug("rename_client_habit", "  IF v_habit.name = btrim(p_name)", "  IF false AND v_habit.name = btrim(p_name)"),
  },
  {
    id: "R2",
    says: "another client's habit is not found, and keeps its name",
    fn: "rename_client_habit",
    check: (fn) =>
      habit(OTHER, H2, "Walk") +
      refusal(`${fn}(p_habit_id => '${H2}', p_client_id => '${C}', p_name => 'Renamed')`, "not_found") +
      `\n  ok := ok AND (SELECT name = 'Walk' FROM public.client_habits WHERE id = '${H2}');`,
    bug: bug(
      "rename_client_habit",
      "   WHERE id = p_habit_id AND client_id = p_client_id AND deleted_at IS NULL\n   FOR UPDATE;",
      "   WHERE id = p_habit_id AND deleted_at IS NULL\n   FOR UPDATE;"
    ),
  },
  {
    id: "R3",
    says: "a deleted habit is not found, and keeps its name",
    fn: "rename_client_habit",
    check: (fn) =>
      habit(C, H1, "Walk") +
      markDeleted(H1) +
      refusal(`${fn}(p_habit_id => '${H1}', p_client_id => '${C}', p_name => 'Renamed')`, "not_found") +
      `\n  ok := ok AND (SELECT name = 'Walk' FROM public.client_habits WHERE id = '${H1}');`,
    bug: deletedGuard("rename_client_habit"),
  },

  // ---- order_client_habits -------------------------------------------------
  {
    id: "O1",
    says: "the order names every one of the client's habits, once",
    fn: "order_client_habits",
    check: (fn) =>
      habit(C, H1, "Walk", "tick", 1) +
      habit(C, H2, "Water", "number", 2) +
      habit(C, H3, "Sauna", "tick", 3) +
      habit(OTHER, H4, "Read", "tick", 1) +
      refusals(
        [
          `${fn}(p_client_id => '${C}', p_habit_ids => ARRAY['${H2}', '${H1}']::uuid[])`,
          `${fn}(p_client_id => '${C}', p_habit_ids => ARRAY['${H2}', '${H1}', '${H4}']::uuid[])`,
          `${fn}(p_client_id => '${C}', p_habit_ids => ARRAY['${H2}', '${H1}', '${H1}']::uuid[])`,
        ],
        "order_mismatch"
      ),
    bug: bug(
      "order_client_habits",
      "  IF cardinality(p_habit_ids) <> cardinality(v_current)\n     OR (SELECT count(DISTINCT h) FROM unnest(p_habit_ids) AS h) <> cardinality(p_habit_ids)\n     OR EXISTS (SELECT 1 FROM unnest(p_habit_ids) AS h WHERE h IS NULL OR NOT (h = ANY (v_current))) THEN\n    RAISE EXCEPTION 'order_mismatch: the order names every one of the client''s habits, once';\n  END IF;\n",
      ""
    ),
  },
  {
    id: "O2",
    says: "the habits take the order given; the same order writes nothing",
    fn: "order_client_habits",
    check: (fn) =>
      habit(C, H1, "Walk", "tick", 1) +
      habit(C, H2, "Water", "number", 2) +
      habit(C, H3, "Sauna", "tick", 3) +
      `
  v_changed := ${fn}(p_client_id => '${C}', p_habit_ids => ARRAY['${H3}', '${H1}', '${H2}']::uuid[]);
  v_after := (SELECT jsonb_agg(id ORDER BY position) FROM public.client_habits WHERE client_id = '${C}');
  ok := v_changed AND v_after = '["${H3}", "${H1}", "${H2}"]'::jsonb;
  v_changed := ${fn}(p_client_id => '${C}', p_habit_ids => ARRAY['${H3}', '${H1}', '${H2}']::uuid[]);
  ok := ok AND NOT v_changed;
  msg := v_after::text || ' second changed: ' || v_changed;`,
    bug: bug("order_client_habits", "  IF v_current = p_habit_ids THEN\n    RETURN false;", "  IF false THEN\n    RETURN false;"),
  },
  {
    id: "O3",
    says: "the order counts the client's habits without a deleted one: naming it is refused, the rest take their order",
    fn: "order_client_habits",
    check: (fn) =>
      habit(C, H1, "Walk", "tick", 1) +
      habit(C, H2, "Water", "number", 2) +
      habit(C, H3, "Sauna", "tick", 3) +
      markDeleted(H2) +
      refusal(`${fn}(p_client_id => '${C}', p_habit_ids => ARRAY['${H3}', '${H2}', '${H1}']::uuid[])`, "order_mismatch") +
      `
  v_changed := ${fn}(p_client_id => '${C}', p_habit_ids => ARRAY['${H3}', '${H1}']::uuid[]);
  v_after := (SELECT jsonb_agg(id ORDER BY position) FROM public.client_habits WHERE client_id = '${C}' AND deleted_at IS NULL);
  ok := ok AND v_changed AND v_after = '["${H3}", "${H1}"]'::jsonb;
  msg := msg || ' ' || coalesce(v_after::text, 'none');`,
    bug: bug(
      "order_client_habits",
      "     WHERE client_id = p_client_id AND deleted_at IS NULL\n",
      "     WHERE client_id = p_client_id\n"
    ),
  },

  // ---- set_client_habit_day ------------------------------------------------
  {
    id: "E1",
    says: "a day before today can't be edited",
    fn: "set_client_habit_day",
    check: (fn) =>
      habit(C, H1, "Walk") +
      version(H1, "2026-09-01", null, null, EVERY_DAY) +
      refusal(setDay(fn, H1, "2026-10-06", "p_planned => false"), "day_in_past"),
    bug: bug("set_client_habit_day", "  IF p_date < p_today THEN\n    RAISE EXCEPTION 'day_in_past: a day before today keeps what it had';\n  END IF;\n", ""),
  },
  {
    id: "E2",
    says: "a day no version covers can't be edited",
    fn: "set_client_habit_day",
    check: (fn) =>
      habit(C, H1, "Walk") +
      version(H1, "2026-09-01", "2026-10-11", null, EVERY_DAY) +
      refusal(setDay(fn, H1, "2026-10-14", "p_planned => true"), "not_running"),
    bug: bug("set_client_habit_day", "  IF NOT FOUND THEN\n    RAISE EXCEPTION 'not_running: the habit is not running on %', p_date;\n  END IF;\n", ""),
  },
  {
    id: "E3",
    says: "a habit done N times a week has no day to edit",
    fn: "set_client_habit_day",
    check: (fn) =>
      habit(C, H1, "Sauna") +
      version(H1, "2026-09-01", null, null, [], 3) +
      refusal(setDay(fn, H1, "2026-10-14", "p_planned => true"), "weekly_version"),
    bug: bug(
      "set_client_habit_day",
      "  IF v_version.times_per_week IS NOT NULL THEN\n    RAISE EXCEPTION 'weekly_version: a habit done a number of times a week plans no particular day';\n  END IF;\n",
      ""
    ),
  },
  {
    id: "E4",
    says: "an edit takes a planned day off or puts a day on at its own target; the version's target is the version's",
    fn: "set_client_habit_day",
    check: (fn) =>
      habit(C, H1, "Water", "number") +
      version(H1, "2026-09-01", null, 3, MON_WED_FRI) +
      `
  PERFORM ${setDay(fn, H1, "2026-10-14", "p_planned => false")};
  PERFORM ${setDay(fn, H1, "2026-10-13", "p_planned => true, p_target => 2.5")};
  PERFORM ${setDay(fn, H1, "2026-10-16", "p_planned => true, p_target => 3")};
  msg := ${editsOf(H1)}::text;
  ok := ${expectEdits(H1, [["2026-10-13", true, 2.5], ["2026-10-14", false, null]])};`,
    bug: bug("set_client_habit_day", "  IF v_target IS NOT DISTINCT FROM v_version.target THEN\n    v_target := NULL;", "  IF false THEN\n    v_target := NULL;"),
  },
  {
    id: "E5",
    says: "a day set back to what its version has leaves no edit",
    fn: "set_client_habit_day",
    check: (fn) =>
      habit(C, H1, "Walk") +
      version(H1, "2026-09-01", null, null, EVERY_DAY) +
      dayEdit(H1, "2026-10-14", false) +
      `
  v_changed := ${setDay(fn, H1, "2026-10-14", "p_planned => true")};
  msg := 'changed: ' || v_changed || ' ' || ${editsOf(H1)}::text;
  ok := v_changed AND ${expectEdits(H1, [])};`,
    bug: bug("set_client_habit_day", "  IF p_planned = v_default_planned AND v_target IS NULL THEN", "  IF false THEN"),
  },
  {
    id: "E6",
    says: "a tick habit's day takes no target",
    fn: "set_client_habit_day",
    check: (fn) =>
      habit(C, H1, "Walk") +
      version(H1, "2026-09-01", null, null, EVERY_DAY) +
      refusal(setDay(fn, H1, "2026-10-14", "p_planned => true, p_target => 2"), "target_not_allowed"),
    bug: bug(
      "set_client_habit_day",
      "  IF v_habit.measure = 'tick' AND p_target IS NOT NULL THEN\n    RAISE EXCEPTION 'target_not_allowed: a tick habit has no target';\n  END IF;\n",
      ""
    ),
  },
  {
    id: "E7",
    says: "an edit set to what it already is writes nothing",
    fn: "set_client_habit_day",
    check: (fn) =>
      habit(C, H1, "Walk") +
      version(H1, "2026-09-01", null, null, EVERY_DAY) +
      dayEdit(H1, "2026-10-14", false) +
      `
  v_before := (SELECT jsonb_agg(ctid::text) FROM public.client_habit_day_edits WHERE client_habit_id = '${H1}');
  v_changed := ${setDay(fn, H1, "2026-10-14", "p_planned => false")};
  v_after := (SELECT jsonb_agg(ctid::text) FROM public.client_habit_day_edits WHERE client_habit_id = '${H1}');
  msg := 'changed: ' || v_changed;
  ok := NOT v_changed AND v_after = v_before;`,
    bug: bug("set_client_habit_day", "  IF FOUND AND v_edit.planned = p_planned", "  IF false AND v_edit.planned = p_planned"),
  },
  {
    id: "E8",
    says: "another client's habit is not found, and gets no edit",
    fn: "set_client_habit_day",
    check: (fn) =>
      habit(OTHER, H2, "Walk") +
      version(H2, "2026-09-01", null, null, EVERY_DAY) +
      refusal(setDay(fn, H2, "2026-10-14", "p_planned => false"), "not_found") +
      `\n  ok := ok AND ${expectEdits(H2, [])};`,
    bug: bug(
      "set_client_habit_day",
      "   WHERE id = p_habit_id AND client_id = p_client_id AND deleted_at IS NULL\n   FOR UPDATE;",
      "   WHERE id = p_habit_id AND deleted_at IS NULL\n   FOR UPDATE;"
    ),
  },
  {
    id: "E9",
    says: "a deleted habit is not found, and gets no edit",
    fn: "set_client_habit_day",
    check: (fn) =>
      habit(C, H1, "Walk") +
      version(H1, "2026-09-01", null, null, EVERY_DAY) +
      markDeleted(H1) +
      refusal(setDay(fn, H1, "2026-10-14", "p_planned => false"), "not_found") +
      `\n  ok := ok AND ${expectEdits(H1, [])};`,
    bug: deletedGuard("set_client_habit_day"),
  },

  // ---- reset_client_habit_day ----------------------------------------------
  {
    id: "X1",
    says: "a day before today can't be reset",
    fn: "reset_client_habit_day",
    check: (fn) =>
      habit(C, H1, "Walk") +
      version(H1, "2026-09-01", null, null, EVERY_DAY) +
      dayEdit(H1, "2026-10-06", false) +
      refusal(`${fn}(p_habit_id => '${H1}', p_client_id => '${C}', p_today => '${TODAY}', p_date => '2026-10-06')`, "day_in_past") +
      `\n  ok := ok AND ${expectEdits(H1, [["2026-10-06", false, null]])};`,
    bug: bug("reset_client_habit_day", "  IF p_date < p_today THEN\n    RAISE EXCEPTION 'day_in_past: a day before today keeps what it had';\n  END IF;\n", ""),
  },
  {
    id: "X2",
    says: "a reset removes the edit, and says whether there was one",
    fn: "reset_client_habit_day",
    check: (fn) =>
      habit(C, H1, "Walk") +
      version(H1, "2026-09-01", null, null, EVERY_DAY) +
      dayEdit(H1, "2026-10-14", false) +
      `
  v_changed := ${fn}(p_habit_id => '${H1}', p_client_id => '${C}', p_today => '${TODAY}', p_date => '2026-10-14');
  ok := v_changed AND ${expectEdits(H1, [])};
  v_changed := ${fn}(p_habit_id => '${H1}', p_client_id => '${C}', p_today => '${TODAY}', p_date => '2026-10-14');
  ok := ok AND NOT v_changed;
  msg := 'second reset changed: ' || v_changed || ' ' || ${editsOf(H1)}::text;`,
    bug: bug(
      "reset_client_habit_day",
      "  DELETE FROM client_habit_day_edits WHERE client_habit_id = p_habit_id AND date = p_date;\n  RETURN FOUND;",
      "  PERFORM 1;\n  RETURN FOUND;"
    ),
  },
  {
    id: "X3",
    says: "another client's habit is not found, and keeps its edit",
    fn: "reset_client_habit_day",
    check: (fn) =>
      habit(OTHER, H2, "Walk") +
      version(H2, "2026-09-01", null, null, EVERY_DAY) +
      dayEdit(H2, "2026-10-14", false) +
      refusal(`${fn}(p_habit_id => '${H2}', p_client_id => '${C}', p_today => '${TODAY}', p_date => '2026-10-14')`, "not_found") +
      `\n  ok := ok AND ${expectEdits(H2, [["2026-10-14", false, null]])};`,
    bug: bug(
      "reset_client_habit_day",
      "   WHERE id = p_habit_id AND client_id = p_client_id AND deleted_at IS NULL\n   FOR UPDATE;",
      "   WHERE id = p_habit_id AND deleted_at IS NULL\n   FOR UPDATE;"
    ),
  },
  {
    id: "X4",
    says: "a deleted habit is not found, and keeps its edit",
    fn: "reset_client_habit_day",
    check: (fn) =>
      habit(C, H1, "Walk") +
      version(H1, "2026-09-01", null, null, EVERY_DAY) +
      dayEdit(H1, "2026-10-14", false) +
      markDeleted(H1) +
      refusal(`${fn}(p_habit_id => '${H1}', p_client_id => '${C}', p_today => '${TODAY}', p_date => '2026-10-14')`, "not_found") +
      `\n  ok := ok AND ${expectEdits(H1, [["2026-10-14", false, null]])};`,
    bug: deletedGuard("reset_client_habit_day"),
  },

  // ---- coach_habit_choices -------------------------------------------------
  {
    id: "Q1",
    says: "the choices hold one row per name and way of measuring, with its newest version's how-to, target and days",
    fn: "coach_habit_choices",
    check: (fn) =>
      choicesFixture() +
      `
  v_after := (SELECT jsonb_agg(jsonb_build_array(q.name, q.how_to, q.measure, q.unit, q.direction, q.target, q.times_per_week, q.weekdays)
                                ORDER BY q.measure)
                FROM ${fn}(p_coach_id => '${PERF_COACH_ID}', p_client_id => '${C}', p_today => '${TODAY}') AS q
               WHERE q.name ILIKE 'proof water%');
  msg := v_after::text;
  ok := v_after = '[["PROOF WATER", "Big bottle", "number", "l", "at_least", 3.25, null, ["monday", "thursday"]],
                    ["Proof water", null, "tick", null, null, null, 4, []]]'::jsonb;`,
    bug: bug("coach_habit_choices", "g.written_at DESC, g.version_id DESC", "g.written_at ASC, g.version_id DESC"),
  },
  {
    id: "Q2",
    says: "the choices never hold another coach's clients' habits",
    fn: "coach_habit_choices",
    check: (fn) =>
      choicesFixture() +
      `
  v_after := (SELECT coalesce(jsonb_agg(q.name), '[]'::jsonb)
                FROM ${fn}(p_coach_id => '${PERF_COACH_ID}', p_client_id => '${C}', p_today => '${TODAY}') AS q
               WHERE q.name ILIKE 'proof%');
  msg := v_after::text;
  ok := NOT (v_after ? 'Proof foreign') AND jsonb_array_length(v_after) = 3;`,
    bug: bug("coach_habit_choices", "     WHERE c.coach_id = p_coach_id\n       AND h.deleted_at IS NULL\n", "     WHERE h.deleted_at IS NULL\n"),
  },
  {
    id: "Q3",
    says: "the choices leave out what this client has running or planned, and keep what it stopped",
    fn: "coach_habit_choices",
    check: (fn) =>
      choicesFixture() +
      `
  v_after := (SELECT coalesce(jsonb_agg(q.name ORDER BY q.name), '[]'::jsonb)
                FROM ${fn}(p_coach_id => '${PERF_COACH_ID}', p_client_id => '${C}', p_today => '${TODAY}') AS q
               WHERE q.name ILIKE 'proof%');
  msg := v_after::text;
  ok := NOT (v_after ? 'Proof run') AND (v_after ? 'Proof stretch');`,
    bug: bug("coach_habit_choices", "   WHERE NOT EXISTS (", "   WHERE true OR NOT EXISTS ("),
  },
  {
    id: "Q4",
    says: "the choices answer for this coach's clients alone: another coach's client is not found",
    fn: "coach_habit_choices",
    check: (fn) =>
      choicesFixture() +
      refusal(`${fn}(p_coach_id => '${PERF_COACH_ID}', p_client_id => '${FOREIGN}', p_today => '${TODAY}')`, "not_found"),
    bug: bug(
      "coach_habit_choices",
      "  IF NOT EXISTS (SELECT 1 FROM clients AS c WHERE c.id = p_client_id AND c.coach_id = p_coach_id) THEN\n    RAISE EXCEPTION 'not_found: client % is not this coach''s', p_client_id;\n  END IF;\n",
      ""
    ),
  },
  {
    id: "Q5",
    says: "the choices leave out a habit the coach deleted",
    fn: "coach_habit_choices",
    check: (fn) =>
      choicesFixture() +
      `
  PERFORM pg_temp.put_habit('${OTHER}', '0a0a0203-0000-4000-8000-0000000000b5', 'Proof gone', 'tick', 6);
  v_id := pg_temp.put_version('0a0a0203-0000-4000-8000-0000000000b5', '2026-09-01', '2026-10-06', NULL, NULL, ${days(EVERY_DAY)});
  ${markDeleted("0a0a0203-0000-4000-8000-0000000000b5")}
  v_after := (SELECT coalesce(jsonb_agg(q.name ORDER BY q.name), '[]'::jsonb)
                FROM ${fn}(p_coach_id => '${PERF_COACH_ID}', p_client_id => '${C}', p_today => '${TODAY}') AS q
               WHERE q.name ILIKE 'proof%');
  msg := v_after::text;
  ok := NOT (v_after ? 'Proof gone') AND (v_after ? 'Proof stretch');`,
    bug: bug("coach_habit_choices", "     WHERE c.coach_id = p_coach_id\n       AND h.deleted_at IS NULL\n", "     WHERE c.coach_id = p_coach_id\n"),
  },
];

/**
 * The reuse fixture. The perf coach's other client holds "Proof water" twice
 * over as a number in litres (written 1 Sep at 2.5 L, then as "PROOF WATER" on
 * 20 Sep at 3.25 L, Mon and Thu), as a tick 4 times a week, "Proof run" and
 * "Proof stretch"; this client runs "Proof run" and stopped "Proof stretch";
 * a client of another coach holds "Proof foreign".
 */
function choicesFixture(): string {
  return `
  PERFORM pg_temp.put_habit('${OTHER}', '${H1}', 'Proof water', 'number', 1);
  v_id := pg_temp.put_version('${H1}', '2026-09-01', '2026-09-19', 2.5, NULL, ${days(EVERY_DAY)});
  UPDATE public.client_habit_versions SET created_at = '2026-09-01T08:00:00Z' WHERE id = v_id;
  INSERT INTO public.client_habits (id, client_id, name, how_to, measure, unit, direction, position)
  VALUES ('${H2}', '${OTHER}', 'PROOF WATER', 'Big bottle', 'number', 'l', 'at_least', 2);
  v_id := pg_temp.put_version('${H2}', '2026-09-20', NULL, 3.25, NULL, ${days(["thursday", "monday"])});
  UPDATE public.client_habit_versions SET created_at = '2026-09-20T08:00:00Z' WHERE id = v_id;
  PERFORM pg_temp.put_habit('${OTHER}', '${H3}', 'Proof water', 'tick', 3);
  v_id := pg_temp.put_version('${H3}', '2026-09-01', NULL, NULL, 4, '{}'::text[]);
  PERFORM pg_temp.put_habit('${OTHER}', '0a0a0203-0000-4000-8000-0000000000b1', 'Proof run', 'tick', 4);
  v_id := pg_temp.put_version('0a0a0203-0000-4000-8000-0000000000b1', '2026-09-01', NULL, NULL, NULL, ${days(EVERY_DAY)});
  PERFORM pg_temp.put_habit('${OTHER}', '0a0a0203-0000-4000-8000-0000000000b2', 'Proof stretch', 'tick', 5);
  v_id := pg_temp.put_version('0a0a0203-0000-4000-8000-0000000000b2', '2026-09-01', NULL, NULL, NULL, ${days(EVERY_DAY)});
  PERFORM pg_temp.put_habit('${C}', '${H4}', 'Proof run', 'tick', 1);
  v_id := pg_temp.put_version('${H4}', '2026-10-12', NULL, NULL, NULL, ${days(MON_WED_FRI)});
  PERFORM pg_temp.put_habit('${C}', '0a0a0203-0000-4000-8000-0000000000b3', 'Proof stretch', 'tick', 2);
  v_id := pg_temp.put_version('0a0a0203-0000-4000-8000-0000000000b3', '2026-09-01', '2026-10-04', NULL, NULL, ${days(EVERY_DAY)});
  PERFORM pg_temp.put_habit('${FOREIGN}', '0a0a0203-0000-4000-8000-0000000000b4', 'Proof foreign', 'tick', 1);
  v_id := pg_temp.put_version('0a0a0203-0000-4000-8000-0000000000b4', '2026-09-01', NULL, NULL, NULL, ${days(EVERY_DAY)});`;
}

const OVERLAP_CHECK =
  habit(C, H1, "Walk") +
  version(H1, "2026-09-01", "2026-10-20", null, EVERY_DAY) +
  `
  BEGIN
    v_id := pg_temp.put_version('${H1}', '2026-10-15', NULL, NULL, NULL, ${days(EVERY_DAY)});
    ok := false; msg := 'an overlapping version was written';
  EXCEPTION WHEN exclusion_violation THEN
    ok := true; msg := SQLERRM;
  END;`;

const FUNCTION_SIGNATURES = [
  "public.add_client_habits(uuid, date, date, jsonb, uuid)",
  "public.change_client_habit(uuid, uuid, date, date, uuid, numeric, integer, text[])",
  "public.stop_client_habit(uuid, uuid, date, date)",
  "public.delete_client_habit(uuid, uuid, date)",
  "public.rename_client_habit(uuid, uuid, text, text)",
  "public.order_client_habits(uuid, uuid[])",
  "public.set_client_habit_day(uuid, uuid, date, date, boolean, uuid, numeric)",
  "public.reset_client_habit_day(uuid, uuid, date, date)",
  "public.coach_habit_choices(uuid, uuid, date)",
];

const PRESCRIPTION_TABLES = [
  "public.client_habits",
  "public.client_habit_versions",
  "public.client_habit_version_days",
  "public.client_habit_day_edits",
];

const GRANT_CHECK = `
  ok := ${[
    ...PRESCRIPTION_TABLES.map((t) => `has_table_privilege('service_role', '${t}', 'SELECT')`),
    ...PRESCRIPTION_TABLES.flatMap((t) =>
      ["INSERT", "UPDATE", "DELETE", "TRUNCATE"].map((p) => `NOT has_table_privilege('service_role', '${t}', '${p}')`)
    ),
    ...["SELECT", "INSERT", "UPDATE", "DELETE"].map(
      (p) => `has_table_privilege('service_role', 'public.client_habit_logs', '${p}')`
    ),
    ...[...PRESCRIPTION_TABLES, "public.client_habit_logs"].flatMap((t) =>
      ["anon", "authenticated"].map((role) => `NOT has_table_privilege('${role}', '${t}', 'SELECT,INSERT,UPDATE,DELETE')`)
    ),
    ...FUNCTION_SIGNATURES.flatMap((sig) => [
      `has_function_privilege('service_role', '${sig}', 'EXECUTE')`,
      `NOT has_function_privilege('anon', '${sig}', 'EXECUTE')`,
      `NOT has_function_privilege('authenticated', '${sig}', 'EXECUTE')`,
    ]),
  ].join("\n    AND ")};
  msg := 'grants';`;

/** One delete: the one taking the client's today. A second would let a caller delete without it. */
const ONE_DELETE_CHECK = `
  v_after := (SELECT jsonb_agg(p.oid::regprocedure::text)
                FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND p.proname = 'delete_client_habit');
  msg := v_after::text;
  ok := v_after = '["delete_client_habit(uuid,uuid,date)"]'::jsonb;`;

function block(rule: string, variant: string, body: string): string {
  return `
DO $proof$
DECLARE
  ok BOOLEAN := false;
  msg TEXT := '';
  v_id UUID;
  v_ids UUID[];
  v_changed BOOLEAN;
  v_before JSONB;
  v_after JSONB;
BEGIN
  PERFORM pg_temp.reset();
  ${body}
  PERFORM pg_temp.record('${rule}', '${variant}', ok, msg);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.record('${rule}', '${variant}', false, 'check failed: ' || SQLERRM);
END
$proof$;`;
}

function buildSql(beforePush: boolean): string {
  const parts: string[] = ["BEGIN;"];
  if (beforePush) parts.push(PENDING_MIGRATION);
  parts.push(
    "CREATE TEMP TABLE proof_results (n SERIAL, rule TEXT, variant TEXT, passed BOOLEAN, detail TEXT);",
    `INSERT INTO public.clients (id, coach_id, name, email) VALUES
      ('${C}', '${PERF_COACH_ID}', 'Habit functions proof', 'habit-functions-proof-a@fixture.local'),
      ('${OTHER}', '${PERF_COACH_ID}', 'Habit functions proof B', 'habit-functions-proof-b@fixture.local'),
      ('${FOREIGN}', (SELECT id FROM public.coaches WHERE id <> '${PERF_COACH_ID}' ORDER BY id LIMIT 1),
       'Habit functions proof C', 'habit-functions-proof-c@fixture.local');`,
    `CREATE FUNCTION pg_temp.reset() RETURNS void LANGUAGE sql AS $$
       DELETE FROM public.client_habit_logs WHERE client_id IN ('${C}', '${OTHER}', '${FOREIGN}');
       DELETE FROM public.client_habits WHERE client_id IN ('${C}', '${OTHER}', '${FOREIGN}');
     $$;`,
    `CREATE FUNCTION pg_temp.put_habit(p_client UUID, p_id UUID, p_name TEXT, p_measure TEXT, p_position INTEGER)
     RETURNS void LANGUAGE sql AS $$
       INSERT INTO public.client_habits (id, client_id, name, measure, unit, direction, position)
       VALUES (p_id, p_client, p_name, p_measure,
               CASE WHEN p_measure = 'number' THEN 'L' END,
               CASE WHEN p_measure = 'number' THEN 'at_least' END,
               p_position);
     $$;`,
    `CREATE FUNCTION pg_temp.put_version(p_habit UUID, p_starts DATE, p_ends DATE, p_target NUMERIC, p_times INTEGER,
                                         p_weekdays TEXT[])
     RETURNS UUID LANGUAGE plpgsql AS $$
     DECLARE v UUID;
     BEGIN
       INSERT INTO public.client_habit_versions (client_habit_id, starts_on, ends_on, target, times_per_week)
       VALUES (p_habit, p_starts, p_ends, p_target, p_times)
       RETURNING id INTO v;
       INSERT INTO public.client_habit_version_days (version_id, weekday) SELECT v, d FROM unnest(p_weekdays) AS d;
       RETURN v;
     END;
     $$;`,
    `CREATE FUNCTION pg_temp.put_edit(p_habit UUID, p_date DATE, p_planned BOOLEAN, p_target NUMERIC) RETURNS void LANGUAGE sql AS $$
       INSERT INTO public.client_habit_day_edits (client_habit_id, date, planned, target) VALUES (p_habit, p_date, p_planned, p_target);
     $$;`,
    `CREATE FUNCTION pg_temp.put_entry(p_habit UUID, p_client UUID, p_date DATE, p_done BOOLEAN, p_value NUMERIC) RETURNS void LANGUAGE sql AS $$
       INSERT INTO public.client_habit_logs (client_habit_id, client_id, date, done, value) VALUES (p_habit, p_client, p_date, p_done, p_value);
     $$;`,
    `CREATE FUNCTION pg_temp.versions(p_habit UUID) RETURNS jsonb LANGUAGE sql AS $$
       SELECT coalesce(jsonb_agg(jsonb_build_array(
                v.starts_on, v.ends_on, v.target, v.times_per_week,
                (SELECT coalesce(jsonb_agg(d.weekday ORDER BY array_position(
                          ARRAY['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'], d.weekday)), '[]'::jsonb)
                   FROM public.client_habit_version_days d WHERE d.version_id = v.id)
              ) ORDER BY v.starts_on), '[]'::jsonb)
         FROM public.client_habit_versions v WHERE v.client_habit_id = p_habit;
     $$;`,
    `CREATE FUNCTION pg_temp.edits(p_habit UUID) RETURNS jsonb LANGUAGE sql AS $$
       SELECT coalesce(jsonb_agg(jsonb_build_array(e.date, e.planned, e.target) ORDER BY e.date), '[]'::jsonb)
         FROM public.client_habit_day_edits e WHERE e.client_habit_id = p_habit;
     $$;`,
    `CREATE FUNCTION pg_temp.record(p_rule TEXT, p_variant TEXT, p_passed BOOLEAN, p_detail TEXT) RETURNS void LANGUAGE sql AS $$
       INSERT INTO proof_results (rule, variant, passed, detail) VALUES (p_rule, p_variant, p_passed, p_detail);
     $$;`
  );

  for (const rule of RULES) {
    const planted = plantedCopy(rule.id, rule.bug);
    parts.push(planted.sql);
    parts.push(block(rule.id, "live", rule.check(`public.${rule.fn}`)));
    parts.push(block(rule.id, "planted bug", rule.check(planted.name)));
  }

  parts.push(block("K1", "live", OVERLAP_CHECK));
  parts.push("ALTER TABLE public.client_habit_versions DROP CONSTRAINT client_habit_versions_no_overlap;");
  parts.push(block("K1", "planted bug", OVERLAP_CHECK));

  parts.push(block("G1", "live", GRANT_CHECK));
  parts.push("GRANT INSERT ON public.client_habits TO service_role;");
  parts.push(block("G1", "planted bug", GRANT_CHECK));

  parts.push(block("K2", "live", ONE_DELETE_CHECK));
  parts.push(
    "CREATE FUNCTION public.delete_client_habit(p_habit_id UUID, p_client_id UUID) RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN END; $$;"
  );
  parts.push(block("K2", "planted bug", ONE_DELETE_CHECK));

  parts.push("SELECT rule, variant, passed, detail FROM proof_results ORDER BY n;");
  parts.push("ROLLBACK;");
  return parts.join("\n\n");
}

type ResultRow = { rule: string; variant: string; passed: boolean; detail: string };

function run(): void {
  const beforePush = process.argv.includes("--before-push");
  const dir = mkdtempSync(join(tmpdir(), "habit-functions-proof-"));
  const file = join(dir, "proof.sql");
  writeFileSync(file, buildSql(beforePush));
  const raw = execFileSync("npx", ["supabase", "db", "query", "--linked", "-f", file], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const start = raw.indexOf("{");
  const parsed = JSON.parse(raw.slice(start)) as { rows: ResultRow[] };

  const says = new Map(RULES.map((rule) => [rule.id, rule.says]));
  says.set("K1", "a habit's versions never overlap");
  says.set("G1", "the server reads the prescription and writes it only through the functions; it writes entries; the public roles run no habit function");
  says.set("K2", "one delete, and it takes the client's today");
  let failures = 0;
  for (const id of [...says.keys()]) {
    const live = parsed.rows.find((r) => r.rule === id && r.variant === "live");
    const planted = parsed.rows.find((r) => r.rule === id && r.variant === "planted bug");
    const holds = live?.passed === true;
    const caught = planted?.passed === false;
    if (!holds || !caught) failures += 1;
    // A planted copy must fail for the rule's own reason, so its detail is
    // printed either way: a copy failing on something unrelated proves nothing.
    console.info(
      `${holds && caught ? "✓" : "✗"} ${id} ${says.get(id)} — live ${holds ? "holds" : `FAILS (${live?.detail})`}; planted bug ${caught ? "caught" : "NOT caught"} (${(planted?.detail ?? "").replace(/\s+/g, " ").slice(0, 160)})`
    );
  }
  if (failures > 0) {
    console.error(`${failures} rule(s) not proven`);
    process.exitCode = 1;
  } else {
    console.info(
      `Every rule proven (${says.size})${beforePush ? " against the migration applied in the same transaction" : ""}; the transaction was rolled back.`
    );
  }
}

run();
