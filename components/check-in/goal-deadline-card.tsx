"use client";

import { Card } from "@/components/ui/card";
import { Calendar } from "lucide-react";
import { format } from "date-fns";

type GoalDeadlineCardProps = {
  deadline: {
    date: string;
    daysRemaining: number;
    isPastDeadline: boolean;
  };
};

export const GoalDeadlineCard = ({ deadline }: GoalDeadlineCardProps) => {
  return (
    <Card
      className={`p-4 ${
        deadline.isPastDeadline
          ? "bg-destructive/10 border-destructive/30"
          : "bg-primary/10 border-primary/30"
      }`}
    >
      <div className="flex items-start gap-3">
        <Calendar
          className={`h-5 w-5 mt-0.5 ${
            deadline.isPastDeadline
              ? "text-destructive"
              : "text-primary"
          }`}
        />
        <div className="flex-1">
          <h4 className="font-semibold mb-1">Goal Deadline</h4>
          <div className="space-y-1">
            <p className="text-sm">
              <span className="font-medium">Target Date:</span>{" "}
              {format(new Date(deadline.date), "MMMM d, yyyy")}
            </p>
            <p
              className={`text-sm font-medium ${
                deadline.isPastDeadline
                  ? "text-destructive"
                  : "text-primary"
              }`}
            >
              {deadline.isPastDeadline
                ? `Overdue by ${Math.abs(deadline.daysRemaining)} days`
                : `${deadline.daysRemaining} days remaining`}
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
};
