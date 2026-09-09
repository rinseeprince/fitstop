import { describe, expect, it } from "vitest"
import {
  evaluatePrescriptionEnding,
  findPrescriptionGap,
  type PlanWindow,
} from "./prescription-triggers"
import { PLAN_ENDING_LEAD_DAYS } from "@/lib/constants"

// A fixed coach-local today. Every window below is placed relative to it, and
// every fixture date is distinct so a wrong date cannot pass as a right one.
// Months are chosen to abbreviate to three letters under the platform's en-AU
// short date ("June" and "Sept" do not).
const TODAY = "2026-03-10"
const w = (start: string, end: string): PlanWindow => ({ start, end })

describe("findPrescriptionGap", () => {
  it("returns null with no windows", () => {
    expect(findPrescriptionGap([], TODAY)).toBeNull()
  })

  it("returns null when every window is still ahead — a queued first plan is setup, not a stop", () => {
    expect(findPrescriptionGap([w("2026-03-20", "2026-04-10")], TODAY)).toBeNull()
  })

  it("reports the day after the covering window, with nothing queued", () => {
    expect(findPrescriptionGap([w("2026-02-01", "2026-03-30")], TODAY)).toEqual({
      from: "2026-03-31",
      resumesOn: null,
    })
  })

  it("reports the queued plan's start as the resume day", () => {
    expect(
      findPrescriptionGap([w("2026-02-01", "2026-03-13"), w("2026-03-20", "2026-04-20")], TODAY)
    ).toEqual({ from: "2026-03-14", resumesOn: "2026-03-20" })
  })

  it("treats a plan starting the day after the current one ends as continuous coverage", () => {
    expect(
      findPrescriptionGap([w("2026-02-01", "2026-03-13"), w("2026-03-14", "2026-04-20")], TODAY)
    ).toEqual({ from: "2026-04-21", resumesOn: null })
  })

  it("merges overlapping windows into one stretch", () => {
    expect(
      findPrescriptionGap([w("2026-02-15", "2026-03-12"), w("2026-02-01", "2026-03-20")], TODAY)
    ).toEqual({ from: "2026-03-21", resumesOn: null })
  })

  it("dates a gap under way from the day after the latest window that ended", () => {
    expect(
      findPrescriptionGap([w("2025-12-01", "2025-12-31"), w("2026-01-01", "2026-02-15")], TODAY)
    ).toEqual({ from: "2026-02-16", resumesOn: null })
  })

  it("names the resume day of a gap under way when a plan is queued", () => {
    expect(
      findPrescriptionGap([w("2026-02-01", "2026-03-06"), w("2026-03-25", "2026-04-25")], TODAY)
    ).toEqual({ from: "2026-03-07", resumesOn: "2026-03-25" })
  })

  it("ignores an inverted window", () => {
    expect(findPrescriptionGap([w("2026-03-15", "2026-03-01")], TODAY)).toBeNull()
  })
})

describe("evaluatePrescriptionEnding", () => {
  const nutrition = (windows: PlanWindow[]) =>
    evaluatePrescriptionEnding({ track: "nutrition", windows, today: TODAY })
  const training = (windows: PlanWindow[]) =>
    evaluatePrescriptionEnding({ track: "training", windows, today: TODAY })

  it("is quiet with no windows, and for a client whose first plan is queued", () => {
    expect(nutrition([])).toBeNull()
    expect(nutrition([w("2026-03-20", "2026-04-10")])).toBeNull()
  })

  it("is quiet while the end is past the lead", () => {
    expect(nutrition([w("2026-02-01", "2026-03-30")])).toBeNull()
  })

  it("fires the heads-up on the first day of the lead window, boundary-exact", () => {
    // lead 7: an end 7 days out is quiet, 6 days out is the last week.
    expect(PLAN_ENDING_LEAD_DAYS).toBe(7)
    expect(nutrition([w("2026-02-01", "2026-03-17")])).toBeNull()
    expect(nutrition([w("2026-02-01", "2026-03-16")])).toEqual({
      type: "nutrition_ending",
      severity: "medium",
      message: "Nutrition targets end 16 Mar",
      affectedDays: ["2026-03-10"],
      metricData: [],
    })
  })

  it("anchors the heads-up on the lead window's first day, so one dismissal covers it", () => {
    // An end on today: the lead began six days ago, and that is the anchor.
    const result = nutrition([w("2026-02-01", "2026-03-10")])
    expect(result?.severity).toBe("medium")
    expect(result?.message).toBe("Nutrition targets end 10 Mar")
    expect(result?.affectedDays).toEqual(["2026-03-04"])
  })

  it("says what is queued after a coming gap", () => {
    const result = nutrition([w("2026-02-01", "2026-03-13"), w("2026-03-20", "2026-04-20")])
    expect(result?.severity).toBe("medium")
    expect(result?.message).toBe("Nutrition targets end 13 Mar, nothing until 20 Mar")
    expect(result?.affectedDays).toEqual(["2026-03-07"])
  })

  it("is quiet across a seamless handover", () => {
    expect(nutrition([w("2026-02-01", "2026-03-13"), w("2026-03-14", "2026-04-20")])).toBeNull()
  })

  it("looks through a handover to a gap inside the lead", () => {
    const result = nutrition([w("2026-02-01", "2026-03-11"), w("2026-03-12", "2026-03-15")])
    expect(result?.message).toBe("Nutrition targets end 15 Mar")
    expect(result?.affectedDays).toEqual(["2026-03-09"])
  })

  it("reads HIGH once the prescription has stopped with nothing queued, anchored on today", () => {
    expect(nutrition([w("2026-02-01", "2026-03-06")])).toEqual({
      type: "nutrition_ending",
      severity: "high",
      message: "No nutrition targets from 7 Mar",
      affectedDays: ["2026-03-10"],
      metricData: [],
    })
  })

  it("dates the stop from the last version that ended, however long ago", () => {
    const result = nutrition([w("2025-12-01", "2025-12-31"), w("2026-01-01", "2026-02-15")])
    expect(result?.message).toBe("No nutrition targets from 16 Feb")
  })

  it("is quiet during a gap with a plan queued after it — a holiday or a rest the coach laid out", () => {
    expect(nutrition([w("2026-02-01", "2026-03-06"), w("2026-03-25", "2026-04-25")])).toBeNull()
  })

  it("words the training track as training", () => {
    expect(training([w("2026-02-01", "2026-03-12")])).toMatchObject({
      type: "training_ending",
      severity: "medium",
      message: "Training ends 12 Mar",
    })
    expect(training([w("2026-02-01", "2026-03-06")])).toMatchObject({
      type: "training_ending",
      severity: "high",
      message: "No training scheduled from 7 Mar",
    })
    expect(
      training([w("2026-02-01", "2026-03-13"), w("2026-03-20", "2026-04-20")])?.message
    ).toBe("Training ends 13 Mar, nothing until 20 Mar")
  })
})

describe("evaluatePrescriptionEnding — naming the block", () => {
  const build = { name: "Build", start: "2026-02-01", end: "2026-03-13" }
  const cut = { name: "Cut", start: "2026-03-14", end: "2026-04-10" }
  const nutrition = (windows: PlanWindow[], blocks: typeof build[]) =>
    evaluatePrescriptionEnding({ track: "nutrition", windows, blocks, today: TODAY })?.message
  const training = (windows: PlanWindow[], blocks: typeof build[]) =>
    evaluatePrescriptionEnding({ track: "training", windows, blocks, today: TODAY })?.message

  it("keeps the plain form for a client with no blocks, or none covering the day", () => {
    expect(nutrition([w("2026-02-01", "2026-03-13")], [])).toBe("Nutrition targets end 13 Mar")
    expect(nutrition([w("2026-02-01", "2026-03-13")], [cut])).toBe("Nutrition targets end 13 Mar")
    expect(nutrition([w("2026-02-01", "2026-03-06")], [cut])).toBe("No nutrition targets from 7 Mar")
  })

  it("names the block whose last day the prescription ends on", () => {
    expect(nutrition([w("2026-02-01", "2026-03-13")], [build])).toBe(
      "Nutrition targets end 13 Mar, the last day of Build",
    )
  })

  it("says the next block has nothing set on this track, in the block card's words", () => {
    expect(nutrition([w("2026-02-01", "2026-03-13")], [build, cut])).toBe(
      "Nutrition targets end 13 Mar, the last day of Build, and Cut has no targets set",
    )
    expect(training([w("2026-02-01", "2026-03-13")], [build, cut])).toBe(
      "Training ends 13 Mar, the last day of Build, and Cut has no program placed",
    )
  })

  it("lets the queue clause speak for a plan queued after a gap", () => {
    expect(
      nutrition([w("2026-02-01", "2026-03-13"), w("2026-03-20", "2026-04-10")], [build, cut]),
    ).toBe("Nutrition targets end 13 Mar, the last day of Build, nothing until 20 Mar")
  })

  it("says inside the block when the prescription stops before its block does", () => {
    const longBuild = { name: "Build", start: "2026-02-01", end: "2026-03-31" }
    expect(nutrition([w("2026-02-01", "2026-03-11")], [longBuild, { ...cut, start: "2026-04-01", end: "2026-04-28" }])).toBe(
      "Nutrition targets end 11 Mar, inside Build",
    )
  })

  it("names the block the client is sitting in with nothing", () => {
    // Blocks never overlap (the gist constraint), so Build ends where Cut begins.
    const ended = { name: "Build", start: "2026-02-01", end: "2026-03-06" }
    const current = { name: "Cut", start: "2026-03-07", end: "2026-04-03" }
    expect(nutrition([w("2026-02-01", "2026-03-06")], [ended, current])).toBe(
      "No nutrition targets from 7 Mar, in Cut",
    )
    expect(training([w("2026-02-01", "2026-03-06")], [current])).toBe(
      "No training scheduled from 7 Mar, in Cut",
    )
  })
})
