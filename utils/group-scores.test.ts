import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GROUP_SCORE_FINISH_SCALE,
  GROUP_SCORE_FINISH_SECONDS_MAX,
  GROUP_SCORE_FINISH_SECONDS_MIN,
  GROUP_SCORE_MESSAGES,
  GROUP_SCORE_REPS_MAX,
  GROUP_SCORE_ROUNDS_MAX,
  groupScoreIssue,
  groupScoreValue,
  takesScore,
} from "./group-scores";
import { GROUP_FORMATS, isTimedFormat } from "./exercise-groups";

// The migration is the other half of the rule: its CHECKs must say what this
// module says, so a bound changed in one place fails here.
const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/186_timed_group_scores.sql"),
  "utf8",
);

describe("which groups score", () => {
  it("an AMRAP and a For time take a score; an EMOM, straight sets and a superset don't", () => {
    expect(takesScore("amrap")).toBe(true);
    expect(takesScore("for_time")).toBe(true);
    expect(takesScore("emom")).toBe(false);
    expect(takesScore("circuit")).toBe(false);
    expect(takesScore("straight_sets")).toBe(false);
  });

  it("the three timed formats run on a clock", () => {
    expect(GROUP_FORMATS.filter(isTimedFormat)).toEqual(["amrap", "emom", "for_time"]);
  });
});

describe("a score's shape", () => {
  it("is rounds and reps together, or a finish time alone", () => {
    expect(groupScoreValue({ rounds: 7, reps: 12 })).toEqual({ rounds: 7, reps: 12, finishSeconds: null });
    expect(groupScoreValue({ rounds: 7, reps: 0 })).toEqual({ rounds: 7, reps: 0, finishSeconds: null });
    expect(groupScoreValue({ finishSeconds: 512.5 })).toEqual({ rounds: null, reps: null, finishSeconds: 512.5 });
    expect(groupScoreValue({ rounds: 7 })).toBeNull();
    expect(groupScoreValue({ reps: 12 })).toBeNull();
    expect(groupScoreValue({ rounds: 7, reps: 12, finishSeconds: 512 })).toBeNull();
    expect(groupScoreValue({})).toBeNull();
    expect(groupScoreValue({ rounds: null, reps: null, finishSeconds: null })).toBeNull();
  });

  it("is judged against the format: an AMRAP's is rounds and reps, a For time's either, others none", () => {
    expect(groupScoreIssue("amrap", { rounds: 7, reps: 12 })).toBeNull();
    expect(groupScoreIssue("amrap", { finishSeconds: 300 })).toBe(GROUP_SCORE_MESSAGES.amrapShape);
    expect(groupScoreIssue("for_time", { finishSeconds: 512 })).toBeNull();
    expect(groupScoreIssue("for_time", { rounds: 2, reps: 15 })).toBeNull();
    expect(groupScoreIssue("for_time", { rounds: 2 })).toBe(GROUP_SCORE_MESSAGES.shape);
    expect(groupScoreIssue("emom", { rounds: 8, reps: 0 })).toBe(GROUP_SCORE_MESSAGES.notScored);
    expect(groupScoreIssue("circuit", { finishSeconds: 60 })).toBe(GROUP_SCORE_MESSAGES.notScored);
    expect(groupScoreIssue("straight_sets", { rounds: 1, reps: 1 })).toBe(GROUP_SCORE_MESSAGES.notScored);
  });
});

describe("migration 186 says the same", () => {
  it("bounds rounds and reps as the module does", () => {
    expect(MIGRATION).toContain(`CHECK (rounds IS NULL OR rounds BETWEEN 0 AND ${GROUP_SCORE_ROUNDS_MAX})`);
    expect(MIGRATION).toContain(`CHECK (reps IS NULL OR reps BETWEEN 0 AND ${GROUP_SCORE_REPS_MAX})`);
  });

  it("bounds a finish time as a logged duration, to a tenth", () => {
    expect(MIGRATION).toContain(
      `CHECK (finish_seconds IS NULL OR finish_seconds BETWEEN ${GROUP_SCORE_FINISH_SECONDS_MIN} AND ${GROUP_SCORE_FINISH_SECONDS_MAX})`,
    );
    expect(GROUP_SCORE_FINISH_SCALE).toBe(1);
    expect(MIGRATION).toContain("finish_seconds NUMERIC(7,1)");
  });

  it("allows the two shapes and nothing else, on the formats that score", () => {
    expect(MIGRATION).toContain(
      "(finish_seconds IS NOT NULL AND rounds IS NULL AND reps IS NULL)\n      OR (finish_seconds IS NULL AND rounds IS NOT NULL AND reps IS NOT NULL)",
    );
    expect(MIGRATION).toContain("CHECK (prescribed_group_snapshot->>'format' IN ('amrap', 'for_time'))");
    expect(MIGRATION).toContain(
      "CHECK (finish_seconds IS NULL OR prescribed_group_snapshot->>'format' = 'for_time')",
    );
  });

  it("cascades with its log and lets its group go, deny-all RLS, service_role only", () => {
    expect(MIGRATION).toContain("REFERENCES public.session_logs(id) ON DELETE CASCADE");
    expect(MIGRATION).toContain("REFERENCES public.training_exercise_groups(id) ON DELETE SET NULL");
    expect(MIGRATION).toContain("ENABLE ROW LEVEL SECURITY");
    expect(MIGRATION).toContain(
      "REVOKE ALL ON TABLE public.session_log_group_scores FROM PUBLIC, anon, authenticated, service_role",
    );
    expect(MIGRATION).toContain("GRANT ALL ON TABLE public.session_log_group_scores TO service_role");
    expect(MIGRATION).not.toMatch(/CREATE POLICY/);
  });
});
