"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SaveWeekDialogProps = {
  open: boolean;
  /** Prefill (plan name + week date) — re-seeded on every open. */
  defaultName: string;
  isSaving: boolean;
  onCancel: () => void;
  onSave: (name: string) => void;
};

// Save-a-calendar-week-to-the-library name dialog, extracted from the
// calendar view. The name input is keyed on open so each open re-seeds from
// the current default without a controlled-reset effect.
export function SaveWeekDialog({
  open,
  defaultName,
  isSaving,
  onCancel,
  onSave,
}: SaveWeekDialogProps) {
  const [name, setName] = useState(defaultName);
  // Render-phase reseed on open (not an effect): the first frame of a new
  // open must show the new default, never the previous open's edits.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const seedKey = open ? defaultName : null;
  if (seedKey !== seededFor) {
    setSeededFor(seedKey);
    if (seedKey != null) setName(seedKey);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !isSaving && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save week as plan</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5 py-1">
          <Label htmlFor="save-plan-name">Plan name</Label>
          <Input
            id="save-plan-name"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter plan name"
          />
          <p className="text-[11px] text-[#93b0b4]">
            Saves this week&apos;s sessions to your training library.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            className="bg-[#0d9488] text-white hover:bg-[#0b7f75]"
            disabled={isSaving || !name.trim()}
            onClick={() => onSave(name.trim())}
          >
            {isSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
