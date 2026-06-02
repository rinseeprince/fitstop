"use client";

import {
  Compass,
  LayoutGrid,
  Hand,
  ArrowLeftRight,
  Map,
  Rocket,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

export type WalkthroughStepConfig = {
  key: string;
  icon: LucideIcon;
  title: string;
  body: ReactNode;
};

/**
 * Static copy for the day-centric portal walkthrough, steps 2–7.
 * The data-dependent welcome step (step 1) is rendered inline by the parent;
 * this module stays presentational with no hooks or fetches.
 */
export const WALKTHROUGH_STEPS: readonly WalkthroughStepConfig[] = [
  {
    key: "nav",
    icon: Compass,
    title: "Find your way around",
    body: (
      <>
        <p className="text-muted-foreground">
          Use the tabs at the bottom to move around:{" "}
          <span className="font-semibold text-foreground">Home</span> for today,{" "}
          <span className="font-semibold text-foreground">Metrics</span> for your
          numbers,{" "}
          <span className="font-semibold text-foreground">Program</span> for your
          plan, and{" "}
          <span className="font-semibold text-foreground">Content</span> for
          anything your coach has shared.
        </p>
        <p className="text-sm text-muted-foreground">
          Settings lives behind your photo in the top-right.
        </p>
      </>
    ),
  },
  {
    key: "home",
    icon: LayoutGrid,
    title: "Your day at a glance",
    body: (
      <p className="text-muted-foreground">
        Home shows that day&apos;s training, nutrition, wellness and habits as
        cards, so you always know what&apos;s on for the day.
      </p>
    ),
  },
  {
    key: "log",
    icon: Hand,
    title: "Tap a card to log",
    body: (
      <>
        <p className="text-muted-foreground">
          Tap any card to open it and log what you did.
        </p>
        <p className="text-muted-foreground">
          On a rest day you can tap the training card to log a workout anyway,
          and on a planned day you can pick &ldquo;Do a different session&rdquo;
          if you switched things up.
        </p>
      </>
    ),
  },
  {
    key: "swipe",
    icon: ArrowLeftRight,
    title: "Move between days",
    body: (
      <p className="text-muted-foreground">
        Swipe left or right, or use the arrows, to revisit earlier days or get
        ahead.
      </p>
    ),
  },
  {
    key: "program",
    icon: Map,
    title: "See your roadmap",
    body: (
      <p className="text-muted-foreground">
        The banner at the top of home shows your current phase (if you have
        one). Tap it, or the Program tab, to see your whole plan.
      </p>
    ),
  },
  {
    key: "get-started",
    icon: Rocket,
    title: "You're all set",
    body: (
      <p className="text-muted-foreground">
        That&apos;s everything. Jump in, log your first day, and your coach will
        take it from there.
      </p>
    ),
  },
] as const;
