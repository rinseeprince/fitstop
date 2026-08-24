"use client";

import { useEffect, useRef, useState } from "react";
import { Timer } from "lucide-react";

// The prescribed rest between two sets, as a countdown the client can start.
// Local state only: nothing is persisted and no actual rest is logged, because
// nothing on the Training tab analyses rest. It is a coaching aid, not a metric.
type RestTimerProps = {
  seconds: number;
};

function format(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

export function RestTimer({ seconds }: RestTimerProps) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = () => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  // Unmounting mid-countdown (collapsing the exercise, leaving the page) must
  // not leave the interval running against dead state.
  useEffect(() => stop, []);

  const toggle = () => {
    if (intervalRef.current !== null) {
      stop();
      setRemaining(null);
      return;
    }
    setRemaining(seconds);
    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev === null || prev <= 1) {
          stop();
          return prev === null ? null : 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const running = remaining !== null;

  return (
    <div className="flex justify-center py-0.5">
      <button
        type="button"
        onClick={toggle}
        data-testid="rest-timer"
        aria-label={
          running ? "Reset rest timer" : `Start ${seconds} second rest timer`
        }
        className={`inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[11px] font-mono-display transition-colors ${
          running
            ? "bg-[rgba(13,148,136,0.08)] text-[#0d9488]"
            : "text-[#93b0b4] hover:bg-[rgba(13,148,136,0.06)] hover:text-[#0d9488]"
        }`}
      >
        <Timer className="h-3 w-3" strokeWidth={1.5} />
        {format(running ? remaining : seconds)} rest
      </button>
    </div>
  );
}
