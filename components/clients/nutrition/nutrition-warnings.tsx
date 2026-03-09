import { AlertCircle } from "lucide-react";

type NutritionWarningsProps = {
  warnings: string[];
};

export function NutritionWarnings({ warnings }: NutritionWarningsProps) {
  if (warnings.length === 0) {
    return null;
  }

  return (
    <div className="bg-warning/10 rounded-lg p-5 border border-warning/20">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-warning/10 flex items-center justify-center flex-shrink-0">
          <AlertCircle className="h-4 w-4 text-warning" />
        </div>
        <div className="flex-1 space-y-2">
          <p className="font-semibold text-foreground text-sm">
            Nutrition Plan Warnings
          </p>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            {warnings.map((warning, index) => (
              <li key={index} className="flex items-start gap-2">
                <span className="text-warning mt-0.5">•</span>
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
