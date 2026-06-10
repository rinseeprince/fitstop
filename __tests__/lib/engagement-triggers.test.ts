import { describe, it, expect } from "vitest"
import { evaluateNoEngagement } from "@/lib/engagement-triggers"
import type { DailyLog } from "@/types/daily-log"
import type { DailyHabit, DailyHabitLog } from "@/types/daily-habit"
import type { TrainingEventRow } from "@/lib/attention-feed-helpers"

// Fixed "now" so the silence/grace windows are deterministic regardless of CI timezone.
// new Date(2026, 5, 10) = local midnight 2026-06-10 (month is 0-indexed).
// With NO_ENGAGEMENT_SILENCE_DAYS = 3 and NO_ENGAGEMENT_ACTIVATION_GRACE_DAYS = 3,
// both the silence cutoff and the grace cutoff resolve to 2026-06-07.
const NOW = new Date(2026, 5, 10)
const PAST_START = "2026-06-01" // well past the activation grace window

const makeLog = (date: string): DailyLog => ({
  id: `dl-${date}`,
  clientId: "c1",
  date,
  createdAt: "",
  updatedAt: "",
})
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
const makeHabitLog = (date: string): DailyHabitLog => ({
  id: `hl-${date}`,
  dailyHabitId: "h1",
  clientId: "c1",
  date,
  completed: true,
  createdAt: "",
  updatedAt: "",
})
const event = (date: string, status: string): TrainingEventRow => ({
  client_id: "c1",
  date,
  status,
  estimated_calories: null,
})

describe("evaluateNoEngagement", () => {
  it("fires for a never-logged client with prescribed training, past the grace window", () => {
    const result = evaluateNoEngagement({
      logs: [],
      habits: [],
      habitLogs: [],
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
      logs: [],
      habits: [makeHabit()],
      habitLogs: [],
      trainingEvents: [],
      startDate: PAST_START,
      now: NOW,
    })
    expect(result?.type).toBe("no_engagement")
  })

  it("does NOT fire when a daily log exists within the silence window", () => {
    const result = evaluateNoEngagement({
      logs: [makeLog("2026-06-09")],
      habits: [],
      habitLogs: [],
      trainingEvents: [event("2026-06-09", "scheduled")],
      startDate: PAST_START,
      now: NOW,
    })
    expect(result).toBeNull()
  })

  it("does NOT fire when a habit log exists within the silence window", () => {
    const result = evaluateNoEngagement({
      logs: [],
      habits: [makeHabit()],
      habitLogs: [makeHabitLog("2026-06-08")],
      trainingEvents: [],
      startDate: PAST_START,
      now: NOW,
    })
    expect(result).toBeNull()
  })

  it("does NOT fire when a completed training event exists within the silence window", () => {
    const result = evaluateNoEngagement({
      logs: [],
      habits: [],
      habitLogs: [],
      trainingEvents: [event("2026-06-09", "completed")],
      startDate: PAST_START,
      now: NOW,
    })
    expect(result).toBeNull()
  })

  it("treats scheduled/missed events as absence — still fires", () => {
    const result = evaluateNoEngagement({
      logs: [],
      habits: [],
      habitLogs: [],
      trainingEvents: [event("2026-06-09", "scheduled"), event("2026-06-08", "missed")],
      startDate: PAST_START,
      now: NOW,
    })
    expect(result?.type).toBe("no_engagement")
  })

  it("clears when activity lands exactly on the silence cutoff day (2026-06-07)", () => {
    const result = evaluateNoEngagement({
      logs: [makeLog("2026-06-07")],
      habits: [],
      habitLogs: [],
      trainingEvents: [event("2026-06-09", "scheduled")],
      startDate: PAST_START,
      now: NOW,
    })
    expect(result).toBeNull()
  })

  it("fires when the most recent activity is just before the silence cutoff (2026-06-06)", () => {
    const result = evaluateNoEngagement({
      logs: [makeLog("2026-06-06")],
      habits: [],
      habitLogs: [],
      trainingEvents: [event("2026-06-09", "scheduled")],
      startDate: PAST_START,
      now: NOW,
    })
    expect(result?.type).toBe("no_engagement")
  })

  it("does NOT fire within the activation grace window", () => {
    const result = evaluateNoEngagement({
      logs: [],
      habits: [],
      habitLogs: [],
      trainingEvents: [event("2026-06-09", "scheduled")],
      startDate: "2026-06-09", // activated 1 day ago — inside the 3-day grace
      now: NOW,
    })
    expect(result).toBeNull()
  })

  it("fires exactly when start_date + grace has elapsed (boundary, start_date 2026-06-07)", () => {
    const result = evaluateNoEngagement({
      logs: [],
      habits: [],
      habitLogs: [],
      trainingEvents: [event("2026-06-09", "scheduled")],
      startDate: "2026-06-07", // start_date + 3 == today (2026-06-10) → eligible
      now: NOW,
    })
    expect(result?.type).toBe("no_engagement")
  })

  it("does NOT fire when nothing is prescribed (no events, no habits)", () => {
    const result = evaluateNoEngagement({
      logs: [],
      habits: [],
      habitLogs: [],
      trainingEvents: [],
      startDate: PAST_START,
      now: NOW,
    })
    expect(result).toBeNull()
  })

  it("does NOT fire when startDate is null", () => {
    const result = evaluateNoEngagement({
      logs: [],
      habits: [],
      habitLogs: [],
      trainingEvents: [event("2026-06-09", "scheduled")],
      startDate: null,
      now: NOW,
    })
    expect(result).toBeNull()
  })

  it("compares dates only when start_date is an ISO datetime", () => {
    const result = evaluateNoEngagement({
      logs: [],
      habits: [],
      habitLogs: [],
      trainingEvents: [event("2026-06-09", "scheduled")],
      startDate: "2026-06-01T08:30:00.000Z",
      now: NOW,
    })
    expect(result?.type).toBe("no_engagement")
  })
})
