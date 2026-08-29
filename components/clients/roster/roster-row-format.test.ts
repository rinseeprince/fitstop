import { describe, it, expect, afterEach, vi } from "vitest"
import {
  formatInvitedOn,
  formatLastCheckIn,
  formatShortDate,
} from "./roster-row-format"

// The suite runs pinned to UTC (vitest.config.ts), so a fixed "now" makes every
// day-distance branch deterministic.
function freezeNow(iso: string) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(iso))
}

afterEach(() => {
  vi.useRealTimers()
})

describe("formatShortDate", () => {
  it("drops the year while it is the current one", () => {
    freezeNow("2026-08-29T12:00:00Z")
    expect(formatShortDate(new Date("2026-08-24T00:00:00Z"))).toBe("24 Aug")
  })

  it("keeps the year once it stops being obvious", () => {
    freezeNow("2026-08-29T12:00:00Z")
    expect(formatShortDate(new Date("2025-08-24T00:00:00Z"))).toBe("24 Aug 2025")
  })
})

describe("formatLastCheckIn", () => {
  it("reads today and yesterday as words", () => {
    freezeNow("2026-08-29T12:00:00Z")
    expect(formatLastCheckIn("2026-08-29T09:00:00Z")).toEqual({
      text: "Today",
      isNumeric: false,
    })
    expect(formatLastCheckIn("2026-08-28T09:00:00Z")).toEqual({
      text: "Yesterday",
      isNumeric: false,
    })
  })

  it("reads a distance as a numeral, in days then months", () => {
    freezeNow("2026-08-29T12:00:00Z")
    expect(formatLastCheckIn("2026-08-24T12:00:00Z")).toEqual({
      text: "5 days ago",
      isNumeric: true,
    })
    expect(formatLastCheckIn("2026-06-29T12:00:00Z")).toEqual({
      text: "2 months ago",
      isNumeric: true,
    })
    expect(formatLastCheckIn("2026-07-29T12:00:00Z")).toEqual({
      text: "1 month ago",
      isNumeric: true,
    })
  })

  it("reads a missing or unparseable date as the word Never", () => {
    expect(formatLastCheckIn(undefined)).toEqual({
      text: "Never",
      isNumeric: false,
    })
    expect(formatLastCheckIn("not-a-date")).toEqual({
      text: "Never",
      isNumeric: false,
    })
  })
})

describe("formatInvitedOn", () => {
  it("renders the short date, and a dash for an unparseable one", () => {
    freezeNow("2026-08-29T12:00:00Z")
    expect(formatInvitedOn("2026-08-07T09:00:00Z")).toBe("7 Aug")
    expect(formatInvitedOn("not-a-date")).toBe("—")
  })
})
