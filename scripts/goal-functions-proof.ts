/**
 * Proof of every rule of the six goal functions (migration 193;
 * docs/MEASUREMENT-LOG-PLAN.md §6 commit 8d), on the linked DEV database,
 * inside ONE transaction that is rolled back — nothing it writes survives.
 *
 *   npx tsx scripts/goal-functions-proof.ts
 *
 * Each rule is checked twice: against the live function, where it must hold,
 * and against a copy of that function with the rule taken out (a planted bug,
 * loaded as a pg_temp function from the migration's own text), where the same
 * check must FAIL — a check that passes either way proves nothing. The fixtures
 * are two throwaway clients under the perf coach (never in any roster), written
 * as `postgres`; every day is fixed, and "today" is the functions' `p_today`.
 *
 * Needs `npx supabase db query --linked` access (no password) and the DEV link.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PERF_COACH_ID } from "./perf-fixtures";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase", "migrations", "193_goals_one_row_per_goal.sql"),
  "utf8"
);

const TODAY = "2026-09-22";
const C = "0a0a0193-0000-4000-8000-00000000c001";
const OTHER = "0a0a0193-0000-4000-8000-00000000c002";
const G1 = "0a0a0193-0000-4000-8000-00000000a001";
const G2 = "0a0a0193-0000-4000-8000-00000000a002";
const G3 = "0a0a0193-0000-4000-8000-00000000a003";

type FunctionName =
  | "add_client_goal"
  | "edit_client_goal"
  | "set_client_goal_deadline"
  | "rename_client_goal"
  | "delete_client_goal"
  | "restore_client_goal";

/** The migration's text of one function, from CREATE to its closing $$;. */
function functionText(name: FunctionName): string {
  const start = MIGRATION.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end = MIGRATION.indexOf("\n$$;", start);
  if (start < 0 || end < 0) throw new Error(`No ${name} in the migration`);
  return MIGRATION.slice(start, end + "\n$$;".length);
}

type Edit = { from: string; to: string };
/** One rule taken out of a function: usually one edit, two where a rule has a belt. */
type Bug = { fn: FunctionName; edits: Edit[] };

const bug = (fn: FunctionName, from: string, to: string): Bug => ({ fn, edits: [{ from, to }] });

/** A pg_temp copy of the function with one rule taken out, and its name. */
function plantedCopy(tag: string, planted: Bug): { sql: string; name: string } {
  let text = functionText(planted.fn);
  for (const edit of planted.edits) {
    const count = text.split(edit.from).length - 1;
    if (count !== 1) throw new Error(`${tag}: the planted bug's anchor occurs ${count} times in ${planted.fn}`);
    text = text.replace(edit.from, edit.to);
  }
  const name = `pg_temp.${planted.fn}_${tag.toLowerCase()}`;
  return {
    name,
    sql: text.replace(`CREATE OR REPLACE FUNCTION public.${planted.fn}(`, `CREATE FUNCTION ${name}(`),
  };
}

type Rule = {
  id: string;
  says: string;
  fn: FunctionName;
  /** The check as PL/pgSQL statements: `fn` is the function under test; sets `ok` and `msg`. */
  check: (fn: string) => string;
  bug: Bug;
};

const goal = (client: string, id: string, startsOn: string, deadlines: Array<[string, string | null]>) =>
  `PERFORM pg_temp.put_goal('${client}', '${id}', '${startsOn}', '${JSON.stringify(deadlines)}'::jsonb);`;

const refusal = (call: string, code: string) => `
  BEGIN
    PERFORM ${call};
    ok := false; msg := 'written, not refused';
  EXCEPTION WHEN OTHERS THEN
    ok := SQLERRM LIKE '${code}:%'; msg := SQLERRM;
  END;`;

const entries = (id: string) =>
  `(SELECT coalesce(jsonb_agg(jsonb_build_array(effective_on, deadline) ORDER BY effective_on), '[]'::jsonb)
      FROM public.client_goal_deadlines WHERE goal_id = '${id}')`;

const RULES: Rule[] = [
  {
    id: "R1",
    says: "a goal can't start before today",
    fn: "add_client_goal",
    check: (fn) =>
      refusal(`${fn}(p_client_id => '${C}', p_today => '${TODAY}', p_starts_on => '2026-09-21', p_type => 'lose_weight', p_name => 'Cut', p_source => 'coach')`, "starts_in_past"),
    bug: bug("add_client_goal", "  IF p_starts_on < p_today THEN\n    RAISE EXCEPTION 'starts_in_past: a goal starts today or later';\n  END IF;\n", ""),
  },
  {
    id: "R2",
    says: "two goals can't start on one day",
    fn: "add_client_goal",
    check: (fn) =>
      goal(C, G1, "2026-10-05", [["2026-10-05", null]]) +
      refusal(`${fn}(p_client_id => '${C}', p_today => '${TODAY}', p_starts_on => '2026-10-05', p_type => 'maintain', p_name => 'Hold', p_source => 'coach')`, "day_taken"),
    bug: {
      fn: "add_client_goal",
      edits: [
        {
          from: "  IF EXISTS (SELECT 1 FROM client_goals WHERE client_id = p_client_id AND starts_on = p_starts_on) THEN\n    RAISE EXCEPTION 'day_taken: another goal starts on %', p_starts_on;\n  END IF;\n",
          to: "",
        },
        {
          from: "    WHEN unique_violation THEN\n      RAISE EXCEPTION 'day_taken: another goal starts on %', p_starts_on;\n  END;\n\n  INSERT INTO client_goal_deadlines (goal_id, effective_on, deadline, set_by)\n  VALUES (v_id,",
          to: "  END;\n\n  INSERT INTO client_goal_deadlines (goal_id, effective_on, deadline, set_by)\n  VALUES (v_id,",
        },
      ],
    },
  },
  {
    id: "R3",
    says: "a deadline can't be before its goal starts",
    fn: "add_client_goal",
    check: (fn) =>
      refusal(`${fn}(p_client_id => '${C}', p_today => '${TODAY}', p_starts_on => '2026-10-05', p_type => 'lose_weight', p_name => 'Cut', p_source => 'coach', p_deadline => '2026-10-04')`, "deadline_before_start"),
    bug: bug("add_client_goal", "  IF p_deadline IS NOT NULL AND p_deadline < p_starts_on THEN\n    RAISE EXCEPTION 'deadline_before_start: the deadline is before the goal starts';\n  END IF;\n", ""),
  },
  {
    id: "R4",
    says: "a deadline must fall before the next goal starts, and the refusal names it",
    fn: "add_client_goal",
    check: (fn) =>
      goal(C, G1, "2026-11-02", [["2026-11-02", null]]) +
      refusal(`${fn}(p_client_id => '${C}', p_today => '${TODAY}', p_starts_on => '${TODAY}', p_type => 'lose_weight', p_name => 'Cut', p_source => 'coach', p_deadline => '2026-11-02')`, "deadline_after_next") +
      `\n  ok := ok AND msg LIKE '%${G1}%';`,
    bug: bug("add_client_goal", "  IF p_deadline IS NOT NULL AND v_next.id IS NOT NULL AND p_deadline >= v_next.starts_on THEN", "  IF false THEN"),
  },
  {
    id: "R5",
    says: "a planned goal can't start on or before the previous goal's deadline",
    fn: "add_client_goal",
    check: (fn) =>
      goal(C, G1, "2026-08-03", [["2026-08-03", "2026-10-30"]]) +
      refusal(`${fn}(p_client_id => '${C}', p_today => '${TODAY}', p_starts_on => '2026-10-12', p_type => 'build_muscle', p_name => 'Build', p_source => 'coach')`, "previous_deadline"),
    bug: bug("add_client_goal", "      IF v_previous_deadline IS NOT NULL AND v_previous_deadline >= p_starts_on THEN", "      IF false THEN"),
  },
  {
    id: "R6",
    says: "a goal set from today replaces the current one, whatever its deadline",
    fn: "add_client_goal",
    check: (fn) =>
      goal(C, G1, "2026-08-03", [["2026-08-03", "2026-10-30"]]) + `
  BEGIN
    PERFORM ${fn}(p_client_id => '${C}', p_today => '${TODAY}', p_starts_on => '${TODAY}', p_type => 'build_muscle', p_name => 'Build', p_source => 'coach');
    ok := EXISTS (SELECT 1 FROM public.client_goals WHERE client_id = '${C}' AND starts_on = '${TODAY}'); msg := 'set';
  EXCEPTION WHEN OTHERS THEN ok := false; msg := SQLERRM; END;`,
    bug: bug("add_client_goal", "  IF p_starts_on > p_today THEN", "  IF p_starts_on >= p_today THEN"),
  },
  {
    id: "R7",
    says: "a new goal has one deadline entry, dated its start",
    fn: "add_client_goal",
    check: (fn) => `
  v_id := ${fn}(p_client_id => '${C}', p_today => '${TODAY}', p_starts_on => '2026-10-19', p_type => 'lose_weight', p_name => 'Cut', p_source => 'coach', p_deadline => '2026-12-11');
  v_after := (SELECT coalesce(jsonb_agg(jsonb_build_array(effective_on, deadline)), '[]'::jsonb)
                FROM public.client_goal_deadlines WHERE goal_id = v_id);
  msg := v_after::text;
  ok := v_after = '[["2026-10-19", "2026-12-11"]]'::jsonb;`,
    bug: bug("add_client_goal", "  INSERT INTO client_goal_deadlines (goal_id, effective_on, deadline, set_by)\n  VALUES (v_id, p_starts_on, p_deadline, p_set_by);\n", ""),
  },
  {
    id: "R8",
    says: "a goal that started before today can't be edited",
    fn: "edit_client_goal",
    check: (fn) =>
      goal(C, G1, "2026-09-01", [["2026-09-01", null]]) +
      refusal(`${fn}(p_goal_id => '${G1}', p_client_id => '${C}', p_today => '${TODAY}', p_type => 'maintain', p_name => 'Hold', p_starts_on => '2026-09-01')`, "started"),
    bug: bug("edit_client_goal", "  IF v_goal.starts_on < p_today THEN", "  IF false THEN"),
  },
  {
    id: "R9",
    says: "today's goal keeps its start day",
    fn: "edit_client_goal",
    check: (fn) =>
      goal(C, G1, TODAY, [[TODAY, null]]) +
      refusal(`${fn}(p_goal_id => '${G1}', p_client_id => '${C}', p_today => '${TODAY}', p_type => 'lose_weight', p_name => 'Fixture', p_starts_on => '2026-09-25')`, "started"),
    bug: bug("edit_client_goal", "  IF v_goal.starts_on = p_today AND p_starts_on <> v_goal.starts_on THEN", "  IF false THEN"),
  },
  {
    id: "R10",
    says: "a planned goal moves whole, its deadline with it",
    fn: "edit_client_goal",
    check: (fn) =>
      goal(C, G1, "2026-10-05", [["2026-10-05", "2026-12-01"]]) + `
  PERFORM ${fn}(p_goal_id => '${G1}', p_client_id => '${C}', p_today => '${TODAY}', p_type => 'build_muscle', p_name => 'Build', p_starts_on => '2026-10-12', p_target_weight => 88.8, p_deadline => '2026-12-01');
  msg := ${entries(G1)}::text;
  ok := (SELECT starts_on = '2026-10-12' AND type = 'build_muscle' AND target_weight = 88.8 FROM public.client_goals WHERE id = '${G1}')
        AND ${entries(G1)} = '[["2026-10-12", "2026-12-01"]]'::jsonb;`,
    bug: bug("edit_client_goal", "  VALUES (p_goal_id, p_starts_on, p_deadline, p_set_by);", "  VALUES (p_goal_id, v_goal.starts_on, p_deadline, p_set_by);"),
  },
  {
    id: "R11",
    says: "an edit that changes nothing writes nothing",
    fn: "edit_client_goal",
    check: (fn) =>
      goal(C, G1, "2026-10-05", [["2026-10-05", null]]) + `
  v_before := (SELECT jsonb_build_object('row', (SELECT ctid::text FROM public.client_goals WHERE id = '${G1}'),
                                         'entry', (SELECT id FROM public.client_goal_deadlines WHERE goal_id = '${G1}')));
  v_changed := ${fn}(p_goal_id => '${G1}', p_client_id => '${C}', p_today => '${TODAY}', p_type => 'lose_weight', p_name => 'Fixture', p_starts_on => '2026-10-05');
  v_after := (SELECT jsonb_build_object('row', (SELECT ctid::text FROM public.client_goals WHERE id = '${G1}'),
                                        'entry', (SELECT id FROM public.client_goal_deadlines WHERE goal_id = '${G1}')));
  ok := NOT v_changed AND v_after = v_before;
  msg := 'changed: ' || v_changed || ' ' || v_before::text || ' -> ' || v_after::text;`,
    bug: bug("edit_client_goal", "     AND v_deadline IS NOT DISTINCT FROM p_deadline THEN\n    RETURN false;", "     AND v_deadline IS NOT DISTINCT FROM p_deadline AND false THEN\n    RETURN false;"),
  },
  {
    id: "R12",
    says: "a planned goal's deadline is rewritten on its one entry, dated its start",
    fn: "set_client_goal_deadline",
    check: (fn) =>
      goal(C, G1, "2026-10-05", [["2026-10-05", null]]) + `
  PERFORM ${fn}(p_goal_id => '${G1}', p_client_id => '${C}', p_today => '${TODAY}', p_deadline => '2026-12-24');
  msg := ${entries(G1)}::text;
  ok := ${entries(G1)} = '[["2026-10-05", "2026-12-24"]]'::jsonb;`,
    bug: bug("set_client_goal_deadline", "  v_on := GREATEST(v_goal.starts_on, p_today);", "  v_on := p_today;"),
  },
  {
    id: "R13",
    says: "a running goal records its deadline change dated today, a second change today replacing it",
    fn: "set_client_goal_deadline",
    check: (fn) =>
      goal(C, G1, "2026-08-10", [["2026-08-10", "2026-11-30"]]) + `
  PERFORM ${fn}(p_goal_id => '${G1}', p_client_id => '${C}', p_today => '${TODAY}', p_deadline => '2026-12-14');
  PERFORM ${fn}(p_goal_id => '${G1}', p_client_id => '${C}', p_today => '${TODAY}', p_deadline => '2026-12-21');
  msg := ${entries(G1)}::text;
  ok := ${entries(G1)} = '[["2026-08-10", "2026-11-30"], ["2026-09-22", "2026-12-21"]]'::jsonb;`,
    bug: bug("set_client_goal_deadline", "  DO UPDATE SET deadline = EXCLUDED.deadline, set_by = EXCLUDED.set_by;", "  DO NOTHING;"),
  },
  {
    id: "R14",
    says: "changing back to yesterday's deadline leaves no copy of it dated today",
    fn: "set_client_goal_deadline",
    check: (fn) =>
      goal(C, G1, "2026-08-10", [["2026-08-10", "2026-11-30"]]) + `
  PERFORM ${fn}(p_goal_id => '${G1}', p_client_id => '${C}', p_today => '${TODAY}', p_deadline => '2026-12-14');
  PERFORM ${fn}(p_goal_id => '${G1}', p_client_id => '${C}', p_today => '${TODAY}', p_deadline => '2026-11-30');
  msg := ${entries(G1)}::text;
  ok := ${entries(G1)} = '[["2026-08-10", "2026-11-30"]]'::jsonb;`,
    bug: bug("set_client_goal_deadline", "    IF v_has_before AND v_before IS NOT DISTINCT FROM p_deadline THEN", "    IF false THEN"),
  },
  {
    id: "R15",
    says: "a goal that has ended keeps its deadline",
    fn: "set_client_goal_deadline",
    check: (fn) =>
      goal(C, G1, "2026-07-06", [["2026-07-06", "2026-09-30"]]) +
      goal(C, G2, "2026-08-17", [["2026-08-17", null]]) +
      refusal(`${fn}(p_goal_id => '${G1}', p_client_id => '${C}', p_today => '${TODAY}', p_deadline => '2026-10-09')`, "ended"),
    bug: bug("set_client_goal_deadline", "  IF v_goal.starts_on <= p_today AND EXISTS (", "  IF false AND EXISTS ("),
  },
  {
    id: "R16",
    says: "a deadline set to what it already is writes nothing",
    fn: "set_client_goal_deadline",
    check: (fn) =>
      goal(C, G1, "2026-08-10", [["2026-08-10", "2026-11-30"]]) + `
  v_changed := ${fn}(p_goal_id => '${G1}', p_client_id => '${C}', p_today => '${TODAY}', p_deadline => '2026-11-30');
  msg := 'changed: ' || v_changed || ' ' || ${entries(G1)}::text;
  ok := NOT v_changed AND ${entries(G1)} = '[["2026-08-10", "2026-11-30"]]'::jsonb;`,
    bug: bug("set_client_goal_deadline", "  IF v_current IS NOT DISTINCT FROM p_deadline THEN\n    RETURN false;", "  IF false THEN\n    RETURN false;"),
  },
  {
    id: "R17",
    says: "a running goal's deadline must fall before the next goal starts",
    fn: "set_client_goal_deadline",
    check: (fn) =>
      goal(C, G1, "2026-08-10", [["2026-08-10", null]]) +
      goal(C, G2, "2026-10-26", [["2026-10-26", null]]) +
      refusal(`${fn}(p_goal_id => '${G1}', p_client_id => '${C}', p_today => '${TODAY}', p_deadline => '2026-10-26')`, "deadline_after_next"),
    bug: bug("set_client_goal_deadline", "  IF p_deadline IS NOT NULL AND v_next.id IS NOT NULL AND p_deadline >= v_next.starts_on THEN", "  IF false THEN"),
  },
  {
    id: "R18",
    says: "any goal, an ended one too, can be renamed; the same name writes nothing",
    fn: "rename_client_goal",
    check: (fn) =>
      goal(C, G1, "2026-07-06", [["2026-07-06", null]]) +
      goal(C, G2, "2026-08-17", [["2026-08-17", null]]) + `
  v_changed := ${fn}(p_goal_id => '${G1}', p_client_id => '${C}', p_name => 'Old cut', p_description => 'Winter');
  ok := v_changed AND (SELECT name = 'Old cut' AND description = 'Winter' FROM public.client_goals WHERE id = '${G1}');
  v_changed := ${fn}(p_goal_id => '${G1}', p_client_id => '${C}', p_name => 'Old cut', p_description => 'Winter');
  ok := ok AND NOT v_changed;
  msg := 'second rename changed: ' || v_changed;`,
    bug: bug("rename_client_goal", "  IF v_goal.name = btrim(p_name)", "  IF false AND v_goal.name = btrim(p_name)"),
  },
  {
    id: "R19",
    says: "delete removes the goal and its deadlines, and hands back both",
    fn: "delete_client_goal",
    check: (fn) =>
      goal(C, G1, "2026-08-10", [["2026-08-10", "2026-11-30"], ["2026-09-01", "2026-12-14"]]) + `
  v_copy := ${fn}(p_goal_id => '${G1}', p_client_id => '${C}');
  ok := v_copy->'goal'->>'id' = '${G1}' AND jsonb_array_length(v_copy->'deadlines') = 2
        AND NOT EXISTS (SELECT 1 FROM public.client_goals WHERE id = '${G1}')
        AND NOT EXISTS (SELECT 1 FROM public.client_goal_deadlines WHERE goal_id = '${G1}');
  msg := v_copy::text;`,
    bug: bug("delete_client_goal", "  DELETE FROM client_goals WHERE id = p_goal_id;", "  PERFORM 1;"),
  },
  {
    id: "R20",
    says: "restore puts the goal back exactly — the same id, fields and deadlines",
    fn: "restore_client_goal",
    check: (fn) =>
      goal(C, G1, "2026-08-10", [["2026-08-10", "2026-11-30"], ["2026-09-01", "2026-12-14"]]) + `
  v_before := (SELECT to_jsonb(g) FROM public.client_goals g WHERE id = '${G1}') || jsonb_build_object('entries', ${entries(G1)});
  v_copy := public.delete_client_goal(p_goal_id => '${G1}', p_client_id => '${C}');
  PERFORM ${fn}(p_client_id => '${C}', p_copy => v_copy);
  v_after := (SELECT to_jsonb(g) FROM public.client_goals g WHERE id = '${G1}') || jsonb_build_object('entries', ${entries(G1)});
  ok := v_after = v_before; msg := coalesce(v_after::text, 'not back');`,
    bug: bug("restore_client_goal", "    INSERT INTO client_goal_deadlines\n    SELECT * FROM jsonb_populate_recordset(NULL::client_goal_deadlines, COALESCE(p_copy->'deadlines', '[]'::jsonb))\n     WHERE goal_id = v_goal.id;", "    PERFORM 1;"),
  },
  {
    id: "R21",
    says: "restore is refused when another goal now starts on its day",
    fn: "restore_client_goal",
    check: (fn) =>
      goal(C, G1, "2026-08-10", [["2026-08-10", null]]) + `
  v_copy := public.delete_client_goal(p_goal_id => '${G1}', p_client_id => '${C}');` +
      goal(C, G3, "2026-08-10", [["2026-08-10", null]]) +
      refusal(`${fn}(p_client_id => '${C}', p_copy => v_copy)`, "day_taken"),
    bug: bug("restore_client_goal", "  IF EXISTS (SELECT 1 FROM client_goals WHERE client_id = p_client_id AND starts_on = v_goal.starts_on) THEN", "  IF false THEN"),
  },
  {
    id: "R22",
    says: "another client's goal is not found, and stays",
    fn: "delete_client_goal",
    check: (fn) =>
      goal(OTHER, G2, "2026-10-05", [["2026-10-05", null]]) +
      refusal(`${fn}(p_goal_id => '${G2}', p_client_id => '${C}')`, "not_found") +
      `\n  ok := ok AND EXISTS (SELECT 1 FROM public.client_goals WHERE id = '${G2}');`,
    bug: bug("delete_client_goal", "   WHERE id = p_goal_id AND client_id = p_client_id\n   FOR UPDATE;", "   WHERE id = p_goal_id\n   FOR UPDATE;"),
  },
];

const GRANT_CHECK = `
  ok := has_table_privilege('service_role', 'public.client_goals', 'SELECT')
    AND has_table_privilege('service_role', 'public.client_goal_deadlines', 'SELECT')
    AND NOT has_table_privilege('service_role', 'public.client_goals', 'INSERT')
    AND NOT has_table_privilege('service_role', 'public.client_goals', 'UPDATE')
    AND NOT has_table_privilege('service_role', 'public.client_goals', 'DELETE')
    AND NOT has_table_privilege('service_role', 'public.client_goal_deadlines', 'INSERT')
    AND NOT has_table_privilege('service_role', 'public.client_goal_deadlines', 'UPDATE')
    AND NOT has_table_privilege('service_role', 'public.client_goal_deadlines', 'DELETE')
    AND NOT has_table_privilege('authenticated', 'public.client_goals', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.client_goals', 'SELECT')
    AND has_function_privilege('service_role', 'public.add_client_goal(uuid, date, date, text, text, text, uuid, numeric, numeric, text, date)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.add_client_goal(uuid, date, date, text, text, text, uuid, numeric, numeric, text, date)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.delete_client_goal(uuid, uuid)', 'EXECUTE');
  msg := 'grants';`;

function block(rule: string, variant: string, body: string): string {
  return `
DO $proof$
DECLARE
  ok BOOLEAN := false;
  msg TEXT := '';
  v_id UUID;
  v_changed BOOLEAN;
  v_copy JSONB;
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

function buildSql(): string {
  const parts: string[] = [
    "BEGIN;",
    "CREATE TEMP TABLE proof_results (n SERIAL, rule TEXT, variant TEXT, passed BOOLEAN, detail TEXT);",
    `INSERT INTO public.clients (id, coach_id, name, email) VALUES
      ('${C}', '${PERF_COACH_ID}', 'Goal functions proof', 'goal-functions-proof-a@fixture.local'),
      ('${OTHER}', '${PERF_COACH_ID}', 'Goal functions proof B', 'goal-functions-proof-b@fixture.local');`,
    `CREATE FUNCTION pg_temp.reset() RETURNS void LANGUAGE sql AS $$
       DELETE FROM public.client_goals WHERE client_id IN ('${C}', '${OTHER}');
     $$;`,
    `CREATE FUNCTION pg_temp.put_goal(p_client UUID, p_id UUID, p_starts DATE, p_deadlines JSONB) RETURNS void LANGUAGE sql AS $$
       INSERT INTO public.client_goals (id, client_id, name, type, starts_on, source)
       VALUES (p_id, p_client, 'Fixture', 'lose_weight', p_starts, 'coach');
       INSERT INTO public.client_goal_deadlines (goal_id, effective_on, deadline)
       SELECT p_id, (e->>0)::date, (e->>1)::date FROM jsonb_array_elements(p_deadlines) e;
     $$;`,
    `CREATE FUNCTION pg_temp.record(p_rule TEXT, p_variant TEXT, p_passed BOOLEAN, p_detail TEXT) RETURNS void LANGUAGE sql AS $$
       INSERT INTO proof_results (rule, variant, passed, detail) VALUES (p_rule, p_variant, p_passed, p_detail);
     $$;`,
  ];

  for (const rule of RULES) {
    const planted = plantedCopy(rule.id, rule.bug);
    parts.push(planted.sql);
    parts.push(block(rule.id, "live", rule.check(`public.${rule.fn}`)));
    parts.push(block(rule.id, "planted bug", rule.check(planted.name)));
  }

  parts.push(block("R23", "live", GRANT_CHECK));
  parts.push("GRANT INSERT ON public.client_goals TO service_role;");
  parts.push(block("R23", "planted bug", GRANT_CHECK));

  parts.push("SELECT rule, variant, passed, detail FROM proof_results ORDER BY n;");
  parts.push("ROLLBACK;");
  return parts.join("\n\n");
}

type ResultRow = { rule: string; variant: string; passed: boolean; detail: string };

function run(): void {
  const dir = mkdtempSync(join(tmpdir(), "goal-functions-proof-"));
  const file = join(dir, "proof.sql");
  writeFileSync(file, buildSql());
  const raw = execFileSync("npx", ["supabase", "db", "query", "--linked", "-f", file], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const start = raw.indexOf("{");
  const parsed = JSON.parse(raw.slice(start)) as { rows: ResultRow[] };

  const says = new Map(RULES.map((rule) => [rule.id, rule.says]));
  says.set("R23", "the server may read the goal tables and write them only through the functions");
  let failures = 0;
  for (const id of [...says.keys()]) {
    const live = parsed.rows.find((r) => r.rule === id && r.variant === "live");
    const bug = parsed.rows.find((r) => r.rule === id && r.variant === "planted bug");
    const holds = live?.passed === true;
    const caught = bug?.passed === false;
    if (!holds || !caught) failures += 1;
    console.info(
      `${holds && caught ? "✓" : "✗"} ${id} ${says.get(id)} — live ${holds ? "holds" : `FAILS (${live?.detail})`}; planted bug ${caught ? "caught" : `NOT caught (${bug?.detail})`}`
    );
  }
  if (failures > 0) {
    console.error(`${failures} rule(s) not proven`);
    process.exitCode = 1;
  } else {
    console.info(`Every rule proven (${says.size}); the transaction was rolled back.`);
  }
}

run();
