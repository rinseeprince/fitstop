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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type CreateRoadmapDialogProps = {
  clientId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
};

export const CreateRoadmapDialog = ({
  clientId,
  open,
  onOpenChange,
  onSuccess,
}: CreateRoadmapDialogProps) => {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [longTermGoal, setLongTermGoal] = useState("");
  const [startedAt, setStartedAt] = useState("");
  const [targetEndDate, setTargetEndDate] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return;

    setIsSubmitting(true);
    try {
      const body: Record<string, string> = { name: name.trim() };
      if (longTermGoal.trim()) body.longTermGoal = longTermGoal.trim();
      if (startedAt) body.startedAt = startedAt;
      if (targetEndDate) body.targetEndDate = targetEndDate;

      const res = await fetch(`/api/clients/${clientId}/roadmap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create roadmap");
      }

      toast({ title: "Roadmap created" });

      // Reset form
      setName("");
      setLongTermGoal("");
      setStartedAt("");
      setTargetEndDate("");

      onSuccess();
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to create roadmap",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Build Roadmap</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="roadmap-name">Name</Label>
            <Input
              id="roadmap-name"
              placeholder="e.g., 12-Week Body Recomp"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="roadmap-goal">Long-term Goal (optional)</Label>
            <Textarea
              id="roadmap-goal"
              placeholder="What is the overarching goal for this client?"
              value={longTermGoal}
              onChange={(e) => setLongTermGoal(e.target.value)}
              rows={3}
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1 space-y-2">
              <Label htmlFor="roadmap-start">Start Date</Label>
              <Input
                id="roadmap-start"
                type="date"
                value={startedAt}
                onChange={(e) => setStartedAt(e.target.value)}
              />
            </div>
            <div className="flex-1 space-y-2">
              <Label htmlFor="roadmap-end">Target End Date</Label>
              <Input
                id="roadmap-end"
                type="date"
                value={targetEndDate}
                onChange={(e) => setTargetEndDate(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!name.trim() || isSubmitting}
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Create Roadmap
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
