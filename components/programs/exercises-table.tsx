"use client"

import { useMemo, useState } from "react"
import { BookOpen, Dumbbell, Loader2, Pencil, Plus, Trash2 } from "lucide-react"
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
import { useExerciseCatalog } from "@/hooks/use-exercise-catalog"
import { useExerciseUsage } from "@/hooks/use-exercise-usage"
import type { Exercise } from "@/types/training"
import { LibrarySearchInput } from "./shared/library-search-input"
import { FilterChips } from "./shared/filter-chips"
import { SectionLabel } from "./shared/section-label"
import { LibraryTableShell, LIBRARY_PAGE_SIZE } from "./shared/library-table-shell"
import { RowActions } from "./shared/row-actions"

const neutralChip =
  "border-transparent bg-[#f0f5f4] text-[11px] font-medium text-[#5a7d82]"
const tinyChip =
  "border-transparent bg-[#f0f5f4] text-[10px] font-medium text-[#5a7d82]"

// Exercise catalog table. Edit/Delete only on coach-owned rows (global rows
// render no actions — ownership model forbids it). No Video column: the
// catalog has no video field (videos live per-prescription).
export function ExercisesTable({
  onEditExercise,
  onCreate,
}: {
  onEditExercise: (exercise: Exercise) => void
  onCreate?: () => void
}) {
  const { toast } = useToast()
  const { exercises, isLoading, mutate } = useExerciseCatalog()
  const { usageByExercise } = useExerciseUsage()

  const [query, setQuery] = useState("")
  const [muscleFilter, setMuscleFilter] = useState("all")
  const [equipmentFilter, setEquipmentFilter] = useState("all")
  const [page, setPage] = useState(0)
  const [deleteTarget, setDeleteTarget] = useState<Exercise | null>(null)

  const muscleOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of exercises) {
      const m = e.muscleGroup?.trim().toLowerCase()
      if (!m) continue
      counts.set(m, (counts.get(m) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([value]) => value)
  }, [exercises])

  const equipmentOptions = useMemo(() => {
    const values = new Set<string>()
    for (const e of exercises) {
      const eq = e.equipment?.trim().toLowerCase()
      if (eq) values.add(eq)
    }
    return [...values].sort()
  }, [exercises])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return exercises.filter((e) => {
      if (
        muscleFilter !== "all" &&
        e.muscleGroup?.trim().toLowerCase() !== muscleFilter
      )
        return false
      if (
        equipmentFilter !== "all" &&
        e.equipment?.trim().toLowerCase() !== equipmentFilter
      )
        return false
      if (!q) return true
      return (
        e.name.toLowerCase().includes(q) ||
        e.aliases.some((a) => a.toLowerCase().includes(q))
      )
    })
  }, [exercises, query, muscleFilter, equipmentFilter])

  const pageCount = Math.max(1, Math.ceil(filtered.length / LIBRARY_PAGE_SIZE))
  const clampedPage = Math.min(page, pageCount - 1)
  const pageRows = filtered.slice(
    clampedPage * LIBRARY_PAGE_SIZE,
    (clampedPage + 1) * LIBRARY_PAGE_SIZE,
  )

  const handleDelete = async (exercise: Exercise) => {
    try {
      const res = await fetch(`/api/training/exercises/${exercise.id}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error("Failed to delete")
      toast({ title: "Exercise deleted" })
      await mutate()
    } catch {
      toast({
        title: "Error",
        description: "Failed to delete exercise",
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

  if (exercises.length === 0) {
    return (
      <div className="py-12 text-center text-[#5a7d82]">
        <BookOpen className="mx-auto mb-2 h-8 w-8 opacity-50" strokeWidth={1.5} />
        <p className="text-sm">No exercises yet</p>
      </div>
    )
  }

  const deleteUsage = deleteTarget
    ? (usageByExercise.get(deleteTarget.id) ?? 0)
    : 0

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <LibrarySearchInput
          value={query}
          onChange={(v) => {
            setQuery(v)
            setPage(0)
          }}
          placeholder="Search exercises"
        />
        {muscleOptions.length > 0 && (
          <FilterChips
            options={muscleOptions}
            value={muscleFilter}
            onChange={(v) => {
              setMuscleFilter(v)
              setPage(0)
            }}
          />
        )}
        <div className="flex-1" />
        <Select
          value={equipmentFilter}
          onValueChange={(v) => {
            setEquipmentFilter(v)
            setPage(0)
          }}
        >
          <SelectTrigger className="h-9 w-[170px] text-[13px] capitalize">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All equipment</SelectItem>
            {equipmentOptions.map((eq) => (
              <SelectItem key={eq} value={eq} className="capitalize">
                {eq}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <SectionLabel
        label="Exercise library"
        actions={
          onCreate && (
            <button
              type="button"
              aria-label="New exercise"
              title="New exercise"
              className="rounded p-1 text-[#93b0b4] transition-colors hover:text-[#0d9488]"
              onClick={onCreate}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          )
        }
      />

      <LibraryTableShell
        shown={filtered.length}
        total={exercises.length}
        noun="exercises"
        page={clampedPage}
        pageCount={pageCount}
        onPageChange={setPage}
      >
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[32%] pl-5">Exercise</TableHead>
            <TableHead>Muscle group</TableHead>
            <TableHead>Equipment</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Used in</TableHead>
            <TableHead className="w-[90px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-[#93b0b4]">
                No exercises match your filters
              </TableCell>
            </TableRow>
          ) : (
            pageRows.map((exercise) => {
              const isCustom = exercise.coachId != null
              const usedIn = usageByExercise.get(exercise.id)
              return (
                <TableRow key={exercise.id} className="group/row">
                  <TableCell className="pl-5">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[rgba(13,148,136,0.05)] text-[#0d9488]">
                        <Dumbbell className="h-4 w-4" strokeWidth={1.5} />
                      </div>
                      <span className="text-[13.5px] font-semibold text-[#0c1a1e]">
                        {exercise.name}
                      </span>
                      {isCustom && <Badge className={tinyChip}>custom</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    {exercise.muscleGroup ? (
                      <Badge className={`${neutralChip} capitalize`}>
                        {exercise.muscleGroup}
                      </Badge>
                    ) : (
                      <span className="text-[#93b0b4]">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-[13px] capitalize text-[#5a7d82]">
                    {exercise.equipment ?? <span className="text-[#93b0b4]">—</span>}
                  </TableCell>
                  <TableCell>
                    {exercise.category ? (
                      <Badge className={`${neutralChip} capitalize`}>
                        {exercise.category}
                      </Badge>
                    ) : (
                      <span className="text-[#93b0b4]">—</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono-display text-[12.5px] text-[#5a7d82]">
                    {usedIn ? (
                      `${usedIn} session${usedIn === 1 ? "" : "s"}`
                    ) : (
                      <span className="text-[#93b0b4]">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {isCustom && (
                      <RowActions
                        actions={[
                          {
                            label: "Edit",
                            icon: Pencil,
                            onClick: () => onEditExercise(exercise),
                          },
                          {
                            label: "Delete",
                            icon: Trash2,
                            danger: true,
                            onClick: () => setDeleteTarget(exercise),
                          },
                        ]}
                      />
                    )}
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
        title="Delete this exercise?"
        description={
          deleteUsage > 0
            ? `"${deleteTarget?.name ?? ""}" is used in ${deleteUsage} session${deleteUsage === 1 ? "" : "s"}. Those prescriptions keep the exercise name but lose the catalog link (and its analytics grouping).`
            : `"${deleteTarget?.name ?? ""}" will be removed from your catalog.`
        }
        confirmLabel="Delete exercise"
        destructive
        onConfirm={() => {
          if (deleteTarget) void handleDelete(deleteTarget)
          setDeleteTarget(null)
        }}
      />
    </div>
  )
}
