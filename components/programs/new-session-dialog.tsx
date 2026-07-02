"use client"

import { useState } from "react"
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

// Creates an empty standalone session (name + focus only — exercises are
// authored later; the builder's create-blank slide-over is the full-fat
// path). Controlled so the page can open it from the topbar's ?new=1.
export function NewSessionDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const { toast } = useToast()
  const [name, setName] = useState("")
  const [focus, setFocus] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  const reset = () => {
    setName("")
    setFocus("")
  }

  const handleCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setIsSaving(true)
    try {
      const res = await fetch("/api/training/saved-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          ...(focus.trim() ? { focus: focus.trim() } : {}),
          exercises: [],
        }),
      })
      if (!res.ok) throw new Error("Failed to create session")
      toast({ title: "Session created" })
      onCreated()
      onOpenChange(false)
      reset()
    } catch {
      toast({
        title: "Error",
        description: "Failed to create session",
        variant: "destructive",
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New session</DialogTitle>
          <DialogDescription>
            A reusable session for your library. Add exercises from the
            program builder.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="new-session-name">Session name</Label>
            <Input
              id="new-session-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Push Day A"
              maxLength={100}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-session-focus">Focus</Label>
            <Input
              id="new-session-focus"
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="e.g. push, legs, full body"
              maxLength={100}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleCreate()}
            disabled={isSaving || !name.trim()}
            className="bg-[#0d9488] text-white hover:bg-[#0b7f75]"
          >
            {isSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Create session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
