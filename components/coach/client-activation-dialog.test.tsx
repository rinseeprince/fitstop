import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// Activation sets the client's first check-in date, and the Habits tab's week
// starts on that date's weekday: a week cached before it would run on the old
// days.
const { clearHabitWeeks, clearInvitation, toast } = vi.hoisted(() => ({
  clearHabitWeeks: vi.fn(),
  clearInvitation: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
}))
vi.mock("@/hooks/use-client-habits", () => ({ useClearClientHabitWeeks: () => clearHabitWeeks }))
// Activation may send the client's invitation (D42): the Invite box's read changes.
vi.mock("@/hooks/use-client-invitation", () => ({ useClearClientInvitation: () => clearInvitation }))
vi.mock("sonner", () => ({ toast }))

import { ClientActivationDialog } from "./client-activation-dialog"
import type { Readiness } from "@/lib/activation-readiness-items"

const CLIENT = { id: "client-9", name: "Sam Kay", email: "sam@example.com" }
const READY: Readiness = { hasTrainingPlan: true, hasNutritionPlan: true, hasHabits: true }

/** Opens the dialog and presses Activate, the server answering `body`. */
async function activate(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) })
  vi.stubGlobal("fetch", fetchMock)
  const onActivated = vi.fn()
  render(
    <ClientActivationDialog
      client={CLIENT}
      readiness={READY}
      onActivated={onActivated}
      trigger={<button type="button">Open activation</button>}
    />
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole("button", { name: "Open activation" }))
  await user.click(screen.getByRole("button", { name: "Activate client" }))
  return { fetchMock, onActivated }
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("activating a client", () => {
  it("clears the Habits tab's weeks once the activation is saved", async () => {
    const { fetchMock, onActivated } = await activate({ success: true })

    await waitFor(() => expect(onActivated).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith("/api/clients/client-9/activate", expect.objectContaining({ method: "POST" }))
    expect(clearHabitWeeks).toHaveBeenCalledTimes(1)
    expect(clearHabitWeeks).toHaveBeenCalledWith("client-9")
  })

  it("clears nothing when the activation is refused", async () => {
    await activate({ success: false, error: "This client is already active." })

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Activation failed", { description: "This client is already active." })
    )
    expect(clearHabitWeeks).not.toHaveBeenCalled()
    expect(clearInvitation).not.toHaveBeenCalled()
  })

  it("clears the Invite box's read once the activation is saved: it may have sent the invitation", async () => {
    const { onActivated } = await activate({ success: true, data: { activated: true, invitation: "sent" } })

    await waitFor(() => expect(onActivated).toHaveBeenCalledTimes(1))
    expect(clearInvitation).toHaveBeenCalledWith("client-9")
  })

  // Rule 23: the client is active either way; an invitation that didn't send
  // is a warning that says where to send it from.
  it("warns when the invitation didn't send, and says where to send it from", async () => {
    const { onActivated } = await activate({ success: true, data: { activated: true, invitation: "failed" } })

    await waitFor(() => expect(onActivated).toHaveBeenCalledTimes(1))
    expect(toast.warning).toHaveBeenCalledWith("Sam Kay is now active", {
      description: "The invitation email didn't send. Send it from Invite on their page.",
    })
    expect(toast.success).not.toHaveBeenCalled()
  })

  it.each(["sent", "not_needed"] as const)("says they have been emailed when the invitation was %s", async (invitation) => {
    const { onActivated } = await activate({ success: true, data: { activated: true, invitation } })

    await waitFor(() => expect(onActivated).toHaveBeenCalledTimes(1))
    expect(toast.success).toHaveBeenCalledWith("Sam Kay is now active", {
      description: "They have been emailed and can see their plans.",
    })
    expect(toast.warning).not.toHaveBeenCalled()
  })
})
