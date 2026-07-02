"use client"

import { useMemo, useState } from "react"
import { Copy, Dumbbell, Loader2, Trash2 } from "lucide-react"
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useToast } from "@/hooks/use-toast"
import { useStandaloneSessions } from "@/hooks/use-standalone-sessions"
import type { SavedSession } from "@/types/training"
import { LibrarySearchInput } from "./shared/library-search-input"
import { FilterChips } from "./shared/filter-chips"
import { SectionLabel } from "./shared/section-label"
import { LibraryTableShell, LIBRARY_PAGE_SIZE } from "./shared/library-table-shell"
import { RowActions } from "./shared/row-actions"
import { formatRelativeUpdated } from "./shared/format-relative"

type SortKey = "updated" | "name" | "longest"

const neutralChip =
  "border-transparent bg-[#f0f5f4] text-[11px] font-medium text-[#5a7d82]"

// Standalone-session library table. No "Used in" column: programs clone
// sessions by value, so there is no reference to count. No row click in v1 —
// standalone-session editing is exec-plan Phase 3 territory.
export function SessionsTable() {
  const { toast } = useToast()
  const { sessions, isLoading, mutate } = useStandaloneSessions()

  const [query, setQuery] = useState("")
  const [focusFilter, setFocusFilter] = useState("all")
  const [sort, setSort] = useState<SortKey>("updated")
  const [page, setPage] = useState(0)
  const [deleteTarget, setDeleteTarget] = useState<SavedSession | null>(null)

  // Top-6 focus values by frequency feed the filter chips.
  const focusOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const s of sessions) {
      const f = s.focus?.trim().toLowerCase()
      if (!f) continue
      counts.set(f, (counts.get(f) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([value]) => value)
  }, [sessions])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = sessions.filter((s) => {
      if (
        focusFilter !== "all" &&
        s.focus?.trim().toLowerCase() !== focusFilter
      )
        return false
      if (!q) return true
      return (
        s.name.toLowerCase().includes(q) ||
        (s.focus ?? "").toLowerCase().includes(q)
      )
    })
    const sorted = [...rows]
    if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name))
    else if (sort === "longest")
      sorted.sort(
        (a, b) =>
          (b.estimatedDurationMinutes ?? -1) - (a.estimatedDurationMinutes ?? -1),
      )
    else
      sorted.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
    return sorted
  }, [sessions, query, focusFilter, sort])

  const pageCount = Math.max(1, Math.ceil(filtered.length / LIBRARY_PAGE_SIZE))
  const clampedPage = Math.min(page, pageCount - 1)
  const pageRows = filtered.slice(
    clampedPage * LIBRARY_PAGE_SIZE,
    (clampedPage + 1) * LIBRARY_PAGE_SIZE,
  )

  const handleDuplicate = async (session: SavedSession) => {
    try {
      const res = await fetch(
        `/api/training/saved-sessions/${session.id}/duplicate`,
        { method: "POST" },
      )
      if (!res.ok) throw new Error("Failed to duplicate")
      toast({ title: "Session duplicated" })
      await mutate()
    } catch {
      toast({
        title: "Error",
        description: "Failed to duplicate session",
        variant: "destructive",
      })
    }
  }

  const handleDelete = async (session: SavedSession) => {
    try {
      const res = await fetch(`/api/training/saved-sessions/${session.id}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error("Failed to delete")
      toast({ title: "Session deleted" })
      await mutate()
    } catch {
      toast({
        title: "Error",
        description: "Failed to delete session",
        variant: "destructive",
      })
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-[#93b0b4]" />
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div className="py-12 text-center text-[#5a7d82]">
        <Dumbbell className="mx-auto mb-2 h-8 w-8 opacity-50" strokeWidth={1.5} />
        <p className="text-sm">No sessions yet</p>
        <p className="mt-1 text-xs text-[#93b0b4]">
          Create one here or save a session from the program builder
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <LibrarySearchInput
          value={query}
          onChange={(v) => {
            setQuery(v)
            setPage(0)
          }}
          placeholder="Search sessions"
        />
        {focusOptions.length > 0 && (
          <FilterChips
            options={focusOptions}
            value={focusFilter}
            onChange={(v) => {
              setFocusFilter(v)
              setPage(0)
            }}
          />
        )}
        <div className="flex-1" />
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="h-9 w-[180px] text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="updated">Recently updated</SelectItem>
            <SelectItem value="name">Name A–Z</SelectItem>
            <SelectItem value="longest">Longest first</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <SectionLabel label="Session library" />

      <LibraryTableShell
        shown={filtered.length}
        total={sessions.length}
        noun="sessions"
        page={clampedPage}
        pageCount={pageCount}
        onPageChange={setPage}
      >
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[38%] pl-5">Session</TableHead>
            <TableHead>Focus</TableHead>
            <TableHead>Exercises</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead className="w-[90px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-[#93b0b4]">
                No sessions match your filters
              </TableCell>
            </TableRow>
          ) : (
            pageRows.map((session) => (
              <TableRow key={session.id} className="group/row">
                <TableCell className="pl-5">
                  <span className="text-[13.5px] font-semibold text-[#0c1a1e]">
                    {session.name}
                  </span>
                </TableCell>
                <TableCell>
                  {session.focus ? (
                    <Badge className={neutralChip}>{session.focus}</Badge>
                  ) : (
                    <span className="text-[#93b0b4]">—</span>
                  )}
                </TableCell>
                <TableCell className="font-mono-display text-[12.5px] text-[#5a7d82]">
                  {session.exercises.length}
                </TableCell>
                <TableCell className="font-mono-display text-[12.5px] text-[#5a7d82]">
                  {session.estimatedDurationMinutes != null ? (
                    `${session.estimatedDurationMinutes} min`
                  ) : (
                    <span className="text-[#93b0b4]">—</span>
                  )}
                </TableCell>
                <TableCell className="font-mono-display text-[12.5px] text-[#93b0b4]">
                  {formatRelativeUpdated(session.updatedAt)}
                </TableCell>
                <TableCell>
                  <RowActions
                    actions={[
                      {
                        label: "Duplicate",
                        icon: Copy,
                        onClick: () => void handleDuplicate(session),
                      },
                      {
                        label: "Delete",
                        icon: Trash2,
                        danger: true,
                        onClick: () => setDeleteTarget(session),
                      },
                    ]}
                  />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </LibraryTableShell>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title="Delete this session?"
        description={`"${deleteTarget?.name ?? ""}" will be removed from your session library. Programs that already contain a copy of it are unaffected.`}
        confirmLabel="Delete session"
        destructive
        onConfirm={() => {
          if (deleteTarget) void handleDelete(deleteTarget)
          setDeleteTarget(null)
        }}
      />
    </div>
  )
}
