import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));
vi.mock("./today-service", () => ({
  getClientTodayString: vi.fn(),
}));

function createMockQuery<T = unknown>(result: {
  data: T | null;
  error: { message: string } | null;
}) {
  const mockQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
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
import { getClientTodayString } from "./today-service";
import { getClientTrainingWeek } from "./client-training-week-service";

const mockFrom = vi.mocked(supabaseAdmin.from);

const TODAY = "2026-08-26"; // Wednesday

function row(id: string, date: string, status: string) {
  return {
    id,
    training_session_id: `s-${id}`,
    date,
    session_name: `Session ${id}`,
    session_focus: null,
    status,
  };
}

describe("getClientTrainingWeek", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getClientTodayString).mockResolvedValue(TODAY);
  });

  it("reads the check-in-anchored week with explicit columns and derives each session's state against the client's today", async () => {
    const eventsQuery = createMockQuery({
      data: [
        row("mon", "2026-08-24", "completed"),
        row("tue", "2026-08-25", "scheduled"), // past, never logged → missed
        row("wed", "2026-08-26", "scheduled"), // today
        row("thu", "2026-08-27", "scheduled"), // upcoming
        row("fri", "2026-08-28", "skipped"),
      ],
      error: null,
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === "training_events") return eventsQuery as any;
      // Check-in day Tuesday → the training week starts Wednesday.
      return createMockQuery({ data: { next_check_in_due: "2026-06-09" }, error: null }) as any;
    });

    const week = await getClientTrainingWeek("client-1", "2026-08-27");

    // Wed 26 … Tue 1 (Sep): the week containing Thu 27 when weeks start Wednesday.
    expect(week.weekStart).toBe("2026-08-26");
    expect(week.weekEnd).toBe("2026-09-01");
    expect(week.today).toBe(TODAY);
    expect(eventsQuery.select).toHaveBeenCalledWith(
      "id, training_session_id, date, session_name, session_focus, status",
    );
    expect(eventsQuery.eq).toHaveBeenCalledWith("client_id", "client-1");
    expect(eventsQuery.gte).toHaveBeenCalledWith("date", "2026-08-26");
    expect(eventsQuery.lte).toHaveBeenCalledWith("date", "2026-09-01");

    expect(week.sessions.map((s) => [s.eventId, s.state])).toEqual([
      ["mon", "done"],
      ["tue", "missed"],
      ["wed", "today"],
      ["thu", "upcoming"],
      ["fri", "missed"],
    ]);
    expect(week.sessions[0]).toMatchObject({
      sessionId: "s-mon",
      name: "Session mon",
      focus: null,
      date: "2026-08-24",
      isScheduled: false,
    });
    // "missed" alone cannot say whether a day can still be moved: a past
    // scheduled day can, a skipped one cannot.
    expect(week.sessions.map((s) => [s.eventId, s.isScheduled])).toEqual([
      ["mon", false],
      ["tue", true],
      ["wed", true],
      ["thu", true],
      ["fri", false],
    ]);
  });

  it("defaults to a Monday-anchored week when the client has no check-in day", async () => {
    const eventsQuery = createMockQuery({ data: [], error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "training_events") return eventsQuery as any;
      return createMockQuery({ data: { next_check_in_due: null }, error: null }) as any;
    });

    const week = await getClientTrainingWeek("client-1", TODAY);

    expect(week.weekStart).toBe("2026-08-24");
    expect(week.weekEnd).toBe("2026-08-30");
    expect(week.sessions).toEqual([]);
  });

  it("throws on a read failure rather than returning an empty week", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "training_events") {
        return createMockQuery({ data: null, error: { message: "boom" } }) as any;
      }
      return createMockQuery({ data: { next_check_in_due: null }, error: null }) as any;
    });

    await expect(getClientTrainingWeek("client-1", TODAY)).rejects.toThrow(
      "Failed to load training week: boom",
    );
  });
});
