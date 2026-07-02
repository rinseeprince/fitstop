import { describe, it, expect } from "vitest"
import { getBuilderPlanId, getProgramsView, isBuilderPath } from "./programs-nav"

describe("programs-nav path helpers", () => {
  it("treats a plan id segment as the builder", () => {
    expect(getBuilderPlanId("/dashboard/programs/abc-123")).toBe("abc-123")
    expect(isBuilderPath("/dashboard/programs/abc-123")).toBe(true)
    expect(getProgramsView("/dashboard/programs/abc-123")).toBe("builder")
  })

  it("keeps builder sub-paths (slide-over routes) on the builder view", () => {
    expect(getBuilderPlanId("/dashboard/programs/abc-123/sessions/new")).toBe("abc-123")
    expect(getProgramsView("/dashboard/programs/abc-123/sessions/new")).toBe("builder")
  })

  it("excludes the static section views from builder detection", () => {
    expect(getBuilderPlanId("/dashboard/programs/sessions")).toBeNull()
    expect(getBuilderPlanId("/dashboard/programs/exercises")).toBeNull()
    expect(getProgramsView("/dashboard/programs/sessions")).toBe("sessions")
    expect(getProgramsView("/dashboard/programs/exercises")).toBe("exercises")
  })

  it("maps the section root to the programs view", () => {
    expect(getBuilderPlanId("/dashboard/programs")).toBeNull()
    expect(getProgramsView("/dashboard/programs")).toBe("programs")
  })
})
