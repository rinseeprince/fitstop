"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle } from "lucide-react";

type RegenerationWarningDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modifiedCount: number;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading: boolean;
};

export function RegenerationWarningDialog({
  open,
  onOpenChange,
  modifiedCount,
  onConfirm,
  onCancel,
  isLoading,
}: RegenerationWarningDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-[rgba(192,96,96,0.08)] flex items-center justify-center">
              <AlertTriangle className="h-4 w-4 text-[#c06060]" />
            </div>
            <DialogTitle>Reset manually adjusted sessions?</DialogTitle>
          </div>
          <DialogDescription className="pt-2">
            You have <strong>{modifiedCount}</strong> manually adjusted{" "}
            {modifiedCount === 1 ? "session" : "sessions"} in the future.
            Regenerating will reset them to the template schedule.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Reset & Regenerate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
