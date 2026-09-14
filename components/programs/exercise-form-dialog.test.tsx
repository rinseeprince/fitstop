import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react"
import type { Exercise } from "@/types/training"
import { ExerciseFormDialog } from "./exercise-form-dialog"

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

const curl: Exercise = {
  id: "ex-curl",
  coachId: "coach-1",
  name: "My Custom Curl",
  muscleGroup: "biceps",
  equipment: "dumbbell",
  category: null,
  aliases: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
}

function jsonResponse(status: number): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve({}) } as Response
}

describe("ExerciseFormDialog", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(200))
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("renders from its exercise, and create mode without one", () => {
    const { rerender } = render(
      <ExerciseFormDialog key="open-1" open onOpenChange={vi.fn()} exercise={curl} onSaved={vi.fn()} />,
    )
    expect(screen.getByText("Edit exercise")).toBeInTheDocument()
    expect(screen.getByDisplayValue("My Custom Curl")).toBeInTheDocument()

    // The close keeps the card as it was; the host keys the next open anew.
    rerender(<ExerciseFormDialog key="open-1" open={false} onOpenChange={vi.fn()} exercise={curl} onSaved={vi.fn()} />)
    rerender(<ExerciseFormDialog key="open-2" open onOpenChange={vi.fn()} exercise={null} onSaved={vi.fn()} />)
    expect(screen.getByText("New exercise")).toBeInTheDocument()
    expect(screen.queryByDisplayValue("My Custom Curl")).toBeNull()
  })

  // CONVENTIONS §7 → "No frame disagrees": a success closes on the frame it
  // was on, so the flag stays set under the closing card and the next open
  // clears it.
  it("a successful save closes with its in-flight flag set, and the next open clears it", async () => {
    const onOpenChange = vi.fn()
    const onSaved = vi.fn()
    const { rerender } = render(
      <ExerciseFormDialog key="open-1" open onOpenChange={onOpenChange} exercise={curl} onSaved={onSaved} />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith("/api/training/exercises/ex-curl", expect.objectContaining({ method: "PATCH" }))
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled()

    rerender(<ExerciseFormDialog key="open-1" open={false} onOpenChange={onOpenChange} exercise={curl} onSaved={onSaved} />)
    rerender(<ExerciseFormDialog key="open-2" open onOpenChange={onOpenChange} exercise={curl} onSaved={onSaved} />)
    expect(screen.getByRole("button", { name: "Save changes" })).not.toBeDisabled()
  })

  it("a failed save stays open and re-enables its button", async () => {
    fetchMock.mockResolvedValue(jsonResponse(500))
    const onOpenChange = vi.fn()
    render(<ExerciseFormDialog open onOpenChange={onOpenChange} exercise={curl} onSaved={vi.fn()} />)
    const save = screen.getByRole("button", { name: "Save changes" })
    fireEvent.click(save)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(save).not.toBeDisabled())
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
