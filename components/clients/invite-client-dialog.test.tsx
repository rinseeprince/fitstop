import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { SWRConfig } from "swr"

const { toast } = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
}))
vi.mock("sonner", () => ({ toast }))

import { InviteClientDialog, invitationSentence } from "./invite-client-dialog"
import type { InvitationRead } from "@/types/auth"

const CLIENT = { id: "c-1", name: "Sam Doe", email: "sam@example.com" }
const READ_URL = "/api/clients/c-1/invitation"

const NONE: InvitationRead = { hasAccount: false, invitation: null }
const WORKING: InvitationRead = {
  hasAccount: false,
  invitation: { sentOn: "2026-10-08", expiresOn: "2026-10-15", linkWorks: true },
}
const EXPIRED: InvitationRead = {
  hasAccount: false,
  invitation: { sentOn: "2026-10-01", expiresOn: "2026-10-08", linkWorks: false },
}
const ACCOUNT: InvitationRead = { hasAccount: true, invitation: { sentOn: "2026-10-01", expiresOn: "2026-10-08", linkWorks: false } }

type Answer = { status: number; body: unknown }
const ok = (data: unknown): Answer => ({ status: 200, body: { success: true, data } })

/** The server: each GET answers `reads` in turn (the last one repeating), each POST `sends` in turn. A `null` never lands. */
let reads: Array<Answer | null> = []
let sends: Array<Answer | Error | null> = []
let fetchMock: ReturnType<typeof vi.fn>

function respond(answer: Answer) {
  return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, json: () => Promise.resolve(answer.body) }
}

beforeEach(() => {
  vi.clearAllMocks()
  reads = [ok(NONE)]
  sends = [ok(WORKING)]
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    expect(url).toBe(READ_URL)
    if (init?.method === "POST") {
      const answer = sends.length > 1 ? sends.shift()! : sends[0]
      if (answer === null) return new Promise(() => {})
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(respond(answer))
    }
    const answer = reads.length > 1 ? reads.shift()! : reads[0]
    return answer === null ? new Promise(() => {}) : Promise.resolve(respond(answer))
  })
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderBox() {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <InviteClientDialog client={CLIENT} trigger={<button type="button">Open invite</button>} />
    </SWRConfig>
  )
  return userEvent.setup()
}

async function openBox(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Open invite" }))
  return screen.getByRole("dialog")
}

const sendButton = () => screen.queryByRole("button", { name: /^(Send|Resend) invitation$/ })

describe("invitationSentence (rule 21): what is true, from the dates", () => {
  it.each([
    ["never invited", NONE, "Not invited yet."],
    ["a link that works", WORKING, "Sent 8 Oct. The link works until 15 Oct."],
    ["a link that expired", EXPIRED, "Sent 1 Oct. The link expired on 8 Oct."],
    ["an account", ACCOUNT, "Sam Doe has an account."],
    ["a link with no expiry", { hasAccount: false, invitation: { sentOn: "2026-10-08", expiresOn: null, linkWorks: true } }, "Sent 8 Oct. The link works."],
    ["a row with no send date", { hasAccount: false, invitation: { sentOn: null, expiresOn: "2026-10-15", linkWorks: true } }, "The link works until 15 Oct."],
  ] as const)("%s → %s", (_label, read, sentence) => {
    expect(invitationSentence("Sam Doe", read)).toBe(sentence)
  })
})

describe("the Invite box", () => {
  it("opens on the client's name and address, its sentence pending and no send button until the read lands", async () => {
    reads = [null]
    const user = renderBox()
    const box = await openBox(user)

    expect(within(box).getByRole("heading", { name: "Invite Sam Doe" })).toBeInTheDocument()
    expect(within(box).getByText("sam@example.com")).toBeInTheDocument()
    expect(box.querySelector('[data-slot="skeleton"]')).not.toBeNull()
    expect(within(box).queryByText("Not invited yet.")).not.toBeInTheDocument()
    expect(sendButton()).not.toBeInTheDocument()
  })

  it.each([
    ["never invited", NONE, "Not invited yet.", "Send invitation"],
    ["a link that works", WORKING, "Sent 8 Oct. The link works until 15 Oct.", "Resend invitation"],
    ["a link that expired", EXPIRED, "Sent 1 Oct. The link expired on 8 Oct.", "Resend invitation"],
  ] as const)("%s: says so, with its button", async (_label, read, sentence, button) => {
    reads = [ok(read)]
    const user = renderBox()
    const box = await openBox(user)

    expect(await within(box).findByText(sentence)).toBeInTheDocument()
    expect(within(box).getByRole("button", { name: button })).toBeEnabled()
  })

  it("a client with an account: says so, and offers no send", async () => {
    reads = [ok(ACCOUNT)]
    const user = renderBox()
    const box = await openBox(user)

    expect(await within(box).findByText("Sam Doe has an account.")).toBeInTheDocument()
    expect(sendButton()).not.toBeInTheDocument()
  })

  // Rule 20, the bug this commit fixes: a failed email left the box with no
  // button. Every read of a client with no account offers a send.
  it.each([
    ["never invited", NONE],
    ["a link that works", WORKING],
    ["a link that expired", EXPIRED],
    ["a used link", { hasAccount: false, invitation: { sentOn: "2026-10-01", expiresOn: "2026-10-08", linkWorks: false } }],
    ["a link with no expiry", { hasAccount: false, invitation: { sentOn: "2026-10-08", expiresOn: null, linkWorks: true } }],
    ["a row with no dates", { hasAccount: false, invitation: { sentOn: null, expiresOn: null, linkWorks: false } }],
  ] as const)("always offers a send to a client with no account: %s", async (_label, read) => {
    reads = [ok(read)]
    const user = renderBox()
    await openBox(user)

    await waitFor(() => expect(sendButton()).toBeInTheDocument())
    expect(sendButton()).toBeEnabled()
  })

  it("a read that fails says so, with Try again, never \"Not invited yet.\"; Try again reads it again", async () => {
    reads = [{ status: 500, body: { success: false, error: "Couldn't load the invitation." } }]
    const user = renderBox()
    const box = await openBox(user)

    expect(await within(box).findByText("Couldn't load the invitation.")).toBeInTheDocument()
    expect(within(box).queryByText("Not invited yet.")).not.toBeInTheDocument()
    expect(sendButton()).not.toBeInTheDocument()

    reads = [ok(EXPIRED)]
    await user.click(within(box).getByRole("button", { name: "Try again" }))

    expect(await within(box).findByText("Sent 1 Oct. The link expired on 8 Oct.")).toBeInTheDocument()
    expect(within(box).getByRole("button", { name: "Resend invitation" })).toBeEnabled()
  })

  it("clears its read as it opens: a second open never shows the first open's answer", async () => {
    reads = [ok(NONE), null]
    const user = renderBox()
    const box = await openBox(user)
    expect(await within(box).findByText("Not invited yet.")).toBeInTheDocument()

    await user.click(within(box).getByRole("button", { name: "Close" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

    const again = await openBox(user)
    expect(within(again).queryByText("Not invited yet.")).not.toBeInTheDocument()
    expect(again.querySelector('[data-slot="skeleton"]')).not.toBeNull()
    expect(sendButton()).not.toBeInTheDocument()
  })

  // The design system's footer, in every state: the footer keeps its height,
  // so the card doesn't move when the read lands.
  it.each([
    ["while its read is pending", [null]],
    ["once it lands", [ok(NONE)]],
    ["for a client with an account", [ok(ACCOUNT)]],
    ["when its read fails", [{ status: 500, body: { success: false, error: "Couldn't load the invitation." } }]],
  ] as const)("keeps Cancel in its footer %s, and Cancel closes it", async (_label, answers) => {
    reads = [...answers]
    const user = renderBox()
    const box = await openBox(user)
    if (answers[0] !== null) await waitFor(() => expect(box.querySelector('[data-slot="skeleton"]')).toBeNull())

    const footer = box.querySelector<HTMLElement>('[data-slot="dialog-footer"]')
    expect(footer).not.toBeNull()
    await user.click(within(footer!).getByRole("button", { name: "Cancel" }))

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("won't close while a send is in flight: its answer decides", async () => {
    sends = [null]
    const user = renderBox()
    const box = await openBox(user)
    await user.click(await within(box).findByRole("button", { name: "Send invitation" }))

    expect(within(box).getByRole("button", { name: "Cancel" })).toBeDisabled()
    expect(within(box).getByRole("button", { name: "Send invitation" })).toBeDisabled()
    await user.keyboard("{Escape}")
    await user.click(within(box).getByRole("button", { name: "Close" }))
    expect(screen.getByRole("dialog")).toBe(box)
  })

  it("a send that goes closes the box with \"Invitation sent\" to the client's address", async () => {
    const user = renderBox()
    const box = await openBox(user)
    await user.click(await within(box).findByRole("button", { name: "Send invitation" }))

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(toast.success).toHaveBeenCalledWith("Invitation sent", { description: "Sent to sam@example.com." })
    expect(toast.error).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith(READ_URL, { method: "POST" })
  })

  it.each([
    ["the email didn't go", { status: 502, body: { success: false, error: "The email couldn't be sent. Try again." } }, "The email couldn't be sent. Try again."],
    ["the client has an account", { status: 409, body: { success: false, error: "This client already has an account." } }, "This client already has an account."],
    ["too many tries", { status: 429, body: { error: "Too many requests", message: "Rate limit exceeded. Please try again later." } }, "Too many attempts. Wait a moment and try again."],
    // Answers that aren't the route's: their words are not for a coach.
    ["the session ended", { status: 401, body: { success: false, error: "Unauthorized" } }, "Something went wrong. Try again."],
    ["the request named another site", { status: 403, body: { error: "CSRF validation failed" } }, "Something went wrong. Try again."],
    ["the request never landed", new TypeError("Failed to fetch"), "Something went wrong. Try again."],
  ] as const)("a send that didn't go (%s) leaves the box open and as it was, and says why in plain words", async (_label, answer, reason) => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    reads = [ok(EXPIRED)]
    sends = [answer]
    const user = renderBox()
    const box = await openBox(user)
    await user.click(await within(box).findByRole("button", { name: "Resend invitation" }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Invitation not sent", { description: reason }))
    expect(screen.getByRole("dialog")).toBe(box)
    expect(within(box).getByText("Sent 1 Oct. The link expired on 8 Oct.")).toBeInTheDocument()
    expect(within(box).getByRole("button", { name: "Resend invitation" })).toBeEnabled()
    expect(toast.success).not.toHaveBeenCalled()
  })
})
