"use client";

import { Clock } from "lucide-react";
import type { OnboardingStatus } from "@/types/client-intake";

type ClientWaitingStateProps = {
  onboardingStatus?: OnboardingStatus;
};

export function ClientWaitingState({ onboardingStatus }: ClientWaitingStateProps) {
  const heading =
    onboardingStatus === "intake_completed"
      ? "Your coach is reviewing your responses..."
      : "Your coach is building your plan...";

  const message =
    onboardingStatus === "intake_completed"
      ? "We'll notify you once your coach has reviewed your intake and started setting up your program."
      : "We'll notify you when everything is ready. In the meantime, sit tight \u2014 your personalized program is on its way!";

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center px-6">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted mb-6">
        <Clock className="h-10 w-10 text-muted-foreground" />
      </div>
      <h1 className="text-2xl font-semibold mb-2">{heading}</h1>
      <p className="text-muted-foreground max-w-md">{message}</p>
    </div>
  );
}
