import { describe, it, expect, vi, beforeEach } from "vitest";

const fromMock = vi.fn();
vi.mock("./supabase-admin", () => ({
  supabaseAdmin: { from: (...a: unknown[]) => fromMock(...a) },
}));

import {
  listNutritionPlanNotesInRange,
  recordPlanSaveNote,
} from "./nutrition-plan-notes-service";

// Chainable builder: awaitable (→ {data,error}), matching the house idiom in
// client-notes-service.test.ts. `range` is included because the read pages.
function makeChain(response: { data?: unknown; error?: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const m of ["update", "insert", "select", "eq", "gte", "lte", "order", "range"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: response.data ?? null, error: response.error ?? null });
  return chain;
}

const PARAMS = {
  clientId: "client-1",
  coachId: "coach-1",
  planId: "plan-1",
  effectiveOn: "2026-09-14",
  body: "Dropping calories 200 while we hold training volume.",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recordPlanSaveNote — one store", () => {
  it("inserts the trimmed note, scoped to the client, the version and the date, and writes nothing else", async () => {
    const insertChain = makeChain({});
    fromMock.mockReturnValueOnce(insertChain);

    await recordPlanSaveNote({ ...PARAMS, body: `  ${PARAMS.body}  ` });

    expect(insertChain.insert).toHaveBeenCalledWith({
      client_id: "client-1",
      coach_id: "coach-1",
      nutrition_plan_id: "plan-1",
      effective_on: "2026-09-14",
      body: PARAMS.body,
    });
    // The calendar reads the note on its date through the computed day; there
    // is no stamp on a day row to keep in step with this insert.
    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(fromMock).toHaveBeenCalledWith("nutrition_plan_notes");
    expect(insertChain.update).not.toHaveBeenCalled();
  });

  it("writes nothing when the note is empty or whitespace", async () => {
    await recordPlanSaveNote({ ...PARAMS, body: "   " });
    await recordPlanSaveNote({ ...PARAMS, body: undefined });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("APPENDS — two saves on the same effective date leave two rows", async () => {
    // The property nutrition_plans.coach_notes could not hold: its always-update
    // bucket nulled the previous note, so the second save destroyed the first.
    // There is no unique constraint on (client_id, effective_on) and no upsert
    // here, so each save is its own row.
    fromMock.mockReturnValueOnce(makeChain({})).mockReturnValueOnce(makeChain({}));

    await recordPlanSaveNote({ ...PARAMS, body: "first" });
    await recordPlanSaveNote({ ...PARAMS, body: "second" });

    const inserts = fromMock.mock.calls.filter((c) => c[0] === "nutrition_plan_notes");
    expect(inserts).toHaveLength(2);
  });

  it("throws when the insert fails — the note is client-visible and a lost one must reach the coach", async () => {
    fromMock.mockReturnValueOnce(makeChain({ error: { message: "insert boom" } }));

    await expect(recordPlanSaveNote(PARAMS)).rejects.toThrow(/insert boom/);
  });
});

describe("listNutritionPlanNotesInRange", () => {
  it("scopes to the client and the window, oldest first with a unique tiebreak", async () => {
    const chain = makeChain({
      data: [
        { id: "n-1", effective_on: "2026-09-14", body: "first" },
        { id: "n-2", effective_on: "2026-09-14", body: "second" },
      ],
    });
    fromMock.mockReturnValue(chain);

    const notes = await listNutritionPlanNotesInRange(
      "client-1",
      "2026-09-01",
      "2026-09-30"
    );

    expect(chain.eq).toHaveBeenCalledWith("client_id", "client-1");
    expect(chain.gte).toHaveBeenCalledWith("effective_on", "2026-09-01");
    expect(chain.lte).toHaveBeenCalledWith("effective_on", "2026-09-30");
    // effective_on is NOT unique per client (the append-only property), so the
    // paging contract needs `id` as the unique tiebreak or a page boundary can
    // repeat or skip a note.
    expect(chain.order).toHaveBeenCalledWith("effective_on", { ascending: true });
    expect(chain.order).toHaveBeenCalledWith("created_at", { ascending: true });
    expect(chain.order).toHaveBeenCalledWith("id", { ascending: true });
    expect(notes).toEqual([
      { id: "n-1", effectiveOn: "2026-09-14", body: "first" },
      { id: "n-2", effectiveOn: "2026-09-14", body: "second" },
    ]);
  });

  it("surfaces a read failure rather than returning a short list", async () => {
    fromMock.mockReturnValue(makeChain({ error: { message: "read boom" } }));
    await expect(
      listNutritionPlanNotesInRange("client-1", "2026-09-01", "2026-09-30")
    ).rejects.toThrow(/nutrition plan notes/);
  });
});
