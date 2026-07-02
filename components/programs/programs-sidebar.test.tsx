import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { vi } from "vitest"
import { ProgramsSidebar } from "./programs-sidebar"
import { LAST_PLAN_STORAGE_KEY } from "@/lib/programs-nav"

let mockPathname = "/dashboard/programs"

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}))

describe("ProgramsSidebar", () => {
  beforeEach(() => {
    sessionStorage.clear()
    mockPathname = "/dashboard/programs"
  })

  afterEach(() => {
    cleanup()
  })

  it("marks the Programs item active on the section root only", () => {
    render(<ProgramsSidebar />)
    const programs = screen.getByRole("link", { name: "Programs" })
    expect(programs.className).toContain("font-semibold")
    const sessions = screen.getByRole("link", { name: "Sessions" })
    expect(sessions.className).not.toContain("font-semibold")
  })

  it("marks Sessions active on its route without activating Builder", () => {
    mockPathname = "/dashboard/programs/sessions"
    render(<ProgramsSidebar />)
    expect(screen.getByRole("link", { name: "Sessions" }).className).toContain(
      "font-semibold",
    )
    // Builder stays the disabled placeholder — "sessions" is a static view,
    // not a plan id.
    expect(screen.queryByRole("link", { name: "Builder" })).toBeNull()
  })

  it("disables Builder when no program was opened this session", () => {
    render(<ProgramsSidebar />)
    const builder = screen.getByTitle("Open a program from the list first")
    expect(builder.getAttribute("aria-disabled")).toBe("true")
  })

  it("links Builder to the last opened program from sessionStorage", () => {
    sessionStorage.setItem(LAST_PLAN_STORAGE_KEY, "plan-9")
    render(<ProgramsSidebar />)
    const builder = screen.getByRole("link", { name: "Builder" })
    expect(builder.getAttribute("href")).toBe("/dashboard/programs/plan-9")
    expect(builder.className).not.toContain("font-semibold")
  })

  it("marks Builder active on a plan route and links to that plan", () => {
    mockPathname = "/dashboard/programs/plan-7/sessions/new"
    render(<ProgramsSidebar />)
    const builder = screen.getByRole("link", { name: "Builder" })
    expect(builder.getAttribute("href")).toBe("/dashboard/programs/plan-7")
    expect(builder.className).toContain("font-semibold")
  })
})
