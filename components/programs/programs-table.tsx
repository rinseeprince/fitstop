"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Copy, LayoutGrid, Loader2, Trash2 } from "lucide-react"
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
import { useSavedPlans } from "@/hooks/use-saved-plans"
import type { SavedPlan } from "@/types/training"
import { LibrarySearchInput } from "./shared/library-search-input"
import { SegmentedControl } from "./shared/segmented-control"
import { SectionLabel } from "./shared/section-label"
import { LibraryTableShell, LIBRARY_PAGE_SIZE } from "./shared/library-table-shell"
import { RowActions } from "./shared/row-actions"
import { formatRelativeUpdated } from "./shared/format-relative"
import {
  getPerWeek,
  getRestCount,
  getTotalSlots,
  getWeekCount,
} from "./shared/derive-plan-stats"

type SortKey = "updated" | "name" | "longest"

const neutralChip =
  "border-transparent bg-[#f0f5f4] text-[11px] font-medium text-[#5a7d82]"
const tealChip =
  "border-transparent bg-[rgba(13,148,136,0.08)] text-[11px] font-medium text-[#0d9488]"

export function ProgramsTable() {
  const router = useRouter()
  const { toast } = useToast()
  const { plans, isLoading, mutate } = useSavedPlans({ includeDrafts: true })

  const [query, setQuery] = useState("")
  const [segment, setSegment] = useState("all")
  const [sort, setSort] = useState<SortKey>("updated")
  const [page, setPage] = useState(0)
  const [deleteTarget, setDeleteTarget] = useState<SavedPlan | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = plans.filter((plan) => {
      if (segment === "ai" && plan.source !== "ai") return false
      if (segment === "custom" && plan.source === "ai") return false
      if (!q) return true
      return (
        plan.name.toLowerCase().includes(q) ||
        (plan.description ?? "").toLowerCase().includes(q)
      )
    })
    const sorted = [...rows]
    if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name))
    else if (sort === "longest")
      sorted.sort((a, b) => getWeekCount(b) - getWeekCount(a))
    else
      sorted.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
    return sorted
  }, [plans, query, segment, sort])

  const pageCount = Math.max(1, Math.ceil(filtered.length / LIBRARY_PAGE_SIZE))
  const clampedPage = Math.min(page, pageCount - 1)
  const pageRows = filtered.slice(
    clampedPage * LIBRARY_PAGE_SIZE,
    (clampedPage + 1) * LIBRARY_PAGE_SIZE,
  )

  const resetPage = () => setPage(0)

  const handleDuplicate = async (plan: SavedPlan) => {
    try {
      const res = await fetch(`/api/training/saved-plans/${plan.id}/duplicate`, {
        method: "POST",
      })
      if (!res.ok) throw new Error("Failed to duplicate")
      toast({ title: "Program duplicated" })
      await mutate()
    } catch {
      toast({
        title: "Error",
        description: "Failed to duplicate program",
        variant: "destructive",
      })
    }
  }

  const handleDelete = async (plan: SavedPlan) => {
    try {
      const res = await fetch(`/api/training/saved-plans/${plan.id}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error("Failed to delete")
      toast({ title: "Program deleted" })
      await mutate()
    } catch {
      toast({
        title: "Error",
        description: "Failed to delete program",
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

  if (plans.length === 0) {
    return (
      <div className="py-12 text-center text-[#5a7d82]">
        <LayoutGrid className="mx-auto mb-2 h-8 w-8 opacity-50" strokeWidth={1.5} />
        <p className="text-sm">No programs yet</p>
        <p className="mt-1 text-xs text-[#93b0b4]">
          Create a program and build it week by week
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
            resetPage()
          }}
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
            resetPage()
          }}
        />
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

      <SectionLabel label="Program library" />

      <LibraryTableShell
        shown={filtered.length}
        total={plans.length}
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
            <TableHead>Type</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead className="w-[90px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="py-8 text-center text-[#93b0b4]">
                No programs match your filters
              </TableCell>
            </TableRow>
          ) : (
            pageRows.map((plan) => {
              const weeks = getWeekCount(plan)
              return (
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
                  <TableCell className="font-mono-display text-[12.5px] text-[#5a7d82]">
                    {weeks} {weeks === 1 ? "week" : "weeks"}
                  </TableCell>
                  <TableCell className="font-mono-display text-[12.5px] text-[#5a7d82]">
                    {plan.frequencyPerWeek ?? getPerWeek(plan)}
                  </TableCell>
                  <TableCell className="font-mono-display text-[12.5px] text-[#93b0b4]">
                    {getTotalSlots(plan)} slots · {getRestCount(plan)} rest
                  </TableCell>
                  <TableCell>
                    <Badge className={plan.source === "ai" ? tealChip : neutralChip}>
                      {plan.source === "ai" ? "ai" : "custom"}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono-display text-[12.5px] text-[#93b0b4]">
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
              )
            })
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
    </div>
  )
}
