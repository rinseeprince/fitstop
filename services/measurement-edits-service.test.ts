import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The three row actions over mocked collaborators: the scoped row read and
 * the three RPCs. The SQL belts themselves (a foreign row, a removed row, a
 * double void, the last weight, an unchanged value) are proven on the real
 * database by scripts/measurement-edit-proof.ts — a vitest that mocks
 * supabaseAdmin proves nothing about them.
 */
const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  recalculate: vi.fn(),
  getMeasurementReading: vi.fn(),
}));

vi.mock("./supabase-admin", () => ({
  supabaseAdmin: { rpc: (...args: unknown[]) => state.rpc(...args) },
}));
vi.mock("./client-energy-service", () => ({
  recalculateClientEnergy: (...args: unknown[]) => state.recalculate(...args),
}));
vi.mock("./measurements-service", () => ({
  getMeasurementReading: (...args: unknown[]) => state.getMeasurementReading(...args),
}));

import {
  restoreMeasurement,
  updateMeasurement,
  voidMeasurement,
} from "./measurement-edits-service";
import {
  MeasurementNotFoundError,
  MeasurementStateError,
  MeasurementValueError,
} from "@/lib/measurements/edit-errors";
import type { MeasurementLogReading } from "./measurements-service";

const CLIENT = "11111111-1111-4111-8111-111111111111";
const ROW = "22222222-2222-4222-8222-222222222222";
const COACH = "33333333-3333-4333-8333-333333333333";

function reading(over: Partial<MeasurementLogReading> = {}): MeasurementLogReading {
  return {
    id: ROW,
    metricKey: "weight",
    value: 91,
    date: "2026-08-14",
    recordedAt: "2026-08-14T08:00:00+00:00",
    updatedAt: "2026-08-14T08:00:00+00:00",
    measuredAt: "2026-08-14T07:30:00+00:00",
    source: "check_in",
    sourceId: "ci-1",
    note: null,
    voided: null,
    ...over,
  };
}

const updateRow = (over: Partial<{ metric: string; changed: boolean; affects_current: boolean }> = {}) => ({
  data: [{ metric: "weight", changed: true, affects_current: true, ...over }],
  error: null,
});

beforeEach(() => {
  state.rpc.mockReset();
  state.recalculate.mockReset().mockResolvedValue({ status: "written" });
  state.getMeasurementReading.mockReset().mockResolvedValue(reading());
});

describe("updateMeasurement", () => {
  it("reads the row scoped by client, and a missing one is not found before any RPC", async () => {
    state.getMeasurementReading.mockResolvedValue(null);

    await expect(
      updateMeasurement({ clientId: CLIENT, measurementId: ROW, value: 90 })
    ).rejects.toBeInstanceOf(MeasurementNotFoundError);
    expect(state.getMeasurementReading).toHaveBeenCalledWith(CLIENT, ROW);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("refuses to edit a removed reading", async () => {
    state.getMeasurementReading.mockResolvedValue(
      reading({ voided: { at: "2026-09-03T10:00:00+00:00", byName: "Sam", reason: null } })
    );

    await expect(
      updateMeasurement({ clientId: CLIENT, measurementId: ROW, value: 90 })
    ).rejects.toThrow(/Restore the reading before editing it/);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("checks the value against the ROW's metric bounds — a 300 kg weight is refused, a 30 cm arm is not", async () => {
    await expect(
      updateMeasurement({ clientId: CLIENT, measurementId: ROW, value: 300 })
    ).rejects.toBeInstanceOf(MeasurementValueError);
    expect(state.rpc).not.toHaveBeenCalled();

    state.getMeasurementReading.mockResolvedValue(reading({ metricKey: "arms", value: 33, sourceId: null }));
    state.rpc.mockResolvedValue(updateRow({ metric: "arms" }));
    await expect(
      updateMeasurement({ clientId: CLIENT, measurementId: ROW, value: 30 })
    ).resolves.toMatchObject({ updated: true, metricKey: "arms", energy: "not_newest" });
  });

  it("calls the RPC with the row, the client and the value — no actor — and answers with the same row", async () => {
    state.rpc.mockResolvedValue(updateRow());

    const result = await updateMeasurement({ clientId: CLIENT, measurementId: ROW, value: 90 });

    expect(state.rpc).toHaveBeenCalledWith("update_measurement", {
      p_id: ROW,
      p_client_id: CLIENT,
      p_value: 90,
    });
    expect(result).toEqual({
      id: ROW,
      metricKey: "weight",
      sourceId: "ci-1",
      date: "2026-08-14",
      updated: true,
      energy: "recomputed",
    });
    expect(state.recalculate).toHaveBeenCalledWith(CLIENT);
  });

  it("recomputes the pair only when the edit CHANGED the client's newest weight or body fat", async () => {
    // Changed, but the row is not the newest of its metric.
    state.rpc.mockResolvedValue(updateRow({ affects_current: false }));
    const older = await updateMeasurement({ clientId: CLIENT, measurementId: ROW, value: 90 });
    expect(older).toMatchObject({ updated: true, energy: "not_newest" });
    expect(state.recalculate).not.toHaveBeenCalled();

    // Unchanged: nothing was written, so nothing moved — whatever the RPC says
    // about the row's standing.
    state.rpc.mockResolvedValue(updateRow({ changed: false, affects_current: true }));
    const same = await updateMeasurement({ clientId: CLIENT, measurementId: ROW, value: 91 });
    expect(same).toMatchObject({ updated: false, energy: "not_newest" });
    expect(state.recalculate).not.toHaveBeenCalled();

    // A girth is never the pair's input, even as the newest reading.
    state.getMeasurementReading.mockResolvedValue(reading({ metricKey: "waist", value: 80, sourceId: null }));
    state.rpc.mockResolvedValue(updateRow({ metric: "waist" }));
    const girth = await updateMeasurement({ clientId: CLIENT, measurementId: ROW, value: 79 });
    expect(girth.energy).toBe("not_newest");
    expect(state.recalculate).not.toHaveBeenCalled();
  });

  it("turns the RPC's refusals into the typed errors", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: "not_found: reading x is not this client's" } });
    await expect(
      updateMeasurement({ clientId: CLIENT, measurementId: ROW, value: 90 })
    ).rejects.toBeInstanceOf(MeasurementNotFoundError);

    state.rpc.mockResolvedValue({ data: null, error: { message: "voided: reading x is removed" } });
    await expect(
      updateMeasurement({ clientId: CLIENT, measurementId: ROW, value: 90 })
    ).rejects.toBeInstanceOf(MeasurementStateError);
    expect(state.recalculate).not.toHaveBeenCalled();
  });

  it("surfaces an unexpected RPC failure or an empty answer as a plain error, never as a refusal", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    state.rpc.mockResolvedValue({ data: null, error: { message: "connection reset" } });
    await expect(
      updateMeasurement({ clientId: CLIENT, measurementId: ROW, value: 90 })
    ).rejects.toThrow("Failed to update the reading: connection reset");

    state.rpc.mockResolvedValue({ data: [], error: null });
    await expect(
      updateMeasurement({ clientId: CLIENT, measurementId: ROW, value: 90 })
    ).rejects.toThrow("update_measurement returned no row");
    consoleError.mockRestore();
  });
});

describe("voidMeasurement", () => {
  it("calls the RPC with the row, the client and the actor, and OMITS an absent reason", async () => {
    state.rpc.mockResolvedValue({ data: [{ metric: "waist", affects_current: false }], error: null });

    const result = await voidMeasurement({ clientId: CLIENT, measurementId: ROW, actor: COACH });

    expect(state.rpc).toHaveBeenCalledWith("void_measurement", {
      p_id: ROW,
      p_client_id: CLIENT,
      p_actor: COACH,
    });
    expect(state.rpc.mock.calls[0][1]).not.toHaveProperty("p_reason");
    expect(result).toEqual({ id: ROW, metricKey: "waist", sourceId: "ci-1", energy: "not_newest" });
  });

  it("passes a reason through when one is given, trimmed", async () => {
    state.rpc.mockResolvedValue({ data: [{ metric: "waist", affects_current: false }], error: null });

    await voidMeasurement({ clientId: CLIENT, measurementId: ROW, actor: COACH, reason: "  typo " });

    expect(state.rpc.mock.calls[0][1]).toMatchObject({ p_reason: "typo" });
  });

  it("recomputes the energy pair only when the removed row was the newest weight or body fat", async () => {
    state.rpc.mockResolvedValue({ data: [{ metric: "weight", affects_current: true }], error: null });
    const newest = await voidMeasurement({ clientId: CLIENT, measurementId: ROW, actor: COACH });
    expect(newest.energy).toBe("recomputed");
    expect(state.recalculate).toHaveBeenCalledWith(CLIENT);

    state.recalculate.mockClear();
    state.rpc.mockResolvedValue({ data: [{ metric: "weight", affects_current: false }], error: null });
    const older = await voidMeasurement({ clientId: CLIENT, measurementId: ROW, actor: COACH });
    expect(older.energy).toBe("not_newest");
    expect(state.recalculate).not.toHaveBeenCalled();

    // A girth is never the pair's input, even as the newest reading.
    state.rpc.mockResolvedValue({ data: [{ metric: "waist", affects_current: true }], error: null });
    const girth = await voidMeasurement({ clientId: CLIENT, measurementId: ROW, actor: COACH });
    expect(girth.energy).toBe("not_newest");
    expect(state.recalculate).not.toHaveBeenCalled();
  });

  it("turns the RPC's refusals into the typed errors, and a foreign row is not found", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: "already_voided: reading x is already removed" } });
    await expect(
      voidMeasurement({ clientId: CLIENT, measurementId: ROW, actor: COACH })
    ).rejects.toBeInstanceOf(MeasurementStateError);

    state.rpc.mockResolvedValue({ data: null, error: { message: "last_weight: the only weight reading cannot be removed" } });
    await expect(
      voidMeasurement({ clientId: CLIENT, measurementId: ROW, actor: COACH })
    ).rejects.toThrow(/Edit it instead/);

    state.rpc.mockResolvedValue({ data: null, error: { message: "not_found: reading x is not this client's" } });
    await expect(
      voidMeasurement({ clientId: CLIENT, measurementId: ROW, actor: COACH })
    ).rejects.toBeInstanceOf(MeasurementNotFoundError);
  });

  it("surfaces an unexpected RPC failure as a plain error, never as a refusal", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: "connection reset" } });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      voidMeasurement({ clientId: CLIENT, measurementId: ROW, actor: COACH })
    ).rejects.toThrow("Failed to update the reading: connection reset");
    consoleError.mockRestore();
  });
});

describe("restoreMeasurement", () => {
  it("calls the RPC with the row and the client — no actor, the audit row carries it", async () => {
    state.rpc.mockResolvedValue({ data: [{ metric: "bodyFat", affects_current: true }], error: null });

    const result = await restoreMeasurement({ clientId: CLIENT, measurementId: ROW });

    expect(state.rpc).toHaveBeenCalledWith("restore_measurement", { p_id: ROW, p_client_id: CLIENT });
    // The restored body fat is the client's newest: the pair recomputes.
    expect(result.energy).toBe("recomputed");
    expect(state.recalculate).toHaveBeenCalledWith(CLIENT);
  });

  it("refuses a live row through the RPC's word", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: "not_voided: reading x is live" } });

    await expect(restoreMeasurement({ clientId: CLIENT, measurementId: ROW })).rejects.toBeInstanceOf(
      MeasurementStateError
    );
    expect(state.recalculate).not.toHaveBeenCalled();
  });
});
