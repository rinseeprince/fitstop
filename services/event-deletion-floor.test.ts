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

/** Wire the two reads the floor makes, by table. */
function wire(rows: {
  nutritionLog?: { id: string } | null;
  trainingEvent?: { id: string } | null;
  nutritionError?: unknown;
  trainingError?: unknown;
}) {
  const nutrition = query({
    data: rows.nutritionLog ?? null,
    error: rows.nutritionError ?? null,
  });
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
  it("is the client's today when they have not touched it", async () => {
    wire({});
    expect(await resolveEventDeletionFloor("client-31", TODAY)).toBe(TODAY);
  });

  it("moves to tomorrow when they have logged food today", async () => {
    // Emptying the day would cost them their target for the rest of it, and
    // every save after that would store a blank one.
    wire({ nutritionLog: { id: "log-52" } });
    expect(await resolveEventDeletionFloor("client-31", TODAY)).toBe(TOMORROW);
  });

  it("moves to tomorrow when today's training event has left 'scheduled'", async () => {
    wire({ trainingEvent: { id: "event-73" } });
    expect(await resolveEventDeletionFloor("client-31", TODAY)).toBe(TOMORROW);
  });

  it("asks BOTH tracks — a nutrition event's status can never answer this", async () => {
    // A nutrition event never leaves 'scheduled', so the nutrition half has to
    // be a nutrition_logs read; the training half has to be the status.
    const { nutrition, training } = wire({});
    await resolveEventDeletionFloor("client-31", TODAY);

    expect(mockFrom).toHaveBeenCalledWith("nutrition_logs");
    expect(mockFrom).toHaveBeenCalledWith("training_events");
    expect(nutrition.eq).toHaveBeenCalledWith("date", TODAY);
    expect(training.neq).toHaveBeenCalledWith("status", "scheduled");
  });

  it("scopes both reads to the client", async () => {
    const { nutrition, training } = wire({});
    await resolveEventDeletionFloor("client-94", TODAY);

    expect(nutrition.eq).toHaveBeenCalledWith("client_id", "client-94");
    expect(training.eq).toHaveBeenCalledWith("client_id", "client-94");
  });

  it("fails CLOSED to tomorrow when a read errors", async () => {
    // Unable to prove today is untouched. A day skipped is a stale row the next
    // removal clears; a day emptied cannot be undone.
    wire({ nutritionError: new Error("read failed") });
    expect(await resolveEventDeletionFloor("client-31", TODAY)).toBe(TOMORROW);

    wire({ trainingError: new Error("read failed") });
    expect(await resolveEventDeletionFloor("client-31", TODAY)).toBe(TOMORROW);
  });

  it("crosses a month boundary correctly", async () => {
    wire({ nutritionLog: { id: "log-18" } });
    expect(await resolveEventDeletionFloor("client-31", "2026-11-30")).toBe(
      "2026-12-01"
    );
  });
});
