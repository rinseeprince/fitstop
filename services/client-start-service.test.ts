import { describe, it, expect, vi, beforeEach } from "vitest";

const { state } = vi.hoisted(() => ({
  state: {
    tables: [] as string[],
    updates: [] as Record<string, unknown>[],
    scopes: [] as [string, string][],
    error: null as { message: string } | null,
  },
}));

vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      state.tables.push(table);
      return {
        update: (payload: Record<string, unknown>) => {
          state.updates.push(payload);
          return {
            eq: (column: string, value: string) => {
              state.scopes.push([column, value]);
              return Promise.resolve({ error: state.error });
            },
          };
        },
      };
    },
  },
}));

import { recordClientStart } from "./client-start-service";

beforeEach(() => {
  state.tables = [];
  state.updates = [];
  state.scopes = [];
  state.error = null;
});

describe("recordClientStart", () => {
  it("writes the start date and updated_at, scoped to the client", async () => {
    await recordClientStart("c1", { startsOn: "2026-08-21" });

    expect(state.updates).toEqual([
      { start_date: "2026-08-21", updated_at: expect.any(String) },
    ]);
    expect(state.scopes).toEqual([["id", "c1"]]);
  });

  it("issues ONE statement on clients and nothing else — the baseline is derived, never stored", async () => {
    // The origin is a date. What the client measured when they began is the
    // reading as of that date in the measurement log
    // (client_baseline_measurements), so no weight, body fat or entry travels
    // with it, and moving the date re-derives the baseline and re-dates nothing.
    await recordClientStart("c1", { startsOn: "2026-08-14" });

    expect(state.tables).toEqual(["clients"]);
    expect(Object.keys(state.updates[0]).sort()).toEqual(["start_date", "updated_at"]);
  });

  it("throws with the database message on a failed write", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    state.error = { message: "connection lost" };

    await expect(recordClientStart("c1", { startsOn: "2026-08-21" })).rejects.toThrow(
      "Failed to save start date: connection lost"
    );
    spy.mockRestore();
  });
});
