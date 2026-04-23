"use client";

import { useState, useCallback, useMemo } from "react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import { Button } from "@/components/ui/button";
import { WalkthroughStep } from "./walkthrough-step";
import {
  Sparkles,
  Utensils,
  Dumbbell,
  CheckSquare,
  Rocket,
} from "lucide-react";
import type { NutritionTargets } from "@/services/client-portal-service";
import type { TrainingPlan } from "@/types/training";
import type { DailyHabit } from "@/types/daily-habit";

type GuidedWalkthroughProps = {
  coachName?: string;
  welcomeMessage?: string;
  nutrition: NutritionTargets | null;
  plan: TrainingPlan | null;
  habits: DailyHabit[];
  onComplete: () => void;
};

export function GuidedWalkthrough({
  coachName,
  welcomeMessage,
  nutrition,
  plan,
  habits,
  onComplete,
}: GuidedWalkthroughProps) {
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);

  const hasNutrition = !!(nutrition?.calorieTarget || nutrition?.customCalories);
  const hasPlan = plan !== null;
  const hasHabits = habits.length > 0;

  const steps = useMemo(() => {
    const s: { key: string }[] = [{ key: "welcome" }];
    if (hasNutrition) s.push({ key: "nutrition" });
    if (hasPlan) s.push({ key: "training" });
    if (hasHabits) s.push({ key: "habits" });
    s.push({ key: "how-it-works" });
    return s;
  }, [hasNutrition, hasPlan, hasHabits]);

  const handleSelect = useCallback(() => {
    if (!api) return;
    setCurrent(api.selectedScrollSnap());
  }, [api]);

  const handleSetApi = useCallback(
    (emblaApi: CarouselApi) => {
      setApi(emblaApi);
      if (emblaApi) {
        emblaApi.on("select", handleSelect);
      }
    },
    [handleSelect]
  );

  const isLast = current === steps.length - 1;

  async function handleFinish() {
    try {
      await fetch("/api/client/walkthrough-seen", { method: "POST" });
    } catch {
      // Non-blocking — user can still proceed
    }
    onComplete();
  }

  function handleNext() {
    if (isLast) {
      handleFinish();
    } else {
      api?.scrollNext();
    }
  }

  const calories =
    nutrition?.customMacrosEnabled && nutrition.customCalories
      ? nutrition.customCalories
      : nutrition?.calorieTarget;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-background">
      {/* Carousel */}
      <div className="flex-1 flex items-center justify-center overflow-hidden">
        <Carousel
          className="w-full max-w-lg"
          opts={{ watchDrag: true }}
          setApi={handleSetApi}
        >
          <CarouselContent>
            {/* Welcome */}
            <CarouselItem>
              <WalkthroughStep icon={Sparkles} title="Welcome!">
                {coachName && (
                  <p className="text-muted-foreground">
                    {coachName} has set everything up for you.
                  </p>
                )}
                {welcomeMessage && (
                  <p className="text-sm italic text-muted-foreground">
                    &ldquo;{welcomeMessage}&rdquo;
                  </p>
                )}
                {!coachName && !welcomeMessage && (
                  <p className="text-muted-foreground">
                    Your coach has set everything up. Let&apos;s take a quick
                    look at your program.
                  </p>
                )}
              </WalkthroughStep>
            </CarouselItem>

            {/* Nutrition */}
            {hasNutrition && (
              <CarouselItem>
                <WalkthroughStep icon={Utensils} title="Your Nutrition">
                  <p className="text-muted-foreground">
                    Your daily calorie target is{" "}
                    <span className="font-semibold text-foreground">
                      {calories} kcal
                    </span>
                  </p>
                  <div className="flex justify-center gap-6 text-sm">
                    {(nutrition?.proteinTargetG || nutrition?.customProteinG) && (
                      <div>
                        <p className="font-semibold text-foreground">
                          {nutrition.customProteinG ?? nutrition.proteinTargetG}g
                        </p>
                        <p className="text-muted-foreground">Protein</p>
                      </div>
                    )}
                    {(nutrition?.carbTargetG || nutrition?.customCarbG) && (
                      <div>
                        <p className="font-semibold text-foreground">
                          {nutrition.customCarbG ?? nutrition.carbTargetG}g
                        </p>
                        <p className="text-muted-foreground">Carbs</p>
                      </div>
                    )}
                    {(nutrition?.fatTargetG || nutrition?.customFatG) && (
                      <div>
                        <p className="font-semibold text-foreground">
                          {nutrition.customFatG ?? nutrition.fatTargetG}g
                        </p>
                        <p className="text-muted-foreground">Fat</p>
                      </div>
                    )}
                  </div>
                </WalkthroughStep>
              </CarouselItem>
            )}

            {/* Training */}
            {hasPlan && (
              <CarouselItem>
                <WalkthroughStep icon={Dumbbell} title="Your Training">
                  <p className="text-muted-foreground">
                    <span className="font-semibold text-foreground">
                      {plan.name}
                    </span>{" "}
                    — {plan.frequencyPerWeek}x per week
                  </p>
                  <div className="space-y-1 text-sm text-muted-foreground">
                    {plan.sessions
                      .map((session) => (
                        <div key={session.id} className="flex justify-between">
                          <span>{session.name}</span>
                          {session.dayOfWeek && (
                            <span className="capitalize">
                              {session.dayOfWeek}
                            </span>
                          )}
                        </div>
                      ))}
                  </div>
                </WalkthroughStep>
              </CarouselItem>
            )}

            {/* Habits */}
            {hasHabits && (
              <CarouselItem>
                <WalkthroughStep icon={CheckSquare} title="Daily Habits">
                  <p className="text-muted-foreground">
                    Track these habits each day:
                  </p>
                  <div className="space-y-2 text-sm text-left">
                    {habits.map((habit) => (
                      <div key={habit.id}>
                        <p className="font-medium text-foreground">
                          {habit.name}
                        </p>
                        {habit.description && (
                          <p className="text-muted-foreground">
                            {habit.description}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </WalkthroughStep>
              </CarouselItem>
            )}

            {/* How It Works */}
            <CarouselItem>
              <WalkthroughStep icon={Rocket} title="How It Works">
                <div className="space-y-4 text-sm text-muted-foreground text-left">
                  <div>
                    <p className="font-semibold text-foreground">Daily Pulse</p>
                    <p>
                      Log your weight, nutrition, habits, and how you&apos;re
                      feeling each day. It only takes a minute.
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">
                      Weekly Check-in
                    </p>
                    <p>
                      Once a week, submit a check-in so your coach can review
                      your progress and adjust your plan.
                    </p>
                  </div>
                </div>
              </WalkthroughStep>
            </CarouselItem>
          </CarouselContent>
        </Carousel>
      </div>

      {/* Progress dots + button */}
      <div className="flex flex-col items-center gap-4 pb-8 px-6">
        <div className="flex gap-2">
          {steps.map((step, i) => (
            <div
              key={step.key}
              className={`h-2 w-2 rounded-full transition-colors ${
                i === current ? "bg-primary" : "bg-muted-foreground/30"
              }`}
            />
          ))}
        </div>
        <Button className="w-full max-w-xs" onClick={handleNext}>
          {isLast ? "Get Started" : "Next"}
        </Button>
      </div>
    </div>
  );
}
