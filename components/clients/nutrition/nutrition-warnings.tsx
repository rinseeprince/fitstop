import { AlertCircle } from "lucide-react";

type NutritionWarningsProps = {
  warnings: string[];
};

export function NutritionWarnings({ warnings }: NutritionWarningsProps) {
  if (warnings.length === 0) {
    return null;
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xs p-4 space-y-2">
      <div className="flex items-start gap-2">
        <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <p className="font-semibold text-amber-900 text-sm">
            Nutrition Plan Warnings
          </p>
          <ul className="space-y-1.5 text-sm text-amber-800">
            {warnings.map((warning, index) => (
              <li key={index} className="flex items-start gap-2">
                <span className="text-amber-600 mt-0.5">•</span>
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
