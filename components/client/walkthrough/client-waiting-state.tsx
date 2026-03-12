"use client";

import { Clock } from "lucide-react";

export function ClientWaitingState() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center px-6">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted mb-6">
        <Clock className="h-10 w-10 text-muted-foreground" />
      </div>
      <h1 className="text-2xl font-semibold mb-2">
        Your coach is building your plan...
      </h1>
      <p className="text-muted-foreground max-w-md">
        We&apos;ll notify you when everything is ready. In the meantime, sit
        tight — your personalized program is on its way!
      </p>
    </div>
  );
}
