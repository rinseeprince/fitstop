"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ClipboardList, Edit } from "lucide-react";

type MetricSaveDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  metricName: string;
  onSaveAsCheckIn: () => void;
  onUpdateOnly: () => void;
  isLoading: boolean;
};

export function MetricSaveDialog({
  open,
  onOpenChange,
  metricName,
  onSaveAsCheckIn,
  onUpdateOnly,
  isLoading,
}: MetricSaveDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save {metricName}?</DialogTitle>
          <DialogDescription>
            Choose how to save this metric update
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-4">
          <button
            onClick={onSaveAsCheckIn}
            disabled={isLoading}
            className="flex flex-col gap-2 p-4 border-2 rounded-lg hover:border-primary hover:bg-accent transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-primary" />
              <span className="font-semibold">Save as Check-In</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Creates a new check-in entry with this value. This preserves your
              client&apos;s progress history and timeline.
            </p>
          </button>

          <button
            onClick={onUpdateOnly}
            disabled={isLoading}
            className="flex flex-col gap-2 p-4 border-2 rounded-lg hover:border-primary hover:bg-accent transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="flex items-center gap-2">
              <Edit className="h-5 w-5 text-primary" />
              <span className="font-semibold">Just Update Current Value</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Only updates the current metric without creating a check-in entry.
              Use this for corrections or quick adjustments.
            </p>
          </button>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
