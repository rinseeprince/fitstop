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
    ilike: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
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
  resolveExercise,
  resolveExercises,
  normalizeExerciseName,
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

  describe("resolveExercise", () => {
    const coachId = "coach-1";

    it("returns existing exercise ID on exact name match (case-insensitive)", async () => {
      const mockQuery = createMockQuery({
        data: [
          {
            id: "ex-1",
            name: "Bench Press",
            coach_id: coachId,
            aliases: [],
          },
        ],
        error: null,
      });
      mockFrom.mockReturnValue(mockQuery as any);

      const result = await resolveExercise("bench press", coachId);

      expect(result).toBe("ex-1");
      expect(mockFrom).toHaveBeenCalledWith("exercises");
      // Should not insert (only 1 call to from)
      expect(mockFrom).toHaveBeenCalledTimes(1);
    });

    it("returns existing exercise ID on alias match", async () => {
      const mockQuery = createMockQuery({
        data: [
          {
            id: "ex-2",
            name: "Barbell Back Squat",
            coach_id: null,
            aliases: ["back squat", "squat"],
          },
        ],
        error: null,
      });
      mockFrom.mockReturnValue(mockQuery as any);

      const result = await resolveExercise("back squat", coachId);

      expect(result).toBe("ex-2");
    });

    it("normalizes abbreviations and matches", async () => {
      const mockQuery = createMockQuery({
        data: [
          {
            id: "ex-3",
            name: "Dumbbell Bench Press",
            coach_id: null,
            aliases: [],
          },
        ],
        error: null,
      });
      mockFrom.mockReturnValue(mockQuery as any);

      const result = await resolveExercise("DB Bench Press", coachId);

      expect(result).toBe("ex-3");
    });

    it("creates a new coach-specific exercise when no match found", async () => {
      // First call: fetch returns empty
      const fetchQuery = createMockQuery({
        data: [],
        error: null,
      });
      // Second call: insert returns new exercise
      const insertQuery = createMockQuery({
        data: { id: "new-ex-1", name: "Cable Fly", coach_id: coachId },
        error: null,
      });

      mockFrom
        .mockReturnValueOnce(fetchQuery as any)
        .mockReturnValueOnce(insertQuery as any);

      const result = await resolveExercise("Cable Fly", coachId);

      expect(result).toBe("new-ex-1");
      expect(mockFrom).toHaveBeenCalledTimes(2);
      // Verify insert was called
      expect(insertQuery.insert).toHaveBeenCalledWith({
        coach_id: coachId,
        name: "Cable Fly",
      });
    });

    it("coach-specific exercises take precedence over global", async () => {
      const mockQuery = createMockQuery({
        data: [
          // Coach-specific first (due to order by coach_id DESC NULLS LAST)
          {
            id: "ex-coach",
            name: "Bench Press",
            coach_id: coachId,
            aliases: [],
          },
          {
            id: "ex-global",
            name: "Bench Press",
            coach_id: null,
            aliases: [],
          },
        ],
        error: null,
      });
      mockFrom.mockReturnValue(mockQuery as any);

      const result = await resolveExercise("bench press", coachId);

      expect(result).toBe("ex-coach");
    });
  });

  // =========================================================================
  // resolveExercises (batch)
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
  });
});
