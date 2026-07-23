"use client";

import { Calendar } from "lucide-react";
import { format } from "date-fns";
import { MONO } from "@/components/clients/training/program-builder/builder-tokens";

type GoalDeadlineCardProps = {
  deadline: {
    date: string;
    daysRemaining: number;
    isPastDeadline: boolean;
  };
};

export const GoalDeadlineCard = ({ deadline }: GoalDeadlineCardProps) => {
  const past = deadline.isPastDeadline;
  return (
    <div
      className={`rounded-[6px] p-4 border ${
        past
          ? "bg-[rgba(245,158,11,0.07)] border-[rgba(245,158,11,0.2)]"
          : "bg-[rgba(13,148,136,0.05)] border-[rgba(13,148,136,0.15)]"
      }`}
    >
      <div className="flex items-start gap-3">
        <Calendar
          className={`h-5 w-5 mt-0.5 ${past ? "text-[#d97706]" : "text-[#0d9488]"}`}
          strokeWidth={1.5}
        />
        <div className="flex-1">
          <h4 className="font-semibold mb-1 text-[#0c1a1e]">Goal Deadline</h4>
          <div className="space-y-1">
            <p className="text-sm text-[#0c1a1e]">
              <span className="font-medium">Target Date:</span>{" "}
              <span className={MONO}>
                {format(new Date(deadline.date), "MMMM d, yyyy")}
              </span>
            </p>
            <p className={`text-sm font-medium ${past ? "text-[#d97706]" : "text-[#0d9488]"}`}>
              {past
                ? `Overdue by ${Math.abs(deadline.daysRemaining)} days`
                : `${deadline.daysRemaining} days remaining`}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
