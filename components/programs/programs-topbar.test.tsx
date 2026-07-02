import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"
import { ProgramsTopbar } from "./programs-topbar"

const mockPush = vi.fn()
let mockPathname = "/dashboard/programs"

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: mockPush }),
}))

// The bell polls /api/notifications — irrelevant here.
vi.mock("@/components/navbar/notifications-dropdown", () => ({
  NotificationsDropdown: () => null,
}))

describe("ProgramsTopbar", () => {
  beforeEach(() => {
    mockPush.mockReset()
    mockPathname = "/dashboard/programs"
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it.each([
    ["/dashboard/programs", "Programs", "New program"],
    ["/dashboard/programs/sessions", "Sessions", "New session"],
    ["/dashboard/programs/exercises", "Exercise Library", "New exercise"],
  ])("renders title + action for %s", (path, title, action) => {
    mockPathname = path
    render(<ProgramsTopbar />)
    expect(screen.getByRole("heading", { name: title })).toBeDefined()
    expect(screen.getByRole("button", { name: new RegExp(action) })).toBeDefined()
  })

  it("renders no action on the builder view", () => {
    mockPathname = "/dashboard/programs/plan-1"
    render(<ProgramsTopbar />)
    expect(screen.getByRole("heading", { name: "Program Builder" })).toBeDefined()
    expect(screen.queryByRole("button", { name: /New/ })).toBeNull()
  })

  it("POSTs a 7-rest-day draft and navigates to it on New program", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ planId: "plan-42" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<ProgramsTopbar />)
    fireEvent.click(screen.getByRole("button", { name: /New program/ }))

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/dashboard/programs/plan-42")
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/training/saved-plans")
    const body = JSON.parse(String(init.body)) as {
      name: string
      sessions: Array<{ isRest: boolean }>
    }
    expect(body.name).toBe("Untitled program")
    expect(body.sessions).toHaveLength(7)
    expect(body.sessions.every((s) => s.isRest)).toBe(true)
  })

  it("hands off to the pages via ?new=1 for sessions and exercises", () => {
    mockPathname = "/dashboard/programs/sessions"
    render(<ProgramsTopbar />)
    fireEvent.click(screen.getByRole("button", { name: /New session/ }))
    expect(mockPush).toHaveBeenCalledWith("/dashboard/programs/sessions?new=1")

    cleanup()
    mockPathname = "/dashboard/programs/exercises"
    render(<ProgramsTopbar />)
    fireEvent.click(screen.getByRole("button", { name: /New exercise/ }))
    expect(mockPush).toHaveBeenCalledWith("/dashboard/programs/exercises?new=1")
  })
})
