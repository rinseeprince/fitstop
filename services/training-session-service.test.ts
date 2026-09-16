import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase-admin before importing the service
vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

vi.mock("./training-mappers", () => ({
  mapExerciseRow: vi.fn(),
  mapSessionRow: vi.fn(),
}));

vi.mock("./exercise-catalog-service", () => ({
  resolveExercises: vi.fn(),
}));

import { supabaseAdmin } from "./supabase-admin";
import { updateSurplusForFutureEvents } from "./training-session-service";

const mockFrom = vi.mocked(supabaseAdmin.from);

describe("updateSurplusForFutureEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates only scheduled events for the given session from fromDate onward", async () => {
    // Chain mock: from().update().eq().gte().eq() resolves the write's result.
    // Nothing is selected back — a day's nutrition target reads the surplus
    // off the event, so the caller has no dates to hand anyone.
    const innerEq = vi.fn().mockResolvedValue({ error: null });
    const gte = vi.fn().mockReturnValue({ eq: innerEq });
    const outerEq = vi.fn().mockReturnValue({ gte });
    const update = vi.fn().mockReturnValue({ eq: outerEq });

    mockFrom.mockReturnValue({ update } as unknown as ReturnType<typeof mockFrom>);

    await expect(
      updateSurplusForFutureEvents("session-1", 20, "2026-04-22"),
    ).resolves.toBeUndefined();

    expect(mockFrom).toHaveBeenCalledWith("training_events");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        calorie_surplus_percentage: 20,
        is_modified: true,
      }),
    );
    expect(outerEq).toHaveBeenCalledWith("training_session_id", "session-1");
    expect(gte).toHaveBeenCalledWith("date", "2026-04-22");
    expect(innerEq).toHaveBeenCalledWith("status", "scheduled");
  });

  it("accepts null surplus (clears the value)", async () => {
    const innerEq = vi.fn().mockResolvedValue({ error: null });
    const gte = vi.fn().mockReturnValue({ eq: innerEq });
    const outerEq = vi.fn().mockReturnValue({ gte });
    const update = vi.fn().mockReturnValue({ eq: outerEq });

    mockFrom.mockReturnValue({ update } as unknown as ReturnType<typeof mockFrom>);

    await updateSurplusForFutureEvents("session-1", null, "2026-04-22");

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ calorie_surplus_percentage: null }),
    );
  });

  it("throws on db error with a descriptive message", async () => {
    const innerEq = vi.fn().mockResolvedValue({ error: { message: "permission denied" } });
    const gte = vi.fn().mockReturnValue({ eq: innerEq });
    const outerEq = vi.fn().mockReturnValue({ gte });
    const update = vi.fn().mockReturnValue({ eq: outerEq });

    mockFrom.mockReturnValue({ update } as unknown as ReturnType<typeof mockFrom>);

    await expect(
      updateSurplusForFutureEvents("session-1", 15, "2026-04-22"),
    ).rejects.toThrow(/permission denied/);
  });
});
