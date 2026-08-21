"use client";

import { useEffect, useRef } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useNutritionBuilderContext } from "@/contexts/nutrition-builder-context";
import { DrawerHeader } from "./drawer-header";
import { DrawerFormBody } from "./drawer-form-body";
import { DrawerFooter } from "./drawer-footer";

type NutritionSettingsDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires on a plan that actually saved — NOT on the auto-close below, which
   *  also fires when a regenerate fails on a client who already had a plan. */
  onSaved?: () => void;
};

export function NutritionSettingsDrawer({
  open,
  onOpenChange,
  onSaved,
}: NutritionSettingsDrawerProps) {
  const builder = useNutritionBuilderContext();
  const wasGenerating = useRef(false);
  const previousHasPlan = useRef(builder.hasPlan);

  // Auto-close drawer on successful generation
  useEffect(() => {
    if (wasGenerating.current && !builder.isGenerating && builder.hasPlan) {
      onOpenChange(false);
    }
    wasGenerating.current = builder.isGenerating;
    previousHasPlan.current = builder.hasPlan;
  }, [builder.isGenerating, builder.hasPlan, onOpenChange]);

  const title = builder.hasPlan ? "Regenerate Plan" : "Generate Plan";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        overlayClassName="bg-[rgba(15,32,39,0.35)] backdrop-blur-[2px]"
        className="w-[420px] bg-[#f4f7f6] border-0 p-0 gap-0 flex flex-col inset-y-0 right-0 h-full data-[state=open]:animate-none data-[state=closed]:animate-none data-[state=open]:slide-in-from-right-0 [&>[data-slot=sheet-close]]:hidden animate-drawer-slide-in data-[state=closed]:slide-out-to-right data-[state=closed]:duration-300"
      >
        {/* Visually hidden title for accessibility */}
        <SheetHeader className="sr-only">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>

        <DrawerHeader
          hasPlan={builder.hasPlan}
          title={title}
          calorieTarget={builder.nutritionData?.calorieTarget}
          proteinG={builder.nutritionData?.proteinTargetG}
          carbsG={builder.nutritionData?.carbTargetG}
          fatG={builder.nutritionData?.fatTargetG}
        />

        <DrawerFormBody />

        <DrawerFooter onSaved={onSaved} />
      </SheetContent>
    </Sheet>
  );
}
