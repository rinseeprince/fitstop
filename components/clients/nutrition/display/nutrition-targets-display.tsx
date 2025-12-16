import type { Client } from "@/types/check-in";
import { getProteinTargetLabel } from "@/utils/nutrition-helpers";

type NutritionTargetsDisplayProps = {
  client: Client;
};

export function NutritionTargetsDisplay({
  client,
}: NutritionTargetsDisplayProps) {
  if (!client.calorieTarget) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>No nutrition plan generated yet</p>
        <p className="text-sm mt-2">
          Configure settings below and generate a plan
        </p>
      </div>
    );
  }

  // Use custom macros if enabled, otherwise use calculated
  const proteinG = client.customMacrosEnabled
    ? client.customProteinG!
    : client.proteinTargetG!;
  const carbG = client.customMacrosEnabled
    ? client.customCarbG!
    : client.carbTargetG!;
  const fatG = client.customMacrosEnabled
    ? client.customFatG!
    : client.fatTargetG!;

  // Calculate percentages
  const proteinCal = proteinG * 4;
  const carbCal = carbG * 4;
  const fatCal = fatG * 9;
  const totalCal = proteinCal + carbCal + fatCal;

  const proteinPct = Math.round((proteinCal / totalCal) * 100);
  const carbPct = Math.round((carbCal / totalCal) * 100);
  const fatPct = Math.round((fatCal / totalCal) * 100);

  const unitPreference = client.unitPreference || "imperial";

  return (
    <div className="space-y-6">
      {/* Calorie Target */}
      <div className="text-center border-b pb-4">
        <div className="text-5xl font-bold text-primary">
          {client.calorieTarget.toLocaleString()}
        </div>
        <div className="text-sm text-muted-foreground mt-1">
          calories per day
        </div>
        {client.customMacrosEnabled && (
          <div className="text-xs text-amber-600 mt-2">Custom macros active</div>
        )}
      </div>

      {/* Macro Breakdown */}
      <div className="space-y-4">
        {/* Protein */}
        <div>
          <div className="flex justify-between items-baseline mb-2">
            <div>
              <span className="font-semibold text-lg">Protein</span>
              {!client.customMacrosEnabled && client.proteinTargetGPerKg && (
                <span className="text-xs text-muted-foreground ml-2">
                  {getProteinTargetLabel(
                    client.proteinTargetGPerKg,
                    unitPreference
                  )}
                </span>
              )}
            </div>
            <div className="text-right">
              <div className="font-semibold">{proteinG}g</div>
              <div className="text-xs text-muted-foreground">{proteinPct}%</div>
            </div>
          </div>
          <div className="w-full bg-secondary rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full"
              style={{ width: `${proteinPct}%` }}
            />
          </div>
        </div>

        {/* Carbs */}
        <div>
          <div className="flex justify-between items-baseline mb-2">
            <span className="font-semibold text-lg">Carbs</span>
            <div className="text-right">
              <div className="font-semibold">{carbG}g</div>
              <div className="text-xs text-muted-foreground">{carbPct}%</div>
            </div>
          </div>
          <div className="w-full bg-secondary rounded-full h-2">
            <div
              className="bg-green-500 h-2 rounded-full"
              style={{ width: `${carbPct}%` }}
            />
          </div>
        </div>

        {/* Fat */}
        <div>
          <div className="flex justify-between items-baseline mb-2">
            <span className="font-semibold text-lg">Fat</span>
            <div className="text-right">
              <div className="font-semibold">{fatG}g</div>
              <div className="text-xs text-muted-foreground">{fatPct}%</div>
            </div>
          </div>
          <div className="w-full bg-secondary rounded-full h-2">
            <div
              className="bg-amber-500 h-2 rounded-full"
              style={{ width: `${fatPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Macro Summary */}
      <div className="grid grid-cols-3 gap-4 pt-4 border-t">
        <div className="text-center">
          <div className="text-2xl font-bold text-blue-500">{proteinG}g</div>
          <div className="text-xs text-muted-foreground">Protein</div>
          <div className="text-xs text-muted-foreground">
            {proteinCal} cal
          </div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-green-500">{carbG}g</div>
          <div className="text-xs text-muted-foreground">Carbs</div>
          <div className="text-xs text-muted-foreground">{carbCal} cal</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-amber-500">{fatG}g</div>
          <div className="text-xs text-muted-foreground">Fat</div>
          <div className="text-xs text-muted-foreground">{fatCal} cal</div>
        </div>
      </div>
    </div>
  );
}
