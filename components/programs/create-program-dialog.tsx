"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
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
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { DAYS_PER_WEEK } from "@/components/clients/training/program-builder/program-builder-types"

// Create-program modal: collects the program's identity up front (name, an
// optional free-text focus, default surplus %, description) and only creates
// the plan on submit — clicking "+" no longer spawns an empty draft. On success
// it opens the builder pre-populated. The plan seeds one week of 7 rest days
// (empty === rest); the create schema can't express weeks/set specs — the
// builder writes the real structure through /overwrite on Save program.
export function CreateProgramDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [name, setName] = useState("")
  const [focus, setFocus] = useState("")
  const [surplus, setSurplus] = useState("")
  const [description, setDescription] = useState("")
  const [isCreating, setIsCreating] = useState(false)

  // Reset the fields whenever the dialog re-opens.
  useEffect(() => {
    if (open) {
      setName("")
      setFocus("")
      setSurplus("")
      setDescription("")
    }
  }, [open])

  const handleCreate = async () => {
    const trimmedName = name.trim()
    if (!trimmedName) return
    setIsCreating(true)
    try {
      const surplusRaw = surplus.trim()
      const surplusNum = surplusRaw === "" ? null : Number(surplusRaw)
      const res = await fetch("/api/training/saved-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          splitType: focus.trim() || null,
          description: description.trim() || null,
          defaultSurplusPercentage:
            surplusNum != null && Number.isFinite(surplusNum)
              ? Math.min(100, Math.max(0, surplusNum))
              : null,
          sessions: Array.from({ length: DAYS_PER_WEEK }, () => ({
            name: "Rest",
            isRest: true,
            exercises: [],
          })),
        }),
      })
      const data = (await res.json()) as { planId?: string; error?: string }
      if (!res.ok || !data.planId) {
        throw new Error(data.error ?? "Failed to create program")
      }
      // Navigate straight into the builder; leave the spinner on through the
      // route change (the builder replaces this view).
      router.push(`/dashboard/programs/${data.planId}`)
    } catch {
      toast({
        title: "Error",
        description: "Failed to create program",
        variant: "destructive",
      })
      setIsCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New program</DialogTitle>
          <DialogDescription>
            Name your program and set its focus — you can start building right away.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="program-name">Name</Label>
            <Input
              id="program-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Push Pull Legs"
              maxLength={100}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="program-focus">Focus</Label>
            <Input
              id="program-focus"
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="e.g. Glute hypertrophy"
              maxLength={100}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="program-surplus">Calorie surplus %</Label>
            <Input
              id="program-surplus"
              type="number"
              min={0}
              max={100}
              value={surplus}
              onChange={(e) => setSurplus(e.target.value)}
              placeholder="Optional — applies to every training day"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="program-description">Description</Label>
            <Textarea
              id="program-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
              maxLength={500}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleCreate()}
            disabled={isCreating || !name.trim()}
            className="bg-[#0d9488] text-white hover:bg-[#0b7f75]"
          >
            {isCreating && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Create program
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
