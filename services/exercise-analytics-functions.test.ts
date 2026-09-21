import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The exercise analytics functions as the database runs them — each one's body
// in the last migration that defines it (migrations 094 to 191). The service's
// own tests mock the RPCs; these hold the SQL to the rules it alone states:
// which exercise a log belongs to, and that the PR cards, the Sessions table's
// star, the Overview's feed and the All exercises table read one set of
// records. The race buckets are held to utils/race-distances.ts by
// utils/race-distances.test.ts.

const MIGRATIONS = join(process.cwd(), "supabase/migrations");

const migrations = readdirSync(MIGRATIONS)
  .filter((file) => file.endsWith(".sql"))
  .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
  .map((file) => readFileSync(join(MIGRATIONS, file), "utf8"));

/** A function's definition, from its CREATE in the last migration that defines it to its body's end. */
function latest(name: string): string {
  const header = `CREATE OR REPLACE FUNCTION ${name}(`;
  const sql = migrations.filter((m) => m.includes(header)).at(-1);
  if (!sql) throw new Error(`no migration defines ${name}`);
  const start = sql.indexOf(header);
  return sql.slice(start, sql.indexOf("$$;", start)).replace(/\s+/g, " ");
}

const IDENTITY_OF_A_LOG = "exercise_log_identity(el.exercise_id, te.exercise_id, el.performed_name)";

describe("which exercise a logged exercise belongs to", () => {
  it("is the exercise done, else the one prescribed, else the name typed — the exercise list's rule", () => {
    expect(latest("exercise_log_identity")).toContain(
      "COALESCE( p_exercise_id::TEXT, p_prescribed_exercise_id::TEXT, LOWER(p_performed_name), 'unknown' )",
    );
  });

  it("is read by every function that groups or matches logs, so every view reads the list's logs", () => {
    expect(latest("client_exercises")).toContain(`${IDENTITY_OF_A_LOG} AS identity_key`);
    expect(latest("exercise_records")).toContain(`${IDENTITY_OF_A_LOG} AS identity_key`);
    expect(latest("exercise_records")).toContain(`${IDENTITY_OF_A_LOG} = p_identity_key`);
    expect(latest("get_exercise_progression_window")).toContain(
      `${IDENTITY_OF_A_LOG} = COALESCE(p_exercise_id::TEXT, LOWER(p_exercise_name))`,
    );
  });

  it("never matches a swapped exercise's logs to the exercise prescribed, nor a catalog log by its name", () => {
    for (const name of ["get_exercise_progression_window", "exercise_records", "client_exercises"]) {
      const body = latest(name);
      expect(body, name).not.toContain("te.exercise_id = p_exercise_id");
      expect(body, name).not.toContain("LOWER(el.performed_name) = LOWER(p_exercise_name)");
    }
  });

  it("asks for one exercise by its catalog id, else its name, and for none when given neither", () => {
    const prs = latest("get_exercise_prs");
    expect(prs).toContain("exercise_records( p_client_id, COALESCE(p_exercise_id::TEXT, LOWER(p_exercise_name)), p_exclude_dates )");
    expect(prs).toContain("WHERE COALESCE(p_exercise_id::TEXT, LOWER(p_exercise_name)) IS NOT NULL");
  });
});

describe("one set of records", () => {
  it("is what an exercise's PRs are, each with its race and the session that set it", () => {
    const prs = latest("get_exercise_prs");
    expect(prs).toContain("FROM exercise_records(");
    expect(prs).toContain("r.race, r.date, r.session_log_id");
    expect(latest("exercise_records")).toContain("session_log_id UUID");
  });

  it("is what every exercise's bests summarise, one row per exercise the client has logged", () => {
    const bests = latest("get_client_exercise_bests");
    expect(bests).toContain("SELECT * FROM exercise_records(p_client_id)");
    expect(bests).toContain("FROM client_exercises(p_client_id) c");
    // The best estimate: Epley, the weight itself for a single, none past 30 reps
    expect(bests).toContain("WHERE r.kind = 'rep_max' AND r.reps <= 30");
    expect(bests).toContain("CASE WHEN r.reps = 1 THEN r.weight ELSE r.weight * (30 + r.reps) / 30 END DESC");
    // The best time at the longest race distance it holds one at
    expect(bests).toContain("WHERE r.kind = 'best_time' AND r.race IS NOT NULL ORDER BY r.identity_key, r.distance_meters DESC");
  });

  it("gives the exercise list and every exercise's bests the same rows", () => {
    expect(latest("get_client_exercise_list")).toContain("FROM client_exercises(p_client_id, p_start_date, p_end_date) c");
    // Sessions are sessions, however many times one logged the exercise
    expect(latest("client_exercises")).toContain("COUNT(DISTINCT r.session_log_id)::INT AS session_count");
  });
});

describe("the grant lockdown", () => {
  it("leaves every analytics function to service_role alone, in the migration that last creates it", () => {
    for (const signature of [
      "exercise_log_identity(UUID, UUID, TEXT)",
      "client_exercises(UUID, DATE, DATE)",
      "get_client_exercise_list(UUID, DATE, DATE)",
      "get_exercise_progression_window(UUID, UUID, TEXT, INT, DATE, DATE)",
      "exercise_records(UUID, TEXT, DATE[])",
      "get_exercise_prs(UUID, UUID, TEXT, DATE[])",
      "get_client_exercise_bests(UUID)",
    ]) {
      const name = signature.slice(0, signature.indexOf("("));
      const sql = migrations.filter((m) => m.includes(`CREATE OR REPLACE FUNCTION ${name}(`)).at(-1) ?? "";
      expect(sql, signature).toContain(`REVOKE EXECUTE ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated;`);
      expect(sql, signature).toContain(`GRANT  EXECUTE ON FUNCTION ${signature} TO service_role;`);
    }
  });
});
