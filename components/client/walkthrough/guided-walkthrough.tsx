"use client";

import { useState, useCallback } from "react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { WalkthroughStep } from "./walkthrough-step";
import { WALKTHROUGH_STEPS } from "./walkthrough-steps";

type GuidedWalkthroughProps = {
  coachName?: string;
  welcomeMessage?: string;
  onComplete: () => void;
};

export function GuidedWalkthrough({
  coachName,
  welcomeMessage,
  onComplete,
}: GuidedWalkthroughProps) {
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);

  // Step 1 is the inline welcome; steps 2–7 come from the static module.
  const totalSteps = WALKTHROUGH_STEPS.length + 1;

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

  const isLast = current === totalSteps - 1;

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
            {/* Welcome (data-dependent, rendered inline) */}
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
                    look around your portal.
                  </p>
                )}
              </WalkthroughStep>
            </CarouselItem>

            {/* Steps 2–7 (static copy) */}
            {WALKTHROUGH_STEPS.map((step) => (
              <CarouselItem key={step.key}>
                <WalkthroughStep icon={step.icon} title={step.title}>
                  {step.body}
                </WalkthroughStep>
              </CarouselItem>
            ))}
          </CarouselContent>
        </Carousel>
      </div>

      {/* Progress dots + button */}
      <div className="flex flex-col items-center gap-4 pb-8 px-6">
        <div className="flex gap-2">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
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
