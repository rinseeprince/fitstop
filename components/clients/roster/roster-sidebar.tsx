"use client"

import { UserPlus, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  SectionSidebar,
  SectionSidebarGroupLabel,
  SectionSidebarNav,
  SectionSidebarTab,
} from "@/components/section-sidebar"
import { AddClientDialog } from "@/components/add-client-dialog"
import {
  COUNT_CHIP_CLASS,
  FOCUS_RING,
  MONO,
  MONO_META_CLASS,
  THUMB_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens"
import {
  ROSTER_ATTENTION_VIEWS,
  ROSTER_SHAPE_VIEWS,
  rosterViewLabel,
  rosterViewUrl,
  type RosterCounts,
  type RosterView,
} from "@/lib/roster-views"

/** A plain right-aligned count. Faint at zero — an empty view is not news. */
function ViewCount({ count }: { count: number }) {
  return (
    <span
      className={cn(
        "text-[10px]",
        MONO_META_CLASS,
        count === 0 && "text-[#c2d0cc]",
      )}
    >
      {count}
    </span>
  )
}

/**
 * A queue's badge. Only a queue with something in it earns a badge: an amber
 * pill reading "0" announces a problem that does not exist, so an empty queue
 * falls back to the same faint numeral as every other view.
 */
function QueueBadge({ count, tone }: { count: number; tone: "warn" | "teal" }) {
  if (count === 0) return <ViewCount count={0} />
  if (tone === "teal") return <span className={COUNT_CHIP_CLASS}>{count}</span>
  return (
    <span
      className={cn(
        MONO,
        "rounded-[6px] bg-[rgba(245,158,11,0.07)] px-1.5 py-0.5 text-[10px] font-semibold text-[#d97706]",
      )}
    >
      {count}
    </span>
  )
}

export function RosterSidebar({
  activeView,
  counts,
  onClientAdded,
}: {
  activeView: RosterView
  counts: RosterCounts
  onClientAdded: () => void
}) {
  return (
    <SectionSidebar
      header={
        <>
          <span className={cn(THUMB_CLASS, "h-[26px] w-[26px]")}>
            <Users className="h-3.5 w-3.5" strokeWidth={1.5} />
          </span>
          <span className="truncate text-[13.5px] font-semibold text-[#0c1a1e]">
            Clients
          </span>
        </>
      }
      footer={
        <div className="px-[18px] py-3">
          <AddClientDialog
            onClientAdded={onClientAdded}
            trigger={
              <button
                type="button"
                className={cn(
                  "flex w-full items-center justify-center gap-1.5 rounded-[6px] border border-dashed border-[rgba(13,148,136,0.25)] py-2 text-xs font-medium text-[#5a7d82] transition-colors hover:border-[#0d9488] hover:bg-[rgba(13,148,136,0.05)] hover:text-[#0a5c55]",
                  FOCUS_RING,
                )}
              >
                <UserPlus className="h-3.5 w-3.5" strokeWidth={1.5} />
                Invite client
              </button>
            }
          />
        </div>
      }
    >
      <SectionSidebarNav className="pt-4">
        {ROSTER_SHAPE_VIEWS.map((view) => (
          <SectionSidebarTab
            key={view}
            label={rosterViewLabel(view)}
            href={rosterViewUrl(view)}
            isActive={activeView === view}
            trailing={<ViewCount count={counts[view]} />}
          />
        ))}
      </SectionSidebarNav>

      <SectionSidebarGroupLabel label="Attention" />

      <SectionSidebarNav>
        {ROSTER_ATTENTION_VIEWS.map((view) => (
          <SectionSidebarTab
            key={view}
            label={rosterViewLabel(view)}
            href={rosterViewUrl(view)}
            isActive={activeView === view}
            trailing={
              <QueueBadge
                count={counts[view]}
                tone={view === "overdue" ? "warn" : "teal"}
              />
            }
          />
        ))}
      </SectionSidebarNav>
    </SectionSidebar>
  )
}
