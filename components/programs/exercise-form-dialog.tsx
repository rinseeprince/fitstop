"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import type { Exercise } from "@/types/training"

// One dialog for both create (exercise undefined — first UI caller of the
// existing POST /api/training/exercises) and edit (coach-owned rows only;
// PATCH). Fields mirror the catalog columns; category is a free string.
export function ExerciseFormDialog({
  open,
  onOpenChange,
  exercise,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  exercise?: Exercise | null
  onSaved: () => void
}) {
  const { toast } = useToast()
  const isEdit = exercise != null
  const [name, setName] = useState("")
  const [muscleGroup, setMuscleGroup] = useState("")
  const [equipment, setEquipment] = useState("")
  const [category, setCategory] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  // Re-seed the fields whenever the dialog opens on a different target.
  useEffect(() => {
    if (open) {
      setName(exercise?.name ?? "")
      setMuscleGroup(exercise?.muscleGroup ?? "")
      setEquipment(exercise?.equipment ?? "")
      setCategory(exercise?.category ?? "")
    }
  }, [open, exercise])

  const handleSave = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setIsSaving(true)
    try {
      const body = {
        name: trimmed,
        muscleGroup: muscleGroup.trim() || null,
        equipment: equipment.trim() || null,
        category: category.trim() || null,
      }
      const res = await fetch(
        isEdit ? `/api/training/exercises/${exercise.id}` : "/api/training/exercises",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      )
      if (!res.ok) throw new Error("Failed to save")
      toast({ title: isEdit ? "Exercise updated" : "Exercise created" })
      onSaved()
      onOpenChange(false)
    } catch {
      toast({
        title: "Error",
        description: isEdit ? "Failed to update exercise" : "Failed to create exercise",
        variant: "destructive",
      })
    } finally {
      setIsSaving(false)
    }
  }

  const field = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={id === "exercise-name" ? 200 : 100}
      />
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit exercise" : "New exercise"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Changes apply everywhere this exercise is referenced."
              : "A custom exercise for your catalog — taggable so it filters properly."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          {field("exercise-name", "Name", name, setName, "e.g. Barbell Back Squat")}
          {field("exercise-muscle", "Muscle group", muscleGroup, setMuscleGroup, "e.g. legs")}
          {field("exercise-equipment", "Equipment", equipment, setEquipment, "e.g. barbell")}
          {field("exercise-category", "Category", category, setCategory, "e.g. compound")}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={isSaving || !name.trim()}
            className="bg-[#0d9488] text-white hover:bg-[#0b7f75]"
          >
            {isSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {isEdit ? "Save changes" : "Create exercise"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
