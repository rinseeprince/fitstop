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
      <div className="text-center pb-6">
        <div className="text-4xl font-bold text-primary">
          {client.calorieTarget.toLocaleString()}
        </div>
        <div className="text-sm text-muted-foreground mt-1">
          calories per day
        </div>
        {client.customMacrosEnabled && (
          <div className="text-xs text-warning mt-2">Custom macros active</div>
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
              className="bg-primary h-2 rounded-full"
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
              className="bg-success h-2 rounded-full"
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
              className="bg-warning h-2 rounded-full"
              style={{ width: `${fatPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Macro Summary */}
      <div className="grid grid-cols-3 gap-4 pt-6">
        <div className="text-center bg-blue-50/50 rounded-xl p-4">
          <div className="text-2xl font-bold text-blue-600">{proteinG}g</div>
          <div className="text-xs text-gray-500 mt-1">Protein</div>
          <div className="text-xs text-gray-400">
            {proteinCal} cal
          </div>
        </div>
        <div className="text-center bg-green-50/50 rounded-xl p-4">
          <div className="text-2xl font-bold text-green-600">{carbG}g</div>
          <div className="text-xs text-gray-500 mt-1">Carbs</div>
          <div className="text-xs text-gray-400">{carbCal} cal</div>
        </div>
        <div className="text-center bg-amber-50/50 rounded-xl p-4">
          <div className="text-2xl font-bold text-amber-600">{fatG}g</div>
          <div className="text-xs text-gray-500 mt-1">Fat</div>
          <div className="text-xs text-gray-400">{fatCal} cal</div>
        </div>
      </div>
    </div>
  );
}
