import { describe, it, expect } from "vitest"
import { evaluateNoEngagement } from "@/lib/engagement-triggers"
import type { DailyHabit } from "@/types/daily-habit"
import type { TrainingEventRow } from "@/lib/attention-feed-helpers"

// Fixed "now" so the silence/grace windows are deterministic regardless of CI timezone.
// new Date(2026, 5, 10) = local midnight 2026-06-10 (month is 0-indexed).
// With NO_ENGAGEMENT_SILENCE_DAYS = 3 and NO_ENGAGEMENT_ACTIVATION_GRACE_DAYS = 3,
// both the silence cutoff and the grace cutoff resolve to 2026-06-07.
const NOW = new Date(2026, 5, 10)
const PAST_START = "2026-06-01" // well past the activation grace window

const makeHabit = (): DailyHabit => ({
  id: "h1",
  coachId: "co1",
  clientId: "c1",
  name: "Drink water",
  isBoolean: true,
  isActive: true,
  sortOrder: 0,
  effectiveDate: "2026-06-01",
  createdAt: "2026-06-01",
  updatedAt: "2026-06-01",
})
const event = (date: string, status: string): TrainingEventRow => ({
  client_id: "c1",
  date,
  status,
  estimated_calories: null,
})

// The trigger takes the DERIVED logged days (lib/logged-days.ts) — whichever
// source a day came from, it is one list here. Which rows count is the
// kernel's business and is tested there and at the feed's assembly.
describe("evaluateNoEngagement", () => {
  it("fires for a never-logged client with prescribed training, past the grace window", () => {
    const result = evaluateNoEngagement({
      loggedDays: [],
      habits: [],
      trainingEvents: [event("2026-06-09", "scheduled")], // prescribed, but scheduled = absence
      startDate: PAST_START,
      now: NOW,
    })
    expect(result).not.toBeNull()
    expect(result?.type).toBe("no_engagement")
    expect(result?.severity).toBe("medium")
    expect(result?.affectedDays).toEqual(["2026-06-10"])
    expect(result?.metricData).toEqual([])
  })

  it("fires when prescribed via habits only (no training events)", () => {
    const result = evaluateNoEngagement({
      loggedDays: [],
      habits: [makeHabit()],
      trainingEvents: [],
      startDate: PAST_START,
      now: NOW,
    })
    expect(result?.type).toBe("no_engagement")
  })

  it("does NOT fire when a logged day exists within the silence window", () => {
    const result = evaluateNoEngagement({
      loggedDays: ["2026-06-09"],
      habits: [],
      trainingEvents: [event("2026-06-09", "scheduled")],
      startDate: PAST_START,
      now: NOW,
    })
    expect(result).toBeNull()
  })

  it("reads prescribed events as prescription only — a logged day comes from the list, never from an event", () => {
    // A completed event in the window that the caller did NOT put on the
    // logged-day list does not clear the alert: the trigger holds no private
    // union any more, so it cannot second-guess the definition it is handed.
    const result = evaluateNoEngagement({
      loggedDays: [],
      habits: [],
      trainingEvents: [event("2026-06-09", "completed")],
      startDate: PAST_START,
      now: NOW,
    })
    expect(result?.type).toBe("no_engagement")
  })

  it("clears when a logged day lands exactly on the silence cutoff day (2026-06-07)", () => {
    const result = evaluateNoEngagement({
      loggedDays: ["2026-06-07"],
      habits: [],
      trainingEvents: [event("2026-06-09", "scheduled")],
      startDate: PAST_START,
      now: NOW,
    })
    expect(result).toBeNull()
  })

  it("fires when the most recent logged day is just before the silence cutoff (2026-06-06)", () => {
    const result = evaluateNoEngagement({
      loggedDays: ["2026-06-06"],
      habits: [],
      trainingEvents: [event("2026-06-09", "scheduled")],
      startDate: PAST_START,
      now: NOW,
    })
    expect(result?.type).toBe("no_engagement")
  })

  it("does NOT fire within the activation grace window", () => {
    const result = evaluateNoEngagement({
      loggedDays: [],
      habits: [],
      trainingEvents: [event("2026-06-09", "scheduled")],
      startDate: "2026-06-09", // activated 1 day ago — inside the 3-day grace
      now: NOW,
    })
    expect(result).toBeNull()
  })

  it("fires exactly when start_date + grace has elapsed (boundary, start_date 2026-06-07)", () => {
    const result = evaluateNoEngagement({
      loggedDays: [],
      habits: [],
      trainingEvents: [event("2026-06-09", "scheduled")],
      startDate: "2026-06-07", // start_date + 3 == today (2026-06-10) → eligible
      now: NOW,
    })
    expect(result?.type).toBe("no_engagement")
  })

  it("does NOT fire when nothing is prescribed (no events, no habits)", () => {
    const result = evaluateNoEngagement({
      loggedDays: [],
      habits: [],
      trainingEvents: [],
      startDate: PAST_START,
      now: NOW,
    })
    expect(result).toBeNull()
  })

  it("does NOT fire when startDate is null", () => {
    const result = evaluateNoEngagement({
      loggedDays: [],
      habits: [],
      trainingEvents: [event("2026-06-09", "scheduled")],
      startDate: null,
      now: NOW,
    })
    expect(result).toBeNull()
  })

  it("compares dates only when start_date is an ISO datetime", () => {
    const result = evaluateNoEngagement({
      loggedDays: [],
      habits: [],
      trainingEvents: [event("2026-06-09", "scheduled")],
      startDate: "2026-06-01T08:30:00.000Z",
      now: NOW,
    })
    expect(result?.type).toBe("no_engagement")
  })
})
