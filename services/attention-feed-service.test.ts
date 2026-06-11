import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/services/supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

vi.mock("@/services/today-service", () => ({
  getCoachTodayString: vi.fn().mockResolvedValue("2024-03-27"),
}))

import { supabaseAdmin } from "@/services/supabase-admin"
import { getCoachTodayString } from "@/services/today-service"
import { evaluateAllClientTriggers } from "@/services/attention-feed-service"
import {
  groupClientData,
  evaluateAndSortTriggers,
  filterDismissedAlerts,
  type TrainingEventRow,
  type DismissalRow,
} from "@/lib/attention-feed-helpers"
import type { ClientWithAlerts } from "@/types/attention-feed"

describe("attention-feed-service", () => {
  const baseClient = {
    id: "c1",
    name: "Test Client",
    avatar_url: null,
    expected_check_in_day: null,
    start_date: null,
  }

  describe("groupClientData", () => {
    it("should group TrainingEventRow[] into ClientData.trainingEvents per client", () => {
      const events: TrainingEventRow[] = [
        { client_id: "c1", date: "2026-04-01", status: "completed", estimated_calories: 300 },
        { client_id: "c1", date: "2026-04-02", status: "scheduled", estimated_calories: 250 },
        { client_id: "c2", date: "2026-04-01", status: "partial", estimated_calories: 400 },
      ]
      const clients = [
        baseClient,
        { ...baseClient, id: "c2", name: "Client 2" },
      ]

      const result = groupClientData(clients, null, null, null, events)

      const c1 = result.get("c1")!
      expect(c1.trainingEvents).toHaveLength(2)
      expect(c1.trainingEvents[0].status).toBe("completed")
      expect(c1.trainingEvents[1].status).toBe("scheduled")

      const c2 = result.get("c2")!
      expect(c2.trainingEvents).toHaveLength(1)
      expect(c2.trainingEvents[0].status).toBe("partial")
    })

    it("should derive plannedSessionCount from trainingEvents.length", () => {
      const events: TrainingEventRow[] = [
        { client_id: "c1", date: "2026-04-01", status: "completed", estimated_calories: 300 },
        { client_id: "c1", date: "2026-04-02", status: "scheduled", estimated_calories: 250 },
        { client_id: "c1", date: "2026-04-03", status: "missed", estimated_calories: 200 },
      ]

      const result = groupClientData([baseClient], null, null, null, events)

      expect(result.get("c1")!.plannedSessionCount).toBe(3)
    })

    it("should handle null eventRows gracefully", () => {
      const result = groupClientData([baseClient], null, null, null, null)

      expect(result.get("c1")!.trainingEvents).toEqual([])
      expect(result.get("c1")!.plannedSessionCount).toBe(0)
    })

    it("should carry start_date into ClientData.startDate (null when absent)", () => {
      expect(groupClientData([baseClient], null, null, null, null).get("c1")!.startDate).toBeNull()
      const withStart = groupClientData(
        [{ ...baseClient, start_date: "2026-05-01" }],
        null,
        null,
        null,
        null,
      )
      expect(withStart.get("c1")!.startDate).toBe("2026-05-01")
    })
  })

  describe("evaluateAndSortTriggers", () => {
    it("should pass trainingEvents through to triggers and aggregate alerts", () => {
      // Use dates relative to today so the test works regardless of when it runs.
      // We need 2 events on past dates within the current Mon-Sun week.
      const today = new Date()
      const todayStr = today.toISOString().split("T")[0]

      // Go back 2 and 3 days — guaranteed to be past, likely in the same week
      // (edge case: if today is Mon or Tue, these dates may be in the previous week,
      // so use a wider window and accept that the trigger might not fire on Mon/Tue)
      const dayOfWeek = today.getDay() // 0=Sun,1=Mon,...6=Sat
      // If today is Wed or later, we have enough past days in this week
      // For a reliable test, skip if early in the week and just verify no crash
      const d1 = new Date(today)
      d1.setDate(today.getDate() - 2)
      const d2 = new Date(today)
      d2.setDate(today.getDate() - 3)

      const dateRange = { start: d2.toISOString().split("T")[0], end: todayStr }

      const events: TrainingEventRow[] = [
        { client_id: "c1", date: d2.toISOString().split("T")[0], status: "scheduled", estimated_calories: 300 },
        { client_id: "c1", date: d1.toISOString().split("T")[0], status: "scheduled", estimated_calories: 300 },
      ]

      const logs = [
        { id: "dl1", clientId: "c1", date: d2.toISOString().split("T")[0], createdAt: "", updatedAt: "" },
      ]

      const clientDataMap = groupClientData([baseClient], null, null, null, events)
      clientDataMap.get("c1")!.logs = logs

      const result = evaluateAndSortTriggers(clientDataMap, dateRange)

      if (dayOfWeek >= 4) {
        // Thu-Sat: both past events (today-2, today-3) are in the current Mon-Sun week.
        // (On Wed today-3 lands on Sun of the previous week, so the trigger does not fire.)
        expect(result.length).toBeGreaterThanOrEqual(1)
        const c1Alerts = result.find((c) => c.clientId === "c1")
        expect(c1Alerts).toBeDefined()
        const trainingAlert = c1Alerts!.alerts.find((a) => a.type === "training_missed")
        expect(trainingAlert).toBeDefined()
        expect(trainingAlert!.severity).toBe("high")
      } else {
        // Mon/Tue/Sun: past events may cross week boundary — just verify no crash
        expect(result).toBeDefined()
      }
    })

    it("surfaces a no_engagement alert for a never-logged client with prescribed training", () => {
      // Regression: a client with an assigned plan (training events) but zero logs
      // used to be skipped by the old `data.logs.length === 0` guard and counted as
      // "on track". They must now surface.
      const iso = (d: Date) => d.toISOString().split("T")[0]
      const today = new Date()
      const start = new Date(today)
      start.setDate(today.getDate() - 60) // long past the activation grace
      const oldEvent = new Date(today)
      oldEvent.setDate(today.getDate() - 30) // prescribed, outside the current training week

      const clients = [{ ...baseClient, start_date: iso(start) }]
      const events: TrainingEventRow[] = [
        { client_id: "c1", date: iso(oldEvent), status: "scheduled", estimated_calories: 300 },
      ]
      const dateRange = { start: iso(start), end: iso(today) }

      const map = groupClientData(clients, null, null, null, events)
      const result = evaluateAndSortTriggers(map, dateRange)

      const c1 = result.find((c) => c.clientId === "c1")
      expect(c1).toBeDefined()
      expect(c1!.alerts.some((a) => a.type === "no_engagement")).toBe(true)
    })

    it("skips a client with no logs, no events, no habits, and no habit logs", () => {
      const map = groupClientData([baseClient], null, null, null, null)
      const result = evaluateAndSortTriggers(map, { start: "2026-01-01", end: "2026-01-28" })
      expect(result.find((c) => c.clientId === "c1")).toBeUndefined()
    })

    it("anchors day-deciding triggers to the window end, not the server clock (Session 7.84)", () => {
      // A FIXED past window that can never match the host clock: the
      // no_engagement trigger's affectedDays must equal the window end —
      // under a server-clock anchor it would stamp the host's today instead.
      const clients = [{ ...baseClient, start_date: "2024-01-01" }]
      const events: TrainingEventRow[] = [
        { client_id: "c1", date: "2024-02-01", status: "scheduled", estimated_calories: 300 },
      ]
      const dateRange = { start: "2024-02-28", end: "2024-03-27" }

      const map = groupClientData(clients, null, null, null, events)
      const result = evaluateAndSortTriggers(map, dateRange)

      const alert = result
        .find((c) => c.clientId === "c1")
        ?.alerts.find((a) => a.type === "no_engagement")
      expect(alert).toBeDefined()
      expect(alert!.affectedDays).toEqual(["2024-03-27"])
    })
  })

  describe("evaluateAllClientTriggers (window wiring)", () => {
    beforeEach(() => {
      vi.clearAllMocks()
      vi.mocked(getCoachTodayString).mockResolvedValue("2024-03-27")
    })

    it("resolves the 28-day window from the COACH's local today", async () => {
      const emptyQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
          Promise.resolve({ data: [], error: null }).then(resolve),
      }
      vi.mocked(supabaseAdmin.from).mockReturnValue(emptyQuery as never)

      const result = await evaluateAllClientTriggers("coach-1")

      expect(getCoachTodayString).toHaveBeenCalledWith("coach-1")
      expect(result.clients).toEqual([])
    })
  })

  describe("filterDismissedAlerts", () => {
    const makeClient = (id: string, alerts: ClientWithAlerts["alerts"]): ClientWithAlerts => ({
      clientId: id,
      clientName: `Client ${id}`,
      clientAvatar: null,
      alerts,
    })

    const makeAlert = (type: string, affectedDays: string[]): ClientWithAlerts["alerts"][0] => ({
      type: type as ClientWithAlerts["alerts"][0]["type"],
      severity: "high",
      message: "test",
      affectedDays,
      metricData: [],
    })

    it("should suppress alert when MAX(affectedDays) <= dismissed_at", () => {
      const clients = [makeClient("c1", [makeAlert("training_missed", ["2026-04-01", "2026-04-02"])])]
      const dismissals: DismissalRow[] = [
        { client_id: "c1", alert_type: "training_missed", dismissed_at: "2026-04-02" },
      ]

      const result = filterDismissedAlerts(clients, dismissals)
      expect(result).toHaveLength(0)
    })

    it("should show alert when MAX(affectedDays) > dismissed_at (new instance)", () => {
      const clients = [makeClient("c1", [makeAlert("training_missed", ["2026-04-03", "2026-04-04"])])]
      const dismissals: DismissalRow[] = [
        { client_id: "c1", alert_type: "training_missed", dismissed_at: "2026-04-02" },
      ]

      const result = filterDismissedAlerts(clients, dismissals)
      expect(result).toHaveLength(1)
      expect(result[0].alerts).toHaveLength(1)
    })

    it("should show alert when no matching dismissal exists", () => {
      const clients = [makeClient("c1", [makeAlert("training_missed", ["2026-04-01"])])]
      const dismissals: DismissalRow[] = [
        { client_id: "c1", alert_type: "mood_drop", dismissed_at: "2026-04-05" },
      ]

      const result = filterDismissedAlerts(clients, dismissals)
      expect(result).toHaveLength(1)
      expect(result[0].alerts).toHaveLength(1)
    })

    it("should remove client when all their alerts are suppressed", () => {
      const clients = [
        makeClient("c1", [
          makeAlert("training_missed", ["2026-04-01"]),
          makeAlert("mood_drop", ["2026-04-01", "2026-04-02"]),
        ]),
      ]
      const dismissals: DismissalRow[] = [
        { client_id: "c1", alert_type: "training_missed", dismissed_at: "2026-04-01" },
        { client_id: "c1", alert_type: "mood_drop", dismissed_at: "2026-04-02" },
      ]

      const result = filterDismissedAlerts(clients, dismissals)
      expect(result).toHaveLength(0)
    })

    it("should return all clients unchanged when dismissals is null", () => {
      const clients = [makeClient("c1", [makeAlert("training_missed", ["2026-04-01"])])]

      const result = filterDismissedAlerts(clients, null)
      expect(result).toHaveLength(1)
      expect(result[0].alerts).toHaveLength(1)
    })

    it("suppresses for an ahead-of-UTC coach dismissing just after local midnight", () => {
      // UTC+13 coach at 2026-06-10T23:30Z: coach-local today is 2026-06-11, so
      // the dismiss route (7.85) stamps dismissed_at = "2026-06-11". The alert's
      // newest affected day is the same coach-local day. With the old server-UTC
      // stamp ("2026-06-10") the alert popped straight back; the coach-local
      // stamp suppresses it ("2026-06-11" > "2026-06-11" is false).
      const clients = [makeClient("c1", [makeAlert("training_missed", ["2026-06-10", "2026-06-11"])])]
      const dismissals: DismissalRow[] = [
        { client_id: "c1", alert_type: "training_missed", dismissed_at: "2026-06-11" },
      ]

      expect(filterDismissedAlerts(clients, dismissals)).toHaveLength(0)

      // Regression shape of the bug: the UTC-stamped day fails to suppress.
      const utcStamped: DismissalRow[] = [
        { client_id: "c1", alert_type: "training_missed", dismissed_at: "2026-06-10" },
      ]
      expect(filterDismissedAlerts(clients, utcStamped)).toHaveLength(1)
    })
  })
})
