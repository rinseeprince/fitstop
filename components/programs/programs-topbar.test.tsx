import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { ProgramsTopbar } from "./programs-topbar"

let mockPathname = "/dashboard/programs"

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}))

// The bell polls /api/notifications — irrelevant here.
vi.mock("@/components/navbar/notifications-dropdown", () => ({
  NotificationsDropdown: () => null,
}))

describe("ProgramsTopbar", () => {
  beforeEach(() => {
    mockPathname = "/dashboard/programs"
  })

  afterEach(() => {
    cleanup()
  })

  it.each([
    ["/dashboard/programs", "Programs"],
    ["/dashboard/programs/sessions", "Sessions"],
    ["/dashboard/programs/exercises", "Exercise Library"],
  ])("renders the view title for %s", (path, title) => {
    mockPathname = path
    render(<ProgramsTopbar />)
    expect(screen.getByRole("heading", { name: title })).toBeDefined()
  })

  it("renders nothing on the builder route (full-bleed, its own header)", () => {
    mockPathname = "/dashboard/programs/plan-1"
    const { container } = render(<ProgramsTopbar />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole("heading")).toBeNull()
  })

  it("renders no create button — creation lives on the library dividers", () => {
    render(<ProgramsTopbar />)
    expect(screen.queryByRole("button", { name: /New/ })).toBeNull()
  })
})
