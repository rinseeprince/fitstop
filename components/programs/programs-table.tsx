"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { mutate as globalMutate } from "swr"
import { Copy, LayoutGrid, Loader2, Plus, Trash2 } from "lucide-react"
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { MONO_CELL_CLASS } from "@/components/clients/training/program-builder/builder-tokens"
import { useSavedPlansPage } from "@/hooks/use-saved-plans-page"
import type { SavedPlanListItem } from "@/types/training"
import { LibrarySearchInput } from "./shared/library-search-input"
import { LibrarySortSelect } from "./shared/library-sort-select"
import { SegmentedControl } from "./shared/segmented-control"
import { SectionLabel } from "./shared/section-label"
import { LibraryTableShell, LIBRARY_PAGE_SIZE } from "./shared/library-table-shell"
import { RowActions } from "./shared/row-actions"
import { formatRelativeUpdated } from "./shared/format-relative"
import { CreateProgramDialog } from "./create-program-dialog"

type SortKey = "updated" | "name" | "longest"

const neutralChip =
  "border-transparent bg-[#f0f5f4] text-[11px] font-medium text-[#5a7d82]"

// Revalidate the stat-band summary after a create/duplicate/delete changes the
// plan set (its own SWR key, separate from the paginated list).
function refreshSummary() {
  void globalMutate(
    (key) =>
      typeof key === "string" && key.startsWith("/api/training/saved-plans/summary"),
  )
}

export function ProgramsTable() {
  const router = useRouter()
  const { toast } = useToast()

  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [segment, setSegment] = useState("all")
  const [sort, setSort] = useState<SortKey>("updated")
  const [page, setPage] = useState(0)
  const [deleteTarget, setDeleteTarget] = useState<SavedPlanListItem | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  // Debounce the search so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(t)
  }, [query])

  // A change to the effective search returns to the first page.
  useEffect(() => {
    setPage(0)
  }, [debouncedQuery])

  const { plans, total, isLoading, mutate } = useSavedPlansPage({
    page,
    pageSize: LIBRARY_PAGE_SIZE,
    search: debouncedQuery,
    segment,
    sort,
  })

  const pageCount = Math.max(1, Math.ceil(total / LIBRARY_PAGE_SIZE))
  const clampedPage = Math.min(page, pageCount - 1)

  // Clamp back into range if a delete shrinks the list below the current page.
  useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1)
  }, [page, pageCount])

  const handleDuplicate = async (plan: SavedPlanListItem) => {
    try {
      const res = await fetch(`/api/training/saved-plans/${plan.id}/duplicate`, {
        method: "POST",
      })
      if (!res.ok) throw new Error("Failed to duplicate")
      toast({ title: "Program duplicated" })
      await mutate()
      refreshSummary()
    } catch {
      toast({
        title: "Error",
        description: "Failed to duplicate program",
        variant: "destructive",
      })
    }
  }

  const handleDelete = async (plan: SavedPlanListItem) => {
    try {
      const res = await fetch(`/api/training/saved-plans/${plan.id}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error("Failed to delete")
      toast({ title: "Program deleted" })
      await mutate()
      refreshSummary()
    } catch {
      toast({
        title: "Error",
        description: "Failed to delete program",
        variant: "destructive",
      })
    }
  }

  if (isLoading && plans.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-[#93b0b4]" />
      </div>
    )
  }

  // Genuinely-empty library (no filters) gets the full-page prompt; a
  // filtered-to-zero result keeps the toolbar so the coach can clear filters.
  if (total === 0 && !debouncedQuery && segment === "all") {
    return (
      <>
        <div className="py-12 text-center text-[#5a7d82]">
          <LayoutGrid className="mx-auto mb-2 h-8 w-8 opacity-50" strokeWidth={1.5} />
          <p className="text-sm">No programs yet</p>
          <p className="mt-1 text-xs text-[#93b0b4]">
            Create a program and build it week by week
          </p>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-[6px] bg-[#0d9488] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#0b7f75]"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} /> New program
          </button>
        </div>
        <CreateProgramDialog open={createOpen} onOpenChange={setCreateOpen} />
      </>
    )
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <LibrarySearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search programs"
        />
        <SegmentedControl
          options={[
            { value: "all", label: "All" },
            { value: "custom", label: "Custom" },
            { value: "ai", label: "AI generated" },
          ]}
          value={segment}
          onChange={(v) => {
            setSegment(v)
            setPage(0)
          }}
        />
        <div className="flex-1" />
        <LibrarySortSelect
          options={[
            { value: "updated", label: "Recently updated" },
            { value: "name", label: "Name A–Z" },
            { value: "longest", label: "Longest first" },
          ]}
          value={sort}
          ariaLabel="Sort programs"
          onChange={(v) => {
            setSort(v as SortKey)
            setPage(0)
          }}
        />
      </div>

      <SectionLabel
        label="Program library"
        actions={
          <button
            type="button"
            aria-label="New program"
            title="New program"
            className="rounded p-1 text-[#93b0b4] transition-colors hover:text-[#0d9488]"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        }
      />

      <LibraryTableShell
        shown={plans.length}
        total={total}
        noun="programs"
        page={clampedPage}
        pageCount={pageCount}
        onPageChange={setPage}
      >
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[34%] pl-5">Program</TableHead>
            <TableHead>Focus</TableHead>
            <TableHead>Length</TableHead>
            <TableHead>Sessions/wk</TableHead>
            <TableHead>Schedule</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead className="w-[90px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {plans.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="py-8 text-center text-[#93b0b4]">
                No programs match your filters
              </TableCell>
            </TableRow>
          ) : (
            plans.map((plan) => (
              <TableRow
                key={plan.id}
                className="group/row cursor-pointer"
                onClick={() => router.push(`/dashboard/programs/${plan.id}`)}
              >
                <TableCell className="pl-5">
                  <div className="flex items-center gap-2">
                    <span className="text-[13.5px] font-semibold text-[#0c1a1e]">
                      {plan.name}
                    </span>
                    {plan.status === "draft" && (
                      <Badge
                        variant="outline"
                        className="border-[rgba(13,148,136,0.12)] text-[10px] text-[#5a7d82]"
                      >
                        Draft
                      </Badge>
                    )}
                  </div>
                  {plan.description && (
                    <p className="mt-0.5 max-w-[380px] truncate text-xs text-[#93b0b4]">
                      {plan.description}
                    </p>
                  )}
                </TableCell>
                <TableCell>
                  {plan.splitType ? (
                    <Badge className={neutralChip}>
                      {plan.splitType.replace(/_/g, " ")}
                    </Badge>
                  ) : (
                    <span className="text-[#93b0b4]">—</span>
                  )}
                </TableCell>
                <TableCell className={cn(MONO_CELL_CLASS, "text-[#5a7d82]")}>
                  {plan.weekCount} {plan.weekCount === 1 ? "week" : "weeks"}
                </TableCell>
                <TableCell className={cn(MONO_CELL_CLASS, "text-[#5a7d82]")}>
                  {plan.frequencyPerWeek ?? "—"}
                </TableCell>
                <TableCell className={cn(MONO_CELL_CLASS, "text-[#93b0b4]")}>
                  {plan.totalSlots} slots · {plan.restCount} rest
                </TableCell>
                <TableCell className={cn(MONO_CELL_CLASS, "text-[#93b0b4]")}>
                  {formatRelativeUpdated(plan.updatedAt)}
                </TableCell>
                <TableCell>
                  <RowActions
                    actions={[
                      {
                        label: "Duplicate",
                        icon: Copy,
                        onClick: () => void handleDuplicate(plan),
                      },
                      {
                        label: "Delete",
                        icon: Trash2,
                        danger: true,
                        onClick: () => setDeleteTarget(plan),
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
        title="Delete this program?"
        description={`"${deleteTarget?.name ?? ""}" and everything in it will be permanently removed from your library. Clients it was already applied to keep their calendars.`}
        confirmLabel="Delete program"
        destructive
        onConfirm={() => {
          if (deleteTarget) void handleDelete(deleteTarget)
          setDeleteTarget(null)
        }}
      />

      <CreateProgramDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
