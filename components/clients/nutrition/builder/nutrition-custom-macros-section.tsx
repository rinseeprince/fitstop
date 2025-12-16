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
    <div className="border-t pt-4">
      <button
        onClick={() => setShowCustomMacros(!showCustomMacros)}
        className="flex items-center justify-between w-full text-sm font-medium hover:text-primary transition-colors"
      >
        <span>Advanced: Custom macros</span>
        {showCustomMacros ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {showCustomMacros && (
        <div className="mt-3 space-y-3 pl-3 border-l-2">
          <p className="text-xs text-muted-foreground">
            Override calculated macros (applies same targets to all days)
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="custom-protein" className="text-xs">
                Protein (g)
              </Label>
              <Input
                id="custom-protein"
                type="number"
                value={customMacros.protein}
                onChange={(e) =>
                  setCustomMacros({ ...customMacros, protein: parseInt(e.target.value) || 0 })
                }
                className="mt-1 h-8"
              />
            </div>
            <div>
              <Label htmlFor="custom-carbs" className="text-xs">
                Carbs (g)
              </Label>
              <Input
                id="custom-carbs"
                type="number"
                value={customMacros.carbs}
                onChange={(e) =>
                  setCustomMacros({ ...customMacros, carbs: parseInt(e.target.value) || 0 })
                }
                className="mt-1 h-8"
              />
            </div>
            <div>
              <Label htmlFor="custom-fat" className="text-xs">
                Fat (g)
              </Label>
              <Input
                id="custom-fat"
                type="number"
                value={customMacros.fat}
                onChange={(e) =>
                  setCustomMacros({ ...customMacros, fat: parseInt(e.target.value) || 0 })
                }
                className="mt-1 h-8"
              />
            </div>
            <div>
              <Label htmlFor="custom-calories" className="text-xs">
                Calories
              </Label>
              <Input
                id="custom-calories"
                type="number"
                value={customMacros.calories}
                onChange={(e) =>
                  setCustomMacros({ ...customMacros, calories: parseInt(e.target.value) || 0 })
                }
                className="mt-1 h-8"
                placeholder={`~${customMacros.protein * 4 + customMacros.carbs * 4 + customMacros.fat * 9}`}
              />
            </div>
          </div>
          {validationError && (
            <div className="flex items-start gap-2 p-2 bg-amber-50 border border-amber-200 rounded">
              <AlertCircle className="h-3 w-3 text-amber-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-800">{validationError}</p>
            </div>
          )}
          <Button
            onClick={onSaveCustom}
            disabled={isGenerating || !!validationError}
            size="sm"
            variant="outline"
            className="w-full"
          >
            Save Custom Macros
          </Button>
        </div>
      )}
    </div>
  );
}
