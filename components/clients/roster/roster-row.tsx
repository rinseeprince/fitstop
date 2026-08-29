"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronRight, Send } from "lucide-react"
import { cn } from "@/lib/utils"
import { TableCell, TableRow } from "@/components/ui/table"
import { RowActions } from "@/components/programs/shared/row-actions"
import {
  FOCUS_RING,
  MONO,
  MONO_META_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens"
import {
  isOnboarding,
  type RosterRow as RosterRowData,
  type RosterView,
} from "@/lib/roster-views"
import { checkInReviewUrl } from "@/lib/client-tabs"
import { resolveCheckInDue } from "@/lib/check-in-schedule"
import {
  CHIP_BASE_CLASS,
  ROSTER_STATUS_CHIP,
  ROSTER_STATUS_LABEL,
} from "./roster-status"
import {
  formatInvitedOn,
  formatLastCheckIn,
  formatShortDate,
} from "./roster-row-format"

/** A row's actions — Review, Review check-in, Reactivate. All stay visible in
 *  every view: absorbing the old onboarding hero must not bury the button that
 *  was its whole point. `0.08` is the secondary-border rung. */
const ROW_BUTTON_CLASS =
  "inline-flex items-center gap-1 rounded-[6px] border border-[rgba(13,148,136,0.08)] px-2.5 py-1 text-xs font-medium text-[#0d9488] transition-colors hover:bg-[rgba(13,148,136,0.05)] hover:text-[#0a5c55] disabled:opacity-50"

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

export function RosterTableRow({
  row,
  view,
  isPending,
  onReactivate,
  onSendReminder,
}: {
  row: RosterRowData
  view: RosterView
  isPending: boolean
  onReactivate: (clientId: string) => void
  onSendReminder: (clientId: string, name: string) => void
}) {
  const router = useRouter()
  const { client, status, daysOverdue, unreviewedCheckIn } = row

  const isInactive = status === "inactive"
  const onboarding = isOnboarding(status)
  const clientHref = `/clients/${client.id}`
  const reviewHref = unreviewedCheckIn
    ? checkInReviewUrl(client.id, unreviewedCheckIn.id)
    : null

  // In the review queue the row IS the check-in, so the row click and the
  // chevron address it. The NAME stays a link to the client either way — it
  // names the client, not the thing waiting on the coach.
  const rowHref = view === "review" && reviewHref ? reviewHref : clientHref

  const lastCheckIn = formatLastCheckIn(client.lastCheckInDate)
  // The same pure function /api/clients/overdue runs server-side, so the "due"
  // date here and the "Nd late" it sends back can never disagree.
  const dueOn = onboarding ? null : resolveCheckInDue(client)

  return (
    <TableRow
      className={cn("group/row", !isInactive && "cursor-pointer")}
      onClick={
        isInactive
          ? undefined
          : (event) => {
              // The name is a real link and the row carries real buttons; a
              // click that already landed on one of those has been handled.
              // `Element`, not `HTMLElement` — lucide renders SVG targets.
              if ((event.target as Element).closest("a, button")) return
              router.push(rowHref)
            }
      }
    >
      <TableCell className="pl-5">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[6px] text-[10px] font-semibold",
              onboarding ? "bg-[#f0f5f4] text-[#93b0b4]" : "text-white",
            )}
            style={
              onboarding
                ? undefined
                : { background: "linear-gradient(135deg, #0d9488, #0f766e)" }
            }
          >
            {getInitials(client.name)}
          </span>
          <div className="min-w-0">
            {/* A deactivated client's detail page 404s (getClientById is
                active-filtered), so the name is not a link there. */}
            {isInactive ? (
              <span className="block truncate text-[13.5px] font-semibold text-[#0c1a1e]">
                {client.name}
              </span>
            ) : (
              <Link
                href={clientHref}
                className={cn(
                  "block truncate rounded-[4px] text-[13.5px] font-semibold text-[#0c1a1e]",
                  FOCUS_RING,
                )}
              >
                {client.name}
              </Link>
            )}
            {onboarding ? (
              <span className={cn("mt-0.5 block text-[11px]", MONO_META_CLASS)}>
                Invited {formatInvitedOn(client.createdAt)}
              </span>
            ) : (
              <span className="mt-0.5 block truncate text-[11px] text-[#93b0b4]">
                {client.email}
              </span>
            )}
          </div>
        </div>
      </TableCell>

      <TableCell>
        <span className={cn(CHIP_BASE_CLASS, ROSTER_STATUS_CHIP[status])}>
          {ROSTER_STATUS_LABEL[status]}
        </span>
      </TableCell>

      <TableCell>
        {onboarding ? (
          // Nothing is expected of a client who has not started yet.
          <span className="text-[#c2d0cc]">—</span>
        ) : (
          <>
            <span
              className={cn(
                "block text-[12.5px]",
                lastCheckIn.isNumeric ? MONO : undefined,
                lastCheckIn.isNumeric ? "text-[#5a7d82]" : "text-[#93b0b4]",
              )}
            >
              {lastCheckIn.text}
            </span>
            {/* A row in an attention queue always shows why it is there — a
                queue's count and its contents have to agree. Lateness wins
                (amber is reserved for it); a waiting check-in comes next in
                teal, the tone its sidebar badge already uses; everyone else
                gets the forward-looking half instead.

                The waiting line is dated from the UNREVIEWED check-in, never
                from `lastCheckInDate` — that is the newest check-in of ANY
                status, so on the one row where the two differ it would name a
                check-in the coach has already replied to. */}
            {daysOverdue > 0 ? (
              <span className={cn(MONO, "mt-0.5 block text-[10px] text-[#d97706]")}>
                {daysOverdue}d late
              </span>
            ) : unreviewedCheckIn ? (
              <span className={cn(MONO, "mt-0.5 block text-[10px] text-[#0d9488]")}>
                review · {formatShortDate(new Date(unreviewedCheckIn.submittedAt))}
              </span>
            ) : (
              dueOn && (
                <span className={cn("mt-0.5 block text-[10px]", MONO_META_CLASS)}>
                  due {formatShortDate(dueOn)}
                </span>
              )
            )}
          </>
        )}
      </TableCell>

      <TableCell>
        <div className="flex items-center justify-end gap-1.5 pr-1">
          {status === "awaiting_review" && (
            <Link
              href={`${clientHref}/intake-review`}
              className={cn(ROW_BUTTON_CLASS, FOCUS_RING)}
            >
              Review
              <ChevronRight className="h-3 w-3" strokeWidth={1.5} />
            </Link>
          )}
          {/* Named "Review check-in" so it cannot be read as the intake Review
              above it. Visible in every view, like the other two row actions,
              and never on a deactivated row — that client's page 404s. */}
          {reviewHref && !isInactive && (
            <Link
              href={reviewHref}
              className={cn(ROW_BUTTON_CLASS, FOCUS_RING)}
            >
              Review check-in
              <ChevronRight className="h-3 w-3" strokeWidth={1.5} />
            </Link>
          )}
          {isInactive && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => onReactivate(client.id)}
              className={cn(ROW_BUTTON_CLASS, FOCUS_RING)}
            >
              {isPending ? "Reactivating" : "Reactivate"}
            </button>
          )}
          {daysOverdue > 0 && (
            <RowActions
              actions={[
                {
                  label: "Send reminder",
                  icon: Send,
                  disabled: isPending,
                  onClick: () => onSendReminder(client.id, client.name),
                },
              ]}
            />
          )}
          {!isInactive && (
            <ChevronRight
              className="h-[15px] w-[15px] shrink-0 text-[#93b0b4] opacity-0 transition-opacity duration-150 group-hover/row:opacity-100"
              strokeWidth={1.5}
            />
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}
