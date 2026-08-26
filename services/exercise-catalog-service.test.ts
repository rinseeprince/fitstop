import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase-admin before importing the service
vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

// Inline query mock helper
function createMockQuery<T = unknown>(result: {
  data: T | null;
  error: { message: string } | null;
}) {
  const mockQuery = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: vi.fn(),
  };

  Object.defineProperty(mockQuery, "then", {
    value: (resolve: (value: typeof result) => void) =>
      Promise.resolve(result).then(resolve),
  });

  return mockQuery;
}

import { supabaseAdmin } from "./supabase-admin";
import {
  resolveExercises,
  normalizeExerciseName,
  matchExerciseInRows,
  suggestExerciseCandidates,
  getExerciseCatalogDelta,
  updateCatalogExercise,
  deleteCatalogExercise,
} from "./exercise-catalog-service";

const mockFrom = vi.mocked(supabaseAdmin.from);

describe("exercise-catalog-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // normalizeExerciseName
  // =========================================================================

  describe("normalizeExerciseName", () => {
    it("applies abbreviation map correctly", () => {
      expect(normalizeExerciseName("DB Bench Press")).toBe(
        "dumbbell bench press"
      );
      expect(normalizeExerciseName("BB Squat")).toBe("barbell squat");
    });

    it("handles multiple abbreviations in one name", () => {
      expect(normalizeExerciseName("DB RDL")).toBe(
        "dumbbell romanian deadlift"
      );
    });

    it("handles mixed case", () => {
      expect(normalizeExerciseName("  Db  Bench  Press  ")).toBe(
        "dumbbell bench press"
      );
    });

    it("passes through unknown words unchanged", () => {
      expect(normalizeExerciseName("Lat Pulldown")).toBe("lat pulldown");
    });
  });

  // =========================================================================
  // resolveExercise
  // =========================================================================

  describe("resolveExercises", () => {
    const coachId = "coach-1";

    it("resolves multiple names in one call, returns correct Map", async () => {
      const fetchQuery = createMockQuery({
        data: [
          {
            id: "ex-1",
            name: "Bench Press",
            coach_id: null,
            aliases: [],
          },
          {
            id: "ex-2",
            name: "Squat",
            coach_id: null,
            aliases: ["back squat"],
          },
        ],
        error: null,
      });
      mockFrom.mockReturnValue(fetchQuery as any);

      const result = await resolveExercises(
        ["Bench Press", "Squat"],
        coachId
      );

      expect(result.get("Bench Press")).toBe("ex-1");
      expect(result.get("Squat")).toBe("ex-2");
    });

    it("creates missing exercises while reusing existing ones", async () => {
      // Fetch returns only one match
      const fetchQuery = createMockQuery({
        data: [
          {
            id: "ex-1",
            name: "Bench Press",
            coach_id: null,
            aliases: [],
          },
        ],
        error: null,
      });
      // Insert returns the new exercise
      const insertQuery = createMockQuery({
        data: [
          {
            id: "new-ex-1",
            name: "Cable Fly",
            coach_id: coachId,
          },
        ],
        error: null,
      });

      mockFrom
        .mockReturnValueOnce(fetchQuery as any)
        .mockReturnValueOnce(insertQuery as any);

      const result = await resolveExercises(
        ["Bench Press", "Cable Fly"],
        coachId
      );

      expect(result.get("Bench Press")).toBe("ex-1");
      expect(result.get("Cable Fly")).toBe("new-ex-1");
    });

    it("returns empty Map for empty input", async () => {
      const result = await resolveExercises([], coachId);

      expect(result.size).toBe(0);
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("resolves mixed-case names via the lowercase key (insertSavedExercises convention)", async () => {
      // Regression: the map used to be keyed by trimmed-original only, so
      // .get(name.trim().toLowerCase()) consumers stored exercise_id NULL
      // for any mixed-case name.
      const fetchQuery = createMockQuery({
        data: [
          { id: "ex-1", name: "Bench Press", coach_id: null, aliases: [] },
        ],
        error: null,
      });
      mockFrom.mockReturnValue(fetchQuery as any);

      const result = await resolveExercises(["Bench Press"], coachId);

      expect(result.get("bench press")).toBe("ex-1"); // lowercase lookup
      expect(result.get("Bench Press")).toBe("ex-1"); // original-case lookup
    });
  });

  // =========================================================================
  // getExerciseCatalogDelta (delta-sync, internal keyset paging)
  // =========================================================================

  describe("getExerciseCatalogDelta", () => {
    const coachId = "coach-1";

    it("returns a single short page without paging again", async () => {
      const rows = [
        { id: "ex-1", name: "Bench", muscle_group: "chest", equipment: "barbell", updated_at: "2026-05-01T00:00:00+00:00" },
        { id: "ex-2", name: "Row", muscle_group: "back", equipment: "barbell", updated_at: "2026-05-02T00:00:00+00:00" },
      ];
      const q = createMockQuery({ data: rows, error: null });
      mockFrom.mockReturnValue(q as any);

      const result = await getExerciseCatalogDelta(coachId);

      expect(result).toEqual(rows);
      expect(mockFrom).toHaveBeenCalledTimes(1); // short page -> no second fetch
      // First page scopes to coach + global and applies no cursor / `since` filter.
      expect(q.or).toHaveBeenCalledTimes(1);
      expect(q.or).toHaveBeenCalledWith("coach_id.eq.coach-1,coach_id.is.null");
      expect(q.gt).not.toHaveBeenCalled();
    });

    it("pages past the 1000-row cap with a tie-safe (updated_at, id) cursor", async () => {
      // Every row shares one timestamp, so paging on updated_at alone would skip
      // or loop — the (updated_at, id) tiebreak is what makes this correct.
      const SAME_TS = "2026-01-01T00:00:00+00:00";
      const page1 = Array.from({ length: 1000 }, (_, i) => ({
        id: `id-${String(i).padStart(4, "0")}`,
        name: `E${i}`,
        muscle_group: null,
        equipment: null,
        updated_at: SAME_TS,
      }));
      const page2 = [
        { id: "id-1000", name: "E1000", muscle_group: null, equipment: null, updated_at: SAME_TS },
      ];
      const q1 = createMockQuery({ data: page1, error: null });
      const q2 = createMockQuery({ data: page2, error: null });
      mockFrom.mockReturnValueOnce(q1 as any).mockReturnValueOnce(q2 as any);

      const result = await getExerciseCatalogDelta(coachId);

      expect(result).toHaveLength(1001); // complete, NOT truncated at 1000
      expect(new Set(result.map((r) => r.id)).size).toBe(1001); // no duplicates
      expect(mockFrom).toHaveBeenCalledTimes(2); // paged exactly twice

      // Page 1: coach scope only. Page 2: coach scope + the keyset advance from
      // page-1's last row (id-0999), tie-broken within the shared timestamp.
      expect(q1.or).toHaveBeenCalledTimes(1);
      expect(q2.or).toHaveBeenCalledTimes(2);
      expect(q2.or).toHaveBeenLastCalledWith(
        `updated_at.gt.${SAME_TS},and(updated_at.eq.${SAME_TS},id.gt.id-0999)`,
      );
    });

    it("with `since`, pages multiple times and keeps every later page above the watermark", async () => {
      // The load-bearing invariant: `.gt(since)` applies ONLY to page 1; page 2+
      // drop it and rely on the keyset advance, which stays > since because the
      // page-1 tail already did. Mixed timestamps (tail at a distinct MAX_TS)
      // also prove the cursor tracks the LAST row's (updated_at, id), not the bulk.
      const since = "2026-01-01T00:00:00+00:00";
      const BULK_TS = "2026-02-15T00:00:00+00:00";
      const MAX_TS = "2026-03-01T00:00:00+00:00";
      const page1 = Array.from({ length: 1000 }, (_, i) => ({
        id: `id-${String(i).padStart(4, "0")}`,
        name: `E${i}`,
        muscle_group: null,
        equipment: null,
        updated_at: i < 998 ? BULK_TS : MAX_TS, // tail (id-0998, id-0999) at MAX_TS
      }));
      const page2 = [
        { id: "id-1000", name: "E1000", muscle_group: null, equipment: null, updated_at: "2026-03-02T00:00:00+00:00" },
        { id: "id-1001", name: "E1001", muscle_group: null, equipment: null, updated_at: "2026-03-03T00:00:00+00:00" },
      ];
      const q1 = createMockQuery({ data: page1, error: null });
      const q2 = createMockQuery({ data: page2, error: null });
      mockFrom.mockReturnValueOnce(q1 as any).mockReturnValueOnce(q2 as any);

      const result = await getExerciseCatalogDelta(coachId, since);

      expect(result).toHaveLength(1002); // complete across the page boundary
      expect(new Set(result.map((r) => r.id)).size).toBe(1002); // no duplicates
      expect(result.every((r) => r.updated_at > since)).toBe(true); // never re-admits <= since
      // Page 1 applies the strict `since` filter and coach scope only.
      expect(q1.gt).toHaveBeenCalledWith("updated_at", since);
      expect(q1.or).toHaveBeenCalledTimes(1);
      // Page 2 must NOT re-apply `since`; it advances via the keyset cursor built
      // from page-1's LAST row (MAX_TS, id-0999), not the bulk timestamp.
      expect(q2.gt).not.toHaveBeenCalled();
      expect(q2.or).toHaveBeenCalledTimes(2);
      expect(q2.or).toHaveBeenLastCalledWith(
        `updated_at.gt.${MAX_TS},and(updated_at.eq.${MAX_TS},id.gt.id-0999)`,
      );
    });

    it("terminates on an empty trailing page when size is an exact multiple of the page", async () => {
      // 1000 rows -> page 1 is full -> loop does NOT break -> fetches page 2 ->
      // empty -> 0 < 1000 -> break (without dereferencing an empty page's tail).
      const page1 = Array.from({ length: 1000 }, (_, i) => ({
        id: `id-${String(i).padStart(4, "0")}`,
        name: `E${i}`,
        muscle_group: null,
        equipment: null,
        updated_at: "2026-01-01T00:00:00+00:00",
      }));
      const q1 = createMockQuery({ data: page1, error: null });
      const q2 = createMockQuery({ data: [], error: null });
      mockFrom.mockReturnValueOnce(q1 as any).mockReturnValueOnce(q2 as any);

      const result = await getExerciseCatalogDelta(coachId);

      expect(result).toHaveLength(1000);
      expect(mockFrom).toHaveBeenCalledTimes(2); // full page forces one more fetch
    });

    it("applies `since` as a strict updated_at filter on the first page", async () => {
      const since = "2026-05-01T00:00:00+00:00";
      const q = createMockQuery({ data: [], error: null });
      mockFrom.mockReturnValue(q as any);

      await getExerciseCatalogDelta(coachId, since);

      expect(q.gt).toHaveBeenCalledWith("updated_at", since);
    });

    it("throws when the query errors", async () => {
      const q = createMockQuery({ data: null, error: { message: "boom" } });
      mockFrom.mockReturnValue(q as any);

      await expect(getExerciseCatalogDelta(coachId)).rejects.toThrow(/boom/);
    });
  });

  // =========================================================================
  // =========================================================================

  // =========================================================================
  // updateCatalogExercise / deleteCatalogExercise (coach-owned only)
  // =========================================================================

  describe("updateCatalogExercise", () => {
    it("updates a coach-owned row and returns the mapped exercise", async () => {
      const q = createMockQuery({
        data: {
          id: "ex-1",
          coach_id: "coach-1",
          name: "Walking Lunge",
          muscle_group: "legs",
          equipment: "dumbbell",
          category: "compound",
          aliases: [],
          created_at: "2026-06-01T00:00:00Z",
          updated_at: "2026-07-01T00:00:00Z",
        },
        error: null,
      });
      mockFrom.mockReturnValueOnce(q as any);

      const result = await updateCatalogExercise("ex-1", "coach-1", {
        muscleGroup: "legs",
      });

      expect(q.eq).toHaveBeenCalledWith("id", "ex-1");
      expect(q.eq).toHaveBeenCalledWith("coach_id", "coach-1");
      expect(result.muscleGroup).toBe("legs");
    });

    it("throws Exercise not found for global rows (coach_id filter misses)", async () => {
      const q = createMockQuery({ data: null, error: null });
      mockFrom.mockReturnValueOnce(q as any);

      await expect(
        updateCatalogExercise("ex-global", "coach-1", { name: "X" })
      ).rejects.toThrow("Exercise not found");
    });
  });

  describe("deleteCatalogExercise", () => {
    it("deletes a coach-owned row", async () => {
      const q = createMockQuery({ data: { id: "ex-1" }, error: null });
      mockFrom.mockReturnValueOnce(q as any);

      await deleteCatalogExercise("ex-1", "coach-1");

      expect(q.delete).toHaveBeenCalled();
      expect(q.eq).toHaveBeenCalledWith("id", "ex-1");
      expect(q.eq).toHaveBeenCalledWith("coach_id", "coach-1");
    });

    it("throws Exercise not found for global or foreign rows", async () => {
      const q = createMockQuery({ data: null, error: null });
      mockFrom.mockReturnValueOnce(q as any);

      await expect(deleteCatalogExercise("ex-global", "coach-1")).rejects.toThrow(
        "Exercise not found"
      );
    });
  });

  describe("matchExerciseInRows / suggestExerciseCandidates (read-only, builder S6a)", () => {
    const rows = [
      { id: "e1", coach_id: null, name: "Bench Press", aliases: ["bp"], muscle_group: null, equipment: null, category: "compound", created_at: "", updated_at: "" },
      { id: "e2", coach_id: "coach-1", name: "Romanian Deadlift", aliases: [], muscle_group: null, equipment: null, category: null, created_at: "", updated_at: "" },
    ] as never[];

    it("matches exact, alias, and abbreviation-normalized names without inserting", () => {
      expect(matchExerciseInRows(rows as never, "bench press")?.id).toBe("e1");
      expect(matchExerciseInRows(rows as never, "BP")?.id).toBe("e1");
      expect(matchExerciseInRows(rows as never, "rdl")?.id).toBe("e2");
      expect(matchExerciseInRows(rows as never, "Nonsense Movement")).toBeNull();
      // Pure matcher: the DB was never touched.
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("suggests deterministic repair candidates by word overlap", () => {
      const candidates = suggestExerciseCandidates(rows as never, "incline bench press machine");
      expect(candidates[0]?.name).toBe("Bench Press");
      expect(suggestExerciseCandidates(rows as never, "xyz")).toEqual([]);
      expect(mockFrom).not.toHaveBeenCalled();
    });
  });
});
