import { describe, it, expect, vi, beforeEach } from "vitest";

const fromMock = vi.fn();
vi.mock("./supabase-admin", () => ({
  supabaseAdmin: { from: (...args: unknown[]) => fromMock(...args) },
}));

import {
  deleteNutritionDayEdits,
  deleteNutritionDayEditsInRanges,
  getNutritionDayEditsForRange,
  upsertNutritionDayEdits,
} from "./nutrition-day-edits-service";

type Response = { data?: unknown; error?: { message: string } | null; count?: number | null };

// Chainable builder: every method self-returns, awaiting resolves the response.
function makeChain(response: Response) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gte", "lte", "in", "or", "order", "range", "upsert", "delete"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (value: Response) => unknown) =>
    resolve({ data: response.data ?? null, error: response.error ?? null, count: response.count ?? null });
  return chain;
}

const spy = (chain: Record<string, unknown>, method: string) => chain[method] as ReturnType<typeof vi.fn>;

const CLIENT = "client-53";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getNutritionDayEditsForRange", () => {
  it("reads the client's edits inside the range, oldest first, and maps the rows", async () => {
    const chain = makeChain({
      data: [
        { date: "2026-11-03", calories: 1650, protein_g: 145, carb_g: 160, fat_g: 55, note: "Travel" },
        { date: "2026-11-04", calories: 1725, protein_g: 150, carb_g: 170, fat_g: 57, note: null },
      ],
    });
    fromMock.mockReturnValue(chain);

    const edits = await getNutritionDayEditsForRange(CLIENT, "2026-11-01", "2026-11-30");

    expect(fromMock).toHaveBeenCalledWith("nutrition_day_edits");
    expect(spy(chain, "select")).toHaveBeenCalledWith("date, calories, protein_g, carb_g, fat_g, note");
    expect(spy(chain, "eq")).toHaveBeenCalledWith("client_id", CLIENT);
    expect(spy(chain, "gte")).toHaveBeenCalledWith("date", "2026-11-01");
    expect(spy(chain, "lte")).toHaveBeenCalledWith("date", "2026-11-30");
    expect(spy(chain, "order")).toHaveBeenCalledWith("date", { ascending: true });
    expect(edits).toEqual([
      { date: "2026-11-03", calories: 1650, proteinG: 145, carbG: 160, fatG: 55, note: "Travel" },
      { date: "2026-11-04", calories: 1725, proteinG: 150, carbG: 170, fatG: 57, note: null },
    ]);
  });

  it("pages past the row cap — a full first page asks for a second", async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({
      date: `2020-${String(1 + Math.floor(i / 100)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`,
      calories: 1800,
      protein_g: 150,
      carb_g: 200,
      fat_g: 60,
      note: null,
    }));
    const page1 = makeChain({ data: fullPage });
    const page2 = makeChain({
      data: [{ date: "2026-11-03", calories: 1650, protein_g: 145, carb_g: 160, fat_g: 55, note: null }],
    });
    fromMock.mockReturnValueOnce(page1).mockReturnValueOnce(page2);

    const edits = await getNutritionDayEditsForRange(CLIENT, "2020-01-01", "2026-11-30");

    expect(fromMock).toHaveBeenCalledTimes(2);
    expect(spy(page1, "range")).toHaveBeenCalledWith(0, 999);
    expect(spy(page2, "range")).toHaveBeenCalledWith(1000, 1999);
    expect(edits).toHaveLength(1001);
  });

  it("throws on a query error", async () => {
    fromMock.mockReturnValue(makeChain({ error: { message: "boom" } }));

    await expect(getNutritionDayEditsForRange(CLIENT, "2026-11-01", "2026-11-30")).rejects.toThrow(/boom/);
  });
});

describe("upsertNutritionDayEdits", () => {
  it("writes every day in ONE upsert on (client_id, date), the coach stamped on each row", async () => {
    const chain = makeChain({});
    fromMock.mockReturnValue(chain);

    await upsertNutritionDayEdits(CLIENT, "coach-9", [
      { date: "2026-11-03", calories: 1650, proteinG: 145, carbG: 160, fatG: 55, note: "Travel" },
      { date: "2026-11-05", calories: 1700, proteinG: 148, carbG: 165, fatG: 56, note: null },
    ]);

    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(fromMock).toHaveBeenCalledWith("nutrition_day_edits");
    expect(spy(chain, "upsert")).toHaveBeenCalledTimes(1);
    const [rows, options] = spy(chain, "upsert").mock.calls[0] as [Record<string, unknown>[], unknown];
    expect(options).toEqual({ onConflict: "client_id,date" });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      client_id: CLIENT,
      coach_id: "coach-9",
      date: "2026-11-03",
      calories: 1650,
      protein_g: 145,
      carb_g: 160,
      fat_g: 55,
      note: "Travel",
    });
    expect(rows[1]).toMatchObject({ date: "2026-11-05", note: null, coach_id: "coach-9" });
    // The edit is re-stamped as written.
    expect(typeof rows[0].updated_at).toBe("string");
  });

  it("writes nothing for an empty list", async () => {
    await upsertNutritionDayEdits(CLIENT, "coach-9", []);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("throws on a write error", async () => {
    fromMock.mockReturnValue(makeChain({ error: { message: "boom" } }));

    await expect(
      upsertNutritionDayEdits(CLIENT, "coach-9", [
        { date: "2026-11-03", calories: 1650, proteinG: 145, carbG: 160, fatG: 55, note: null },
      ])
    ).rejects.toThrow(/boom/);
  });
});

describe("deleteNutritionDayEdits", () => {
  it("removes the client's edits on the dates in ONE statement and returns how many held one", async () => {
    const chain = makeChain({ count: 2 });
    fromMock.mockReturnValue(chain);

    const removed = await deleteNutritionDayEdits(CLIENT, ["2026-11-03", "2026-11-04", "2026-11-05"]);

    expect(removed).toBe(2);
    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(spy(chain, "delete")).toHaveBeenCalledWith({ count: "exact" });
    expect(spy(chain, "eq")).toHaveBeenCalledWith("client_id", CLIENT);
    expect(spy(chain, "in")).toHaveBeenCalledWith("date", ["2026-11-03", "2026-11-04", "2026-11-05"]);
  });

  it("removes nothing for an empty list", async () => {
    expect(await deleteNutritionDayEdits(CLIENT, [])).toBe(0);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("throws on a delete error", async () => {
    fromMock.mockReturnValue(makeChain({ error: { message: "boom" } }));

    await expect(deleteNutritionDayEdits(CLIENT, ["2026-11-03"])).rejects.toThrow(/boom/);
  });
});

describe("deleteNutritionDayEditsInRanges", () => {
  it("removes the edits inside every range in ONE statement — an `or` of per-range `and`s, so days between the ranges are never touched", async () => {
    const chain = makeChain({ count: 3 });
    fromMock.mockReturnValue(chain);

    const removed = await deleteNutritionDayEditsInRanges(CLIENT, [
      { from: "2026-07-02", to: "2026-08-31" },
      { from: "2026-09-14", to: "2026-09-30" },
    ]);

    expect(removed).toBe(3);
    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(fromMock).toHaveBeenCalledWith("nutrition_day_edits");
    expect(spy(chain, "delete")).toHaveBeenCalledWith({ count: "exact" });
    expect(spy(chain, "eq")).toHaveBeenCalledWith("client_id", CLIENT);
    expect(spy(chain, "or")).toHaveBeenCalledWith(
      "and(date.gte.2026-07-02,date.lte.2026-08-31),and(date.gte.2026-09-14,date.lte.2026-09-30)"
    );
    // A range is inclusive at both ends and never spelled as a plain gte/lte
    // pair, which would join the ranges into one span.
    expect(spy(chain, "gte")).not.toHaveBeenCalled();
    expect(spy(chain, "lte")).not.toHaveBeenCalled();
  });

  it("drops an inverted range and removes nothing when none is left", async () => {
    expect(await deleteNutritionDayEditsInRanges(CLIENT, [{ from: "2026-09-12", to: "2026-09-11" }])).toBe(0);
    expect(await deleteNutritionDayEditsInRanges(CLIENT, [])).toBe(0);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("refuses a bound that is not a date before touching the table — the belt on the filter string", async () => {
    await expect(
      deleteNutritionDayEditsInRanges(CLIENT, [{ from: "2026-09-12", to: "2026-09-30)" }])
    ).rejects.toThrow(/Invalid date range/);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("throws on a delete error", async () => {
    fromMock.mockReturnValue(makeChain({ error: { message: "boom" } }));

    await expect(
      deleteNutritionDayEditsInRanges(CLIENT, [{ from: "2026-09-12", to: "2026-09-30" }])
    ).rejects.toThrow(/boom/);
  });
});
