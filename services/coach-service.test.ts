import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

import { supabaseAdmin } from "./supabase-admin";
import { updateCoachSettings } from "./coach-service";

function createMockQuery(result: { data: unknown; error: unknown }) {
  return {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  };
}

function createMockCoachRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "coach-123",
    user_id: "user-456",
    name: "Test Coach",
    email: "coach@example.com",
    avatar_url: null,
    timezone: "Europe/London",
    unit_preference: "metric",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-02T00:00:00Z",
    ...overrides,
  };
}

describe("updateCoachSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes timezone + updated_at scoped to the coach id and returns the mapped Coach", async () => {
    const mockQuery = createMockQuery({
      data: createMockCoachRow(),
      error: null,
    });
    vi.mocked(supabaseAdmin.from).mockReturnValue(
      mockQuery as unknown as ReturnType<typeof supabaseAdmin.from>,
    );

    const coach = await updateCoachSettings("coach-123", {
      timezone: "Europe/London",
    });

    expect(supabaseAdmin.from).toHaveBeenCalledWith("coaches");
    expect(mockQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        timezone: "Europe/London",
        updated_at: expect.any(String),
      }),
    );
    expect(mockQuery.eq).toHaveBeenCalledWith("id", "coach-123");

    expect(coach).toMatchObject({
      id: "coach-123",
      userId: "user-456",
      name: "Test Coach",
      email: "coach@example.com",
      timezone: "Europe/London",
    });
    expect(coach.avatarUrl).toBeUndefined();
  });

  it("throws a friendly error when the update fails", async () => {
    const mockQuery = createMockQuery({
      data: null,
      error: { message: "boom" },
    });
    vi.mocked(supabaseAdmin.from).mockReturnValue(
      mockQuery as unknown as ReturnType<typeof supabaseAdmin.from>,
    );

    await expect(
      updateCoachSettings("coach-123", { timezone: "Europe/London" }),
    ).rejects.toThrow("Failed to update coach settings");
  });
});
