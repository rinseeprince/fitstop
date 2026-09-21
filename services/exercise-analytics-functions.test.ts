import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The exercise analytics functions as the database runs them — each one's body
// in the last migration that defines it (migrations 094 to 192). The service's
// own tests mock the RPCs; these hold the SQL to the rules it alone states:
// which exercise a log belongs to, and that the PR cards, the Sessions table's
// star and the Overview's feed read one exercise's records, each with the
// session that set it. The race buckets are held to utils/race-distances.ts by
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
const ONE_EXERCISE = "COALESCE(p_exercise_id::TEXT, LOWER(p_exercise_name))";

describe("which exercise a logged exercise belongs to", () => {
  it("is the exercise done, else the one prescribed, else the name typed — the exercise list's rule", () => {
    expect(latest("exercise_log_identity")).toContain(
      "COALESCE( p_exercise_id::TEXT, p_prescribed_exercise_id::TEXT, LOWER(p_performed_name), 'unknown' )",
    );
  });

  it("is read by every function that groups or matches logs, so every view reads the list's logs", () => {
    expect(latest("get_client_exercise_list")).toContain(`${IDENTITY_OF_A_LOG} AS identity_key`);
    expect(latest("get_client_exercise_list")).toContain("GROUP BY r.identity_key");
    for (const name of ["get_exercise_progression_window", "get_exercise_prs"]) {
      expect(latest(name), name).toContain(`${IDENTITY_OF_A_LOG} = ${ONE_EXERCISE}`);
    }
  });

  it("asks for one exercise by its catalog id, else its name — neither is no exercise, never every one", () => {
    for (const name of ["get_exercise_progression_window", "get_exercise_prs"]) {
      // A NULL key equals nothing, and no branch reads every exercise
      expect(latest(name), name).not.toMatch(/IS NULL OR exercise_log_identity/);
    }
  });

  it("never matches a swapped exercise's logs to the exercise prescribed, nor a catalog log by its name", () => {
    for (const name of ["get_exercise_progression_window", "get_exercise_prs", "get_client_exercise_list"]) {
      const body = latest(name);
      expect(body, name).not.toContain("te.exercise_id = p_exercise_id");
      expect(body, name).not.toContain("LOWER(el.performed_name) = LOWER(p_exercise_name)");
    }
  });
});

describe("an exercise's records", () => {
  it("each carry their race and the session that set them", () => {
    const prs = latest("get_exercise_prs");
    expect(prs).toContain("race TEXT, date TIMESTAMPTZ, session_log_id UUID )");
    expect(prs).toContain("r.race, r.completed_at AS date, r.session_log_id");
  });
});

describe("the grant lockdown", () => {
  it("leaves every analytics function to service_role alone, in the migration that last creates it", () => {
    for (const signature of [
      "exercise_log_identity(UUID, UUID, TEXT)",
      "get_client_exercise_list(UUID, DATE, DATE)",
      "get_exercise_progression_window(UUID, UUID, TEXT, INT, DATE, DATE)",
      "get_exercise_prs(UUID, UUID, TEXT, DATE[])",
    ]) {
      const name = signature.slice(0, signature.indexOf("("));
      const sql = migrations.filter((m) => m.includes(`CREATE OR REPLACE FUNCTION ${name}(`)).at(-1) ?? "";
      expect(sql, signature).toContain(`REVOKE EXECUTE ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated;`);
      expect(sql, signature).toContain(`GRANT  EXECUTE ON FUNCTION ${signature} TO service_role;`);
    }
  });
});
