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
  loggedDaysFor,
  type TrainingEventRow,
  type DismissalRow,
} from "@/lib/attention-feed-helpers"
import type { ClientWithAlerts } from "@/types/attention-feed"
import type { DailyLog } from "@/types/daily-log"

describe("attention-feed-service", () => {
  const baseClient = {
    id: "c1",
    name: "Test Client",
    avatar_url: null,
    next_check_in_due: null,
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

      const result = groupClientData(clients, null, null, null, events, null)

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

      const result = groupClientData([baseClient], null, null, null, events, null)

      expect(result.get("c1")!.plannedSessionCount).toBe(3)
    })

    it("should handle null eventRows gracefully", () => {
      const result = groupClientData([baseClient], null, null, null, null, null)

      expect(result.get("c1")!.trainingEvents).toEqual([])
      expect(result.get("c1")!.plannedSessionCount).toBe(0)
      expect(result.get("c1")!.clientLogDates).toEqual([])
    })

    it("should carry start_date into ClientData.startDate (null when absent)", () => {
      expect(groupClientData([baseClient], null, null, null, null, null).get("c1")!.startDate).toBeNull()
      const withStart = groupClientData(
        [{ ...baseClient, start_date: "2026-05-01" }],
        null,
        null,
        null,
        null,
        null,
      )
      expect(withStart.get("c1")!.startDate).toBe("2026-05-01")
    })

    it("groups the client's own measurement logs per client, as dates, skipping a null row", () => {
      const result = groupClientData(
        [baseClient, { ...baseClient, id: "c2", name: "Client 2" }],
        null,
        null,
        null,
        null,
        [
          { client_id: "c1", recorded_on: "2026-04-01" },
          { client_id: "c2", recorded_on: "2026-04-02" },
          { client_id: null, recorded_on: "2026-04-03" },
          { client_id: "c1", recorded_on: null },
        ],
      )

      expect(result.get("c1")!.clientLogDates).toEqual(["2026-04-01"])
      expect(result.get("c2")!.clientLogDates).toEqual(["2026-04-02"])
    })
  })

  describe("loggedDaysFor — the feed's assembly of the one definition", () => {
    const log = (date: string, values: Partial<DailyLog> = {}): DailyLog => ({
      id: `dl-${date}`,
      clientId: "c1",
      date,
      createdAt: "",
      updatedAt: "",
      ...values,
    })
    const dateRange = { start: "2026-04-01", end: "2026-04-10" }

    it("counts a day for each source the client used, and nothing for a scheduled event or an empty day-form row", () => {
      const map = groupClientData(
        [baseClient],
        null,
        null,
        null,
        [
          { client_id: "c1", date: "2026-04-01", status: "completed", estimated_calories: null },
          { client_id: "c1", date: "2026-04-06", status: "scheduled", estimated_calories: null },
        ],
        [{ client_id: "c1", recorded_on: "2026-04-05" }],
      )
      const data = map.get("c1")!
      data.logs = [
        log("2026-04-03", { mood: 4 }),
        log("2026-04-04", { caloriesConsumed: 2100 }),
        log("2026-04-07"), // a spine row with nothing on it is not a log
      ]
      data.habitLogs = [
        { id: "hl", dailyHabitId: "h1", clientId: "c1", date: "2026-04-02", completed: false, createdAt: "", updatedAt: "" },
      ]

      expect(loggedDaysFor(data, dateRange)).toEqual([
        "2026-04-01", // trained
        "2026-04-02", // ticked (or unticked) a habit
        "2026-04-03", // wellness
        "2026-04-04", // nutrition
        "2026-04-05", // logged a measurement
      ])
    })

    it("keeps a day outside the window out", () => {
      const map = groupClientData(
        [baseClient],
        null,
        null,
        null,
        [{ client_id: "c1", date: "2026-03-31", status: "completed", estimated_calories: null }],
        null,
      )
      expect(loggedDaysFor(map.get("c1")!, dateRange)).toEqual([])
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

      const clientDataMap = groupClientData([baseClient], null, null, null, events, null)
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

      const map = groupClientData(clients, null, null, null, events, null)
      const result = evaluateAndSortTriggers(map, dateRange)

      const c1 = result.find((c) => c.clientId === "c1")
      expect(c1).toBeDefined()
      expect(c1!.alerts.some((a) => a.type === "no_engagement")).toBe(true)
    })

    describe("a client who only trains, or only ticks habits, is never read as silent", () => {
      // A fixed window: the coach-local today is the window end, so the
      // silence cutoff is the 24th and a log on the 25th is inside it.
      const dateRange = { start: "2024-02-28", end: "2024-03-27" }
      const clients = [{ ...baseClient, start_date: "2024-01-01" }]
      const prescribed: TrainingEventRow = {
        client_id: "c1", date: "2024-03-20", status: "scheduled", estimated_calories: 300,
      }
      const alertsFor = (map: ReturnType<typeof groupClientData>) =>
        evaluateAndSortTriggers(map, dateRange)
          .find((c) => c.clientId === "c1")?.alerts.map((a) => a.type) ?? []

      it("a completed workout in the silence window clears no_engagement, and no spine row is needed", () => {
        const map = groupClientData(clients, null, null, null, [
          prescribed,
          { client_id: "c1", date: "2024-03-25", status: "completed", estimated_calories: 300 },
        ], null)
        expect(alertsFor(map)).not.toContain("no_engagement")
      })

      it("a habit log in the silence window clears it", () => {
        const map = groupClientData(clients, null, null, null, [prescribed], null)
        map.get("c1")!.habitLogs = [
          { id: "hl", dailyHabitId: "h1", clientId: "c1", date: "2024-03-26", completed: true, createdAt: "", updatedAt: "" },
        ]
        expect(alertsFor(map)).not.toContain("no_engagement")
      })

      it("a measurement the client logged themselves clears it", () => {
        const map = groupClientData(clients, null, null, null, [prescribed], [
          { client_id: "c1", recorded_on: "2024-03-27" },
        ])
        expect(alertsFor(map)).not.toContain("no_engagement")
      })

      it("a scheduled event alone does not", () => {
        const map = groupClientData(clients, null, null, null, [prescribed], null)
        expect(alertsFor(map)).toContain("no_engagement")
      })

      it("training-only days bridge a logging gap that the spine alone would open", () => {
        // Spine rows on the 1st and the 9th; workouts on the 3rd, 5th and 7th.
        // Counting spine rows this is a seven-day gap; counting logged days the
        // longest gap is one day.
        const range = { start: "2024-03-01", end: "2024-03-09" }
        const map = groupClientData(clients, null, null, null, [
          { client_id: "c1", date: "2024-03-03", status: "completed", estimated_calories: null },
          { client_id: "c1", date: "2024-03-05", status: "partial", estimated_calories: null },
          { client_id: "c1", date: "2024-03-07", status: "completed", estimated_calories: null },
        ], null)
        map.get("c1")!.logs = [
          { id: "a", clientId: "c1", date: "2024-03-01", mood: 3, createdAt: "", updatedAt: "" },
          { id: "b", clientId: "c1", date: "2024-03-09", mood: 3, createdAt: "", updatedAt: "" },
        ]
        const types = evaluateAndSortTriggers(map, range)
          .find((c) => c.clientId === "c1")?.alerts.map((a) => a.type) ?? []
        expect(types).not.toContain("no_log_gap")
      })
    })

    it("skips a client with nothing logged and nothing prescribed", () => {
      const map = groupClientData([baseClient], null, null, null, null, null)
      const result = evaluateAndSortTriggers(map, { start: "2026-01-01", end: "2026-01-28" })
      expect(result.find((c) => c.clientId === "c1")).toBeUndefined()
    })

    it("evaluates a client who only logged wellness, with nothing prescribed", () => {
      // Ten days of mood at 4, then three at 1: the mood-drop trigger needs the
      // rows, and the guard must not read "nothing prescribed" as "nothing to do".
      const map = groupClientData([baseClient], null, null, null, null, null)
      const logs: DailyLog[] = []
      for (let d = 1; d <= 13; d++) {
        const date = `2026-01-${String(d).padStart(2, "0")}`
        logs.push({ id: date, clientId: "c1", date, mood: d <= 10 ? 4 : 1, createdAt: "", updatedAt: "" })
      }
      map.get("c1")!.logs = logs
      const result = evaluateAndSortTriggers(map, { start: "2026-01-01", end: "2026-01-13" })
      expect(result.find((c) => c.clientId === "c1")?.alerts.some((a) => a.type === "mood_drop")).toBe(true)
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

      const map = groupClientData(clients, null, null, null, events, null)
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
        range: vi.fn().mockReturnThis(),
        then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
          Promise.resolve({ data: [], error: null }).then(resolve),
      }
      vi.mocked(supabaseAdmin.from).mockReturnValue(emptyQuery as never)

      const result = await evaluateAllClientTriggers("coach-1")

      expect(getCoachTodayString).toHaveBeenCalledWith("coach-1")
      expect(result.clients).toEqual([])
    })

    it("chunks the client-id list so a large roster cannot blow the request-line limit (H4)", async () => {
      // 250 clients inlined into .in() would be ~9.5KB of URL, past a typical
      // 8KB proxy limit -> 414 on the REQUIRED daily-logs read -> whole feed
      // fails. Paging alone does not help: the page loop re-sends the full id
      // list every page. Assert the ids are chunked AND that every client
      // survives exactly once, so chunking cannot silently drop a roster tail.
      const clientRows = Array.from({ length: 250 }, (_, i) => ({
        id: `client-${i}`, name: `C${i}`, avatar_url: null,
        next_check_in_due: null, start_date: null,
      }))

      const inCalls: string[][] = []
      let rosterServed = false

      const makeQuery = (table: string) => {
        const q: Record<string, unknown> = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          lte: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          range: vi.fn().mockReturnThis(),
          in: vi.fn((_col: string, ids: string[]) => { inCalls.push(ids); return q }),
        }
        Object.defineProperty(q, "then", {
          value: (resolve: (v: { data: unknown[]; error: null }) => void) => {
            // Serve the roster once, then empty pages so every loop terminates.
            if (table === "clients" && !rosterServed) {
              rosterServed = true
              return Promise.resolve({ data: clientRows, error: null }).then(resolve)
            }
            return Promise.resolve({ data: [], error: null }).then(resolve)
          },
        })
        return q
      }
      vi.mocked(supabaseAdmin.from).mockImplementation(((t: string) => makeQuery(t)) as never)

      const result = await evaluateAllClientTriggers("coach-1")

      expect(result.totalClientCount).toBe(250)
      expect(inCalls.length).toBeGreaterThan(0)
      // No chunk may exceed the 100-id default.
      expect(Math.max(...inCalls.map((c) => c.length))).toBeLessThanOrEqual(100)
      // Chunking must be lossless: the union of every chunk is the full roster,
      // so no client is silently dropped. (The four cross-client reads run under
      // Promise.allSettled, so their chunks interleave — assert on the union,
      // not on a positional slice.)
      expect(new Set(inCalls.flat()).size).toBe(250)
      // Each read covers all 250 ids across 3 chunks (100/100/50), 5 reads.
      expect(inCalls.length).toBe(15)
    })

    it("reads only the measurements the client logged themselves, from the live view", async () => {
      // The fifth logged-day source. A coach entry, an intake reading or a
      // check-in's stamped row is the coach's work or the weekly report.
      const eqCalls: Record<string, unknown[][]> = {}
      let rosterServed = false
      const makeQuery = (table: string) => {
        const q: Record<string, unknown> = {
          select: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          lte: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          range: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          eq: vi.fn((...args: unknown[]) => { (eqCalls[table] ??= []).push(args); return q }),
        }
        Object.defineProperty(q, "then", {
          value: (resolve: (v: { data: unknown[]; error: null }) => void) => {
            if (table === "clients" && !rosterServed) {
              rosterServed = true
              return Promise.resolve({ data: [baseClient], error: null }).then(resolve)
            }
            return Promise.resolve({ data: [], error: null }).then(resolve)
          },
        })
        return q
      }
      vi.mocked(supabaseAdmin.from).mockImplementation(((t: string) => makeQuery(t)) as never)

      await evaluateAllClientTriggers("coach-1")

      expect(eqCalls["client_measurements_live"]).toEqual([["source", "client_log"]])
      expect(eqCalls["daily_logs"]).toBeUndefined()
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

    it("keys high_soreness dismissals like any other alert type", () => {
      const clients = [makeClient("c1", [makeAlert("high_soreness", ["2026-04-01", "2026-04-02"])])]
      const dismissals: DismissalRow[] = [
        { client_id: "c1", alert_type: "high_soreness", dismissed_at: "2026-04-02" },
      ]

      const result = filterDismissedAlerts(clients, dismissals)
      expect(result).toHaveLength(0)
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
