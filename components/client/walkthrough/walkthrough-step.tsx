"use client";

import type { LucideIcon } from "lucide-react";

type WalkthroughStepProps = {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
};

export function WalkthroughStep({
  icon: Icon,
  title,
  children,
}: WalkthroughStepProps) {
  return (
    <div className="flex flex-col items-center text-center px-6 py-8">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mb-6">
        <Icon className="h-8 w-8 text-primary" />
      </div>
      <h2 className="text-2xl font-semibold mb-4">{title}</h2>
      <div className="max-w-sm space-y-3">{children}</div>
    </div>
  );
}
