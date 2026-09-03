import { describe, it, expect } from "vitest";
import {
  MeasurementNotFoundError,
  MeasurementStateError,
  MeasurementValueError,
  fromRpcMessage,
  measurementEditErrorResponse,
} from "./edit-errors";

describe("fromRpcMessage — the RPCs' prefixes become the routes' vocabulary", () => {
  it("maps each refusal prefix to its class", () => {
    expect(fromRpcMessage("not_found: reading x is not this client's")).toBeInstanceOf(
      MeasurementNotFoundError
    );
    expect(fromRpcMessage("voided: reading x is removed")).toBeInstanceOf(MeasurementStateError);
    expect(fromRpcMessage("already_voided: reading x is already removed")).toBeInstanceOf(
      MeasurementStateError
    );
    expect(fromRpcMessage("not_voided: reading x is live")).toBeInstanceOf(MeasurementStateError);
    expect(fromRpcMessage("last_weight: the only weight reading cannot be removed")).toBeInstanceOf(
      MeasurementStateError
    );
  });

  it("names each refusal's way out", () => {
    expect(fromRpcMessage("last_weight: x")?.message).toMatch(/Edit it instead/);
    expect(fromRpcMessage("voided: x")?.message).toMatch(/Restore it before editing it/);
  });

  it("leaves an unexpected failure alone — a prefix must be followed by its colon", () => {
    expect(fromRpcMessage("not_found_elsewhere")).toBeNull();
    expect(fromRpcMessage("voided_by is null")).toBeNull();
    expect(fromRpcMessage("permission denied for function void_measurement")).toBeNull();
    expect(fromRpcMessage(null)).toBeNull();
  });
});

describe("measurementEditErrorResponse", () => {
  it("answers 404, 409 and 400 for the three classes, and nothing for the rest", async () => {
    const notFound = measurementEditErrorResponse(new MeasurementNotFoundError());
    expect(notFound?.status).toBe(404);
    expect(await notFound?.json()).toEqual({ success: false, error: "Reading not found." });

    expect(measurementEditErrorResponse(new MeasurementStateError("already"))?.status).toBe(409);
    expect(measurementEditErrorResponse(new MeasurementValueError("bounds"))?.status).toBe(400);
    expect(measurementEditErrorResponse(new Error("connection reset"))).toBeNull();
  });
});
