import type { ReactNode } from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { SWRConfig } from "swr"

// Every committed frame of the card, as "open|pending" or "open|<its text>".
const frames = vi.hoisted(() => [] as string[])

// The closing card's shape (CONVENTIONS §7 → "No frame disagrees", rule 5).
// Radix keeps a closing card mounted through its exit animation and re-renders
// it from live state; jsdom never plays that animation, so the stub below
// stands in for it: the card stays rendered whatever `open` is, carries `open`
// as data, and records what it shows on every commit. A close must flip
// `open` and leave the read's sentence; the next open clears it.
vi.mock("@/components/ui/dialog", async () => {
  const { createContext, useContext, useLayoutEffect, useRef } = await import("react")
  const DialogState = createContext({ open: false, onOpenChange: (_open: boolean) => {} })
  const Pass = ({ children }: { children: ReactNode }) => <div>{children}</div>
  return {
    Dialog: ({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) => (
      <DialogState.Provider value={{ open, onOpenChange }}>{children}</DialogState.Provider>
    ),
    DialogTrigger: ({ children }: { children: ReactNode }) => {
      const { open, onOpenChange } = useContext(DialogState)
      return <span onClick={() => onOpenChange(!open)}>{children}</span>
    },
    DialogContent: ({ children }: { children: ReactNode }) => {
      const { open, onOpenChange } = useContext(DialogState)
      const card = useRef<HTMLDivElement>(null)
      useLayoutEffect(() => {
        const pending = card.current?.querySelector('[data-slot="skeleton"]') !== null
        frames.push(`${open}|${pending ? "pending" : card.current?.textContent ?? ""}`)
      })
      return (
        <div ref={card} data-testid="card" data-open={String(open)}>
          {children}
          <button type="button" onClick={() => onOpenChange(false)}>
            Close box
          </button>
        </div>
      )
    },
    DialogHeader: Pass,
    DialogFooter: Pass,
    DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
    DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  }
})

const { toast } = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
}))
vi.mock("sonner", () => ({ toast }))

import { InviteClientDialog } from "./invite-client-dialog"

const CLIENT = { id: "c-1", name: "Sam Doe", email: "sam@example.com" }
const NONE = { hasAccount: false, invitation: null }
const WORKING = { hasAccount: false, invitation: { sentOn: "2026-10-08", expiresOn: "2026-10-15", linkWorks: true } }
const respond = (data: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve({ success: true, data }) })

/** Each GET answers `reads` in turn (the last one repeating; `null` never lands); a POST answers the send. */
let reads: Array<unknown | null> = []

beforeEach(() => {
  vi.clearAllMocks()
  frames.length = 0
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return Promise.resolve(respond(WORKING))
      const next = reads.length > 1 ? reads.shift() : reads[0]
      return next === null ? new Promise(() => {}) : Promise.resolve(respond(next))
    })
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const card = () => screen.getByTestId("card")
/** The distinct frames committed since the last `frames.length = 0`, in order. */
const committed = () => [...new Set(frames)]

async function openOn(sentence: string) {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <InviteClientDialog client={CLIENT} trigger={<button type="button">Open invite</button>} />
    </SWRConfig>
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole("button", { name: "Open invite" }))
  await waitFor(() => expect(card()).toHaveTextContent(sentence))
  return user
}

describe("the Invite box's closing card", () => {
  it("a send that goes closes on the sentence it showed and its busy button, never on pending text", async () => {
    reads = [NONE]
    const user = await openOn("Not invited yet.")
    frames.length = 0

    await user.click(screen.getByRole("button", { name: "Send invitation" }))

    await waitFor(() => expect(card()).toHaveAttribute("data-open", "false"))
    expect(committed().every((frame) => frame.includes("Not invited yet."))).toBe(true)
    expect(committed().at(-1)?.startsWith("false|")).toBe(true)
    expect(screen.getByRole("button", { name: "Send invitation" })).toBeDisabled()
    expect(toast.success).toHaveBeenCalledWith("Invitation sent", { description: "Sent to sam@example.com." })
  })

  it("a close keeps the sentence through the fade", async () => {
    reads = [WORKING]
    const user = await openOn("Sent 8 Oct. The link works until 15 Oct.")
    frames.length = 0

    await user.click(screen.getByRole("button", { name: "Close box" }))

    expect(card()).toHaveAttribute("data-open", "false")
    expect(committed()).toEqual([`false|${card().textContent}`])
    expect(card()).toHaveTextContent("Sent 8 Oct. The link works until 15 Oct.")
  })

  it("the next open starts pending, in the same commit as the open: never on the last open's answer", async () => {
    reads = [NONE, null]
    const user = await openOn("Not invited yet.")
    await user.click(screen.getByRole("button", { name: "Close box" }))
    frames.length = 0

    await user.click(screen.getByRole("button", { name: "Open invite" }))

    expect(committed()).toEqual(["true|pending"])
  })
})
