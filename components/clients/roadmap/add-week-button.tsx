"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Plus, Loader2 } from "lucide-react";

interface AddWeekButtonProps {
  clientId: string;
  roadmapId: string;
  phaseId: string;
  nextWeekNumber: number;
  onSuccess: (weekId: string) => void;
}

export function AddWeekButton({
  clientId,
  roadmapId,
  phaseId,
  nextWeekNumber,
  onSuccess,
}: AddWeekButtonProps) {
  const { toast } = useToast();
  const [isAdding, setIsAdding] = useState(false);

  const handleAdd = async () => {
    setIsAdding(true);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/roadmaps/${roadmapId}/phases/${phaseId}/weeks`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ weekNumber: nextWeekNumber }),
        }
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to add week");
      }

      const { data } = await res.json();
      toast({ title: `Week ${nextWeekNumber} added` });
      onSuccess(data.id);
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to add week",
        variant: "destructive",
      });
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleAdd}
      disabled={isAdding}
      className="shrink-0"
    >
      {isAdding ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Plus className="h-4 w-4" />
      )}
    </Button>
  );
}
