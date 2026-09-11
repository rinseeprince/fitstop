import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("@/lib/error-handler", () => ({ captureApiError: vi.fn() }));

import { supabaseAdmin } from "./supabase-admin";
import { resolveEventDeletionFloor } from "./event-deletion-floor";

const mockFrom = vi.mocked(supabaseAdmin.from);

const TODAY = "2026-09-08";
const TOMORROW = "2026-09-09";

function query(result: { data: { id: string } | null; error: unknown }) {
  const q: Record<string, unknown> = {};
  const chain = () => q;
  Object.assign(q, {
    select: vi.fn(chain),
    eq: vi.fn(chain),
    neq: vi.fn(chain),
    limit: vi.fn(chain),
    maybeSingle: vi.fn().mockResolvedValue(result),
  });
  return q as Record<string, ReturnType<typeof vi.fn>>;
}

/**
 * Wire the tables the floor might read. The training read is the ONE read it
 * makes; a nutrition_logs row is wired too, so a floor that went back to
 * asking about meals would find one and fail the tests below.
 */
function wire(rows: {
  nutritionLog?: { id: string } | null;
  trainingEvent?: { id: string } | null;
  trainingError?: unknown;
}) {
  const nutrition = query({ data: rows.nutritionLog ?? null, error: null });
  const training = query({
    data: rows.trainingEvent ?? null,
    error: rows.trainingError ?? null,
  });
  mockFrom.mockImplementation((table: string) => {
    if (table === "nutrition_logs") return nutrition as never;
    if (table === "training_events") return training as never;
    throw new Error(`Unexpected table: ${table}`);
  });
  return { nutrition, training };
}

beforeEach(() => vi.clearAllMocks());

describe("resolveEventDeletionFloor", () => {
  it("is the client's today when they have not trained today", async () => {
    wire({});
    expect(await resolveEventDeletionFloor("client-31", TODAY)).toBe(TODAY);
  });

  it("moves to tomorrow when today's training event has left 'scheduled'", async () => {
    wire({ trainingEvent: { id: "event-73" } });
    expect(await resolveEventDeletionFloor("client-31", TODAY)).toBe(TOMORROW);
  });

  // Owner, 2026-09-11: today's targets are the coach's to replace whatever the
  // client has eaten, and a logged today is re-recorded onto their log when
  // they do. A meal therefore moves nothing — neither a program's start nor a
  // removal — and the floor does not even ask about one.
  it("a meal logged today moves nothing: the floor stays today and reads no nutrition table", async () => {
    const { training } = wire({ nutritionLog: { id: "log-52" } });

    expect(await resolveEventDeletionFloor("client-31", TODAY)).toBe(TODAY);
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledWith("training_events");
    expect(mockFrom).not.toHaveBeenCalledWith("nutrition_logs");
    expect(training.neq).toHaveBeenCalledWith("status", "scheduled");
    expect(training.eq).toHaveBeenCalledWith("date", TODAY);
  });

  it("scopes the read to the client", async () => {
    const { training } = wire({});
    await resolveEventDeletionFloor("client-94", TODAY);

    expect(training.eq).toHaveBeenCalledWith("client_id", "client-94");
  });

  it("fails CLOSED to tomorrow when the read errors", async () => {
    // Unable to prove today is untouched. A day skipped is a stale row the next
    // removal clears; a day emptied cannot be undone.
    wire({ trainingError: new Error("read failed") });
    expect(await resolveEventDeletionFloor("client-31", TODAY)).toBe(TOMORROW);
  });

  it("crosses a month boundary correctly", async () => {
    wire({ trainingEvent: { id: "event-18" } });
    expect(await resolveEventDeletionFloor("client-31", "2026-11-30")).toBe(
      "2026-12-01"
    );
  });
});
