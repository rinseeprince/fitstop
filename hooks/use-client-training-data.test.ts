import { describe, it, expect } from "vitest";
import {
  clientDaySummaryKey,
  clientTrainingWeekKey,
  isClientTrainingAreaKey,
} from "./use-client-training-data";

// The key builders and the area matcher are the contract (CONVENTIONS §7):
// a key the builder produces must be one the invalidator matches, and the
// matcher must cover the AREA, not one endpoint.
describe("client training-area SWR keys", () => {
  it("builds the day-summary and week keys the routes serve", () => {
    expect(clientDaySummaryKey("2026-08-26")).toBe("/api/client/day-summary?date=2026-08-26");
    expect(clientTrainingWeekKey("2026-08-26")).toBe("/api/client/training/week?date=2026-08-26");
  });

  it("matches every key the builders produce, for any date", () => {
    expect(isClientTrainingAreaKey(clientDaySummaryKey("2026-08-26"))).toBe(true);
    expect(isClientTrainingAreaKey(clientDaySummaryKey("2027-01-01"))).toBe(true);
    expect(isClientTrainingAreaKey(clientTrainingWeekKey("2026-08-30"))).toBe(true);
  });

  it("leaves other areas and non-string keys alone", () => {
    expect(isClientTrainingAreaKey("/api/client/nutrition-plan")).toBe(false);
    expect(isClientTrainingAreaKey("/api/client/daily-logs/2026-08-26/nutrition")).toBe(false);
    expect(isClientTrainingAreaKey(null)).toBe(false);
    expect(isClientTrainingAreaKey(["/api/client/day-summary", "x"])).toBe(false);
  });
});
