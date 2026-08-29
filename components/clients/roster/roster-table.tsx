"use client"

import { useEffect, useMemo, useState } from "react"
import { UserPlus, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useRosterActions } from "@/hooks/use-roster-actions"
import { AddClientDialog } from "@/components/add-client-dialog"
import { LibrarySearchInput } from "@/components/programs/shared/library-search-input"
import { LibrarySortSelect } from "@/components/programs/shared/library-sort-select"
import { SectionLabel } from "@/components/programs/shared/section-label"
import {
  LIBRARY_PAGE_SIZE,
  LibraryTableShell,
} from "@/components/programs/shared/library-table-shell"
import { FOCUS_RING } from "@/components/clients/training/program-builder/builder-tokens"
import { matchesRosterView, type RosterRow, type RosterView } from "@/lib/roster-views"
import { RosterTableRow } from "./roster-row"

/** The sort options, as data: the union, the labels and the rendered items all
 *  come from here, so a typo in a `<SelectItem value>` cannot compile. */
const ROSTER_SORTS = [
  { value: "recent", label: "Recently added" },
  { value: "name", label: "Name A–Z" },
  { value: "overdue", label: "Most overdue" },
] as const

type RosterSort = (typeof ROSTER_SORTS)[number]["value"]

const VALID_SORTS = new Set<string>(ROSTER_SORTS.map((sort) => sort.value))

function resolveSort(value: string, fallback: RosterSort): RosterSort {
  return VALID_SORTS.has(value) ? (value as RosterSort) : fallback
}

/** A queue of late clients wants the latest first; every other view is a
 *  roster, and a roster reads newest-first the way the API already returns it. */
function defaultSort(view: RosterView): RosterSort {
  return view === "overdue" ? "overdue" : "recent"
}

const EMPTY_COPY: Record<RosterView, { line: string; hint: string }> = {
  all: {
    line: "No clients yet",
    hint: "Invite your first client to start coaching them",
  },
  active: {
    line: "No active clients",
    hint: "Everyone on your roster is still onboarding",
  },
  onboarding: {
    line: "No one is onboarding",
    hint: "Every client has finished setup",
  },
  inactive: {
    line: "No inactive clients",
    hint: "Everyone on your roster is live or onboarding",
  },
  overdue: {
    line: "No overdue check-ins",
    hint: "Every client is up to date",
  },
  review: {
    line: "No check-ins waiting",
    hint: "You have reviewed every check-in that came in",
  },
}

export function RosterTable({
  rows,
  view,
  onRosterChanged,
}: {
  rows: RosterRow[]
  view: RosterView
  onRosterChanged: () => void
}) {
  const { pendingId, reactivate, sendReminder } = useRosterActions(onRosterChanged)

  const [query, setQuery] = useState("")
  const [page, setPage] = useState(0)

  // The chosen sort is STAMPED with the view it was chosen for, rather than
  // reset by an effect on `view`. An effect commits a frame late, so a coach
  // who had touched the dropdown once saw every later view change render its
  // first frame under the previous view's sort, with the trigger showing the
  // stale label. Deriving is correct on the first frame.
  const [sort, setSort] = useState<{ view: RosterView; sort: RosterSort } | null>(
    null,
  )
  const effectiveSort = sort?.view === view ? sort.sort : defaultSort(view)

  useEffect(() => {
    setPage(0)
  }, [query, view])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matched = rows.filter((row) => {
      if (!matchesRosterView(row, view)) return false
      if (!needle) return true
      return (
        row.client.name.toLowerCase().includes(needle) ||
        row.client.email.toLowerCase().includes(needle)
      )
    })

    const sorted = [...matched]
    if (effectiveSort === "name") {
      sorted.sort((a, b) => a.client.name.localeCompare(b.client.name))
    } else if (effectiveSort === "overdue") {
      sorted.sort(
        (a, b) =>
          b.daysOverdue - a.daysOverdue ||
          a.client.name.localeCompare(b.client.name),
      )
    } else {
      sorted.sort(
        (a, b) =>
          new Date(b.client.createdAt).getTime() -
          new Date(a.client.createdAt).getTime(),
      )
    }
    return sorted
  }, [rows, view, query, effectiveSort])

  const pageCount = Math.max(1, Math.ceil(filtered.length / LIBRARY_PAGE_SIZE))
  const clampedPage = Math.min(page, pageCount - 1)
  const pageRows = filtered.slice(
    clampedPage * LIBRARY_PAGE_SIZE,
    (clampedPage + 1) * LIBRARY_PAGE_SIZE,
  )

  const empty = query.trim()
    ? { line: "No clients match that search", hint: "Try a shorter name" }
    : EMPTY_COPY[view]

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <LibrarySearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search clients"
        />
        <div className="flex-1" />
        <LibrarySortSelect
          options={[...ROSTER_SORTS]}
          value={effectiveSort}
          ariaLabel="Sort clients"
          onChange={(value) => {
            setSort({ view, sort: resolveSort(value, effectiveSort) })
            setPage(0)
          }}
        />
      </div>

      {/* "N clients", not "N shown": the shell's footer 25 rows below already
          says "Showing 25 of 40", and two different numbers under one word on
          one screen is worse than losing the word. */}
      <SectionLabel label="Client list" meta={`${filtered.length} clients`} />

      <LibraryTableShell
        shown={pageRows.length}
        total={filtered.length}
        noun="clients"
        page={clampedPage}
        pageCount={pageCount}
        onPageChange={setPage}
      >
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-5">Client</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last check-in</TableHead>
            <TableHead className="w-[150px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageRows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={4} className="py-12 text-center">
                <Users
                  className="mx-auto mb-2 h-8 w-8 text-[#93b0b4] opacity-50"
                  strokeWidth={1.5}
                />
                <p className="text-sm text-[#5a7d82]">{empty.line}</p>
                <p className="mt-1 text-xs text-[#93b0b4]">{empty.hint}</p>
                {rows.length === 0 && (
                  <AddClientDialog
                    onClientAdded={onRosterChanged}
                    trigger={
                      <button
                        type="button"
                        className={cn(
                          "mt-4 inline-flex items-center gap-1.5 rounded-[6px] bg-[#0d9488] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#0b7f75]",
                          FOCUS_RING,
                        )}
                      >
                        <UserPlus className="h-3.5 w-3.5" strokeWidth={1.5} />
                        Invite client
                      </button>
                    }
                  />
                )}
              </TableCell>
            </TableRow>
          ) : (
            pageRows.map((row) => (
              <RosterTableRow
                key={row.client.id}
                row={row}
                view={view}
                isPending={pendingId === row.client.id}
                onReactivate={(id) => void reactivate(id)}
                onSendReminder={(id, name) => void sendReminder(id, name)}
              />
            ))
          )}
        </TableBody>
      </LibraryTableShell>
    </div>
  )
}
