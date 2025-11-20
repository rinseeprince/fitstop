"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { NutritionPlanHistory, UnitPreference } from "@/types/check-in";
import { formatWeight } from "@/utils/nutrition-helpers";
import { format } from "date-fns";
import { History, TrendingDown, TrendingUp } from "lucide-react";

type NutritionPlanHistoryModalProps = {
  clientId: string;
  unitPreference: UnitPreference;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function NutritionPlanHistoryModal({
  clientId,
  unitPreference,
  open,
  onOpenChange,
}: NutritionPlanHistoryModalProps) {
  const [history, setHistory] = useState<NutritionPlanHistory[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (open && clientId) {
      fetchHistory();
    }
  }, [open, clientId]);

  const fetchHistory = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/nutrition/history`);
      const data = await res.json();

      if (data.success) {
        setHistory(data.history || []);
      }
    } catch (error) {
      console.error("Failed to fetch nutrition history:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const getReasonBadge = (reason?: string) => {
    switch (reason) {
      case "initial":
        return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Initial Plan</Badge>;
      case "regenerated":
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Regenerated</Badge>;
      case "weight_change":
        return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Weight Change</Badge>;
      case "custom_macros":
        return <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">Custom Macros</Badge>;
      default:
        return <Badge variant="outline">Updated</Badge>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Nutrition Plan History
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-muted-foreground">Loading history...</div>
          </div>
        ) : history.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <History className="h-12 w-12 mb-3 opacity-20" />
            <p>No nutrition plan history yet</p>
            <p className="text-sm mt-1">History will appear after regenerating plans</p>
          </div>
        ) : (
          <div className="space-y-4">
            {history.map((entry, index) => {
              const isLatest = index === 0;
              const previousEntry = index < history.length - 1 ? history[index + 1] : null;

              return (
                <div
                  key={entry.id}
                  className={`border rounded-xs p-4 ${
                    isLatest ? "border-primary bg-primary/5" : ""
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {format(new Date(entry.createdAt), "MMM d, yyyy 'at' h:mm a")}
                      </span>
                      {isLatest && (
                        <Badge className="bg-primary">Current</Badge>
                      )}
                      {entry.regenerationReason && getReasonBadge(entry.regenerationReason)}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Weight: {formatWeight(entry.baseWeightKg, unitPreference)}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-3">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Calories</p>
                      <p className="text-lg font-semibold">
                        {entry.calorieTarget}
                        {previousEntry && (
                          <span className={`text-xs ml-1 ${
                            entry.calorieTarget > previousEntry.calorieTarget
                              ? "text-green-600"
                              : entry.calorieTarget < previousEntry.calorieTarget
                              ? "text-red-600"
                              : "text-muted-foreground"
                          }`}>
                            {entry.calorieTarget > previousEntry.calorieTarget && (
                              <TrendingUp className="inline h-3 w-3" />
                            )}
                            {entry.calorieTarget < previousEntry.calorieTarget && (
                              <TrendingDown className="inline h-3 w-3" />
                            )}
                            {entry.calorieTarget !== previousEntry.calorieTarget &&
                              ` ${Math.abs(entry.calorieTarget - previousEntry.calorieTarget)}`}
                          </span>
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Protein</p>
                      <p className="text-lg font-semibold text-blue-600">
                        {entry.proteinTargetG}g
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Carbs</p>
                      <p className="text-lg font-semibold text-green-600">
                        {entry.carbTargetG}g
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Fat</p>
                      <p className="text-lg font-semibold text-amber-600">
                        {entry.fatTargetG}g
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground pt-2 border-t">
                    <div>
                      <span className="font-medium">Activity:</span>{" "}
                      {entry.workActivityLevel.replace("_", " ")}
                    </div>
                    <div>
                      <span className="font-medium">Training:</span>{" "}
                      {entry.trainingVolumeHours} hrs/week
                    </div>
                    <div>
                      <span className="font-medium">Protein:</span>{" "}
                      {entry.proteinTargetGPerKg}g/kg
                    </div>
                    <div>
                      <span className="font-medium">Diet Type:</span>{" "}
                      {entry.dietType.replace("_", " ")}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex justify-end pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
