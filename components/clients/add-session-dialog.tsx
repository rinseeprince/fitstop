"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

type AddSessionDialogProps = {
  clientId: string;
  planId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
};

const DAYS_OF_WEEK = [
  { value: "monday", label: "Monday" },
  { value: "tuesday", label: "Tuesday" },
  { value: "wednesday", label: "Wednesday" },
  { value: "thursday", label: "Thursday" },
  { value: "friday", label: "Friday" },
  { value: "saturday", label: "Saturday" },
  { value: "sunday", label: "Sunday" },
];

export function AddSessionDialog({
  clientId,
  planId,
  open,
  onOpenChange,
  onSuccess,
}: AddSessionDialogProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    dayOfWeek: "",
    focus: "",
    notes: "",
    estimatedDurationMinutes: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast({
        title: "Session name required",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/training/${planId}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          dayOfWeek: formData.dayOfWeek || undefined,
          focus: formData.focus || undefined,
          notes: formData.notes || undefined,
          estimatedDurationMinutes: formData.estimatedDurationMinutes
            ? parseInt(formData.estimatedDurationMinutes)
            : undefined,
        }),
      });

      if (!res.ok) throw new Error("Failed to add session");

      toast({ title: "Session added" });
      setFormData({ name: "", dayOfWeek: "", focus: "", notes: "", estimatedDurationMinutes: "" });
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to add session",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Training Session</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="session-name">Session Name *</Label>
            <Input
              id="session-name"
              placeholder="e.g., Push Day A, Upper Body"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Day of Week</Label>
              <Select
                value={formData.dayOfWeek}
                onValueChange={(value) => setFormData({ ...formData, dayOfWeek: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Optional" />
                </SelectTrigger>
                <SelectContent>
                  {DAYS_OF_WEEK.map((day) => (
                    <SelectItem key={day.value} value={day.value}>
                      {day.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="duration">Duration (minutes)</Label>
              <Input
                id="duration"
                type="number"
                placeholder="e.g., 60"
                min={10}
                max={180}
                value={formData.estimatedDurationMinutes}
                onChange={(e) =>
                  setFormData({ ...formData, estimatedDurationMinutes: e.target.value })
                }
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="focus">Focus / Target</Label>
            <Input
              id="focus"
              placeholder="e.g., Chest, Shoulders, Triceps"
              value={formData.focus}
              onChange={(e) => setFormData({ ...formData, focus: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Any additional notes for this session..."
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Add Session
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
