/**
 * The roster row's date formatting, lifted out of `roster-row.tsx` when the
 * component reached its 250-line guideline.
 *
 * All three are en-GB and drop the year while it is the current one — a roster
 * is read as "recent", so "24 Aug 2026" spends width on the one part the coach
 * already knows.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** "24 Aug", or "24 Aug 2025" once the year stops being obvious. */
export function formatShortDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === new Date().getFullYear()
      ? {}
      : { year: "numeric" }),
  })
}

/**
 * How long ago the last check-in was. Words where it is a word ("Today",
 * "Never") and mono where the numeral IS the information — the split the
 * mono=numbers rule asks for when the branches are already distinguishable.
 */
export function formatLastCheckIn(iso: string | undefined): {
  text: string
  isNumeric: boolean
} {
  if (!iso) return { text: "Never", isNumeric: false }
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return { text: "Never", isNumeric: false }

  const days = Math.floor((Date.now() - then.getTime()) / DAY_MS)
  if (days <= 0) return { text: "Today", isNumeric: false }
  if (days === 1) return { text: "Yesterday", isNumeric: false }
  if (days < 30) return { text: `${days} days ago`, isNumeric: true }
  const months = Math.floor(days / 30)
  return {
    text: `${months} ${months === 1 ? "month" : "months"} ago`,
    isNumeric: true,
  }
}

/** "7 Aug", or "7 Aug 2025" once the year stops being obvious. */
export function formatInvitedOn(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  return formatShortDate(date)
}
