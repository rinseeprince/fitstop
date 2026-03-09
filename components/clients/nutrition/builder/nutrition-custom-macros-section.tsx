"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, ChevronDown, ChevronUp } from "lucide-react";

type CustomMacros = {
  protein: number;
  carbs: number;
  fat: number;
  calories: number;
};

type NutritionCustomMacrosSectionProps = {
  customMacros: CustomMacros;
  setCustomMacros: (macros: CustomMacros) => void;
  validationError: string | null;
  showCustomMacros: boolean;
  setShowCustomMacros: (show: boolean) => void;
  onSaveCustom: () => void;
  isGenerating: boolean;
};

export function NutritionCustomMacrosSection({
  customMacros,
  setCustomMacros,
  validationError,
  showCustomMacros,
  setShowCustomMacros,
  onSaveCustom,
  isGenerating,
}: NutritionCustomMacrosSectionProps) {
  return (
    <div className="border-t border-border pt-4">
      <button
        onClick={() => setShowCustomMacros(!showCustomMacros)}
        className="flex items-center justify-between w-full text-sm font-medium text-foreground hover:text-foreground transition-colors"
      >
        <span>Advanced: Custom macros</span>
        {showCustomMacros ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {showCustomMacros && (
        <div className="mt-4 space-y-4 pl-4 border-l-2 border-primary/30">
          <p className="text-xs text-muted-foreground">
            Override calculated macros (applies same targets to all days)
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="custom-protein" className="text-xs font-medium text-foreground">
                Protein (g)
              </Label>
              <Input
                id="custom-protein"
                type="number"
                value={customMacros.protein}
                onChange={(e) =>
                  setCustomMacros({ ...customMacros, protein: parseInt(e.target.value) || 0 })
                }
                className="h-9 bg-card border-border rounded-lg focus:border-primary focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="custom-carbs" className="text-xs font-medium text-foreground">
                Carbs (g)
              </Label>
              <Input
                id="custom-carbs"
                type="number"
                value={customMacros.carbs}
                onChange={(e) =>
                  setCustomMacros({ ...customMacros, carbs: parseInt(e.target.value) || 0 })
                }
                className="h-9 bg-card border-border rounded-lg focus:border-primary focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="custom-fat" className="text-xs font-medium text-foreground">
                Fat (g)
              </Label>
              <Input
                id="custom-fat"
                type="number"
                value={customMacros.fat}
                onChange={(e) =>
                  setCustomMacros({ ...customMacros, fat: parseInt(e.target.value) || 0 })
                }
                className="h-9 bg-card border-border rounded-lg focus:border-primary focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="custom-calories" className="text-xs font-medium text-foreground">
                Calories
              </Label>
              <Input
                id="custom-calories"
                type="number"
                value={customMacros.calories}
                onChange={(e) =>
                  setCustomMacros({ ...customMacros, calories: parseInt(e.target.value) || 0 })
                }
                className="h-9 bg-card border-border rounded-lg focus:border-primary focus:ring-1 focus:ring-ring"
                placeholder={`~${customMacros.protein * 4 + customMacros.carbs * 4 + customMacros.fat * 9}`}
              />
            </div>
          </div>
          {validationError && (
            <div className="flex items-start gap-2 p-3 bg-warning/10 rounded-lg">
              <AlertCircle className="h-4 w-4 text-warning mt-0.5 flex-shrink-0" />
              <p className="text-xs text-foreground">{validationError}</p>
            </div>
          )}
          <Button
            onClick={onSaveCustom}
            disabled={isGenerating || !!validationError}
            size="sm"
            variant="outline"
            className="w-full bg-card border-border text-foreground hover:bg-muted hover:border-border font-medium rounded-lg transition-all"
          >
            Save Custom Macros
          </Button>
        </div>
      )}
    </div>
  );
}
