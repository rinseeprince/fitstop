import { describe, expect, it } from "vitest"
import { SEVERITY_RANK, sortAlertsBySeverity } from "./attention-alert-severity"

describe("sortAlertsBySeverity", () => {
  it("puts high before medium before low", () => {
    const sorted = sortAlertsBySeverity([
      { id: "m", severity: "medium" as const },
      { id: "l", severity: "low" as const },
      { id: "h", severity: "high" as const },
    ])
    expect(sorted.map((a) => a.id)).toEqual(["h", "m", "l"])
  })

  it("keeps the given order within one severity, and leaves the input untouched", () => {
    const input = [
      { id: "m1", severity: "medium" as const },
      { id: "h1", severity: "high" as const },
      { id: "m2", severity: "medium" as const },
      { id: "h2", severity: "high" as const },
    ]
    expect(sortAlertsBySeverity(input).map((a) => a.id)).toEqual(["h1", "h2", "m1", "m2"])
    expect(input.map((a) => a.id)).toEqual(["m1", "h1", "m2", "h2"])
  })

  it("ranks every severity the type allows", () => {
    expect(SEVERITY_RANK.high).toBeLessThan(SEVERITY_RANK.medium)
    expect(SEVERITY_RANK.medium).toBeLessThan(SEVERITY_RANK.low)
  })
})
