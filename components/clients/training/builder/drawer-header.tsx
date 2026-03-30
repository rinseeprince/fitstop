"use client";

import { Stars, X } from "lucide-react";
import { SheetClose } from "@/components/ui/sheet";

type TrainingDrawerHeaderProps = {
  title: string;
  sessionsPerWeek: number;
  totalMinutes: number;
  estimatedExercises: number;
};

export function TrainingDrawerHeader({
  title,
  sessionsPerWeek,
  totalMinutes,
  estimatedExercises,
}: TrainingDrawerHeaderProps) {
  return (
    <div className="bg-[#0f2027] px-6 pt-5 pb-5 flex-shrink-0">
      {/* Top row: icon + title + close */}
      <div className="flex items-start gap-3">
        <div className="w-[36px] h-[36px] rounded-[6px] bg-[rgba(13,148,136,0.15)] flex items-center justify-center flex-shrink-0">
          <Stars className="w-[18px] h-[18px] text-[#0d9488]" strokeWidth={1.5} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-[18px] font-bold text-white leading-tight">
            {title}
          </h2>
          <p className="text-[12.5px] text-[rgba(255,255,255,0.5)] mt-1 leading-[1.4]">
            Build a structured training programme from your parameters. The current plan will be archived.
          </p>
        </div>
        <SheetClose className="w-[32px] h-[32px] rounded-[6px] bg-[rgba(255,255,255,0.06)] flex items-center justify-center flex-shrink-0 hover:bg-[rgba(255,255,255,0.1)] transition-colors">
          <X className="w-4 h-4 text-[rgba(255,255,255,0.4)]" strokeWidth={1.5} />
          <span className="sr-only">Close</span>
        </SheetClose>
      </div>

      {/* Preview summary bar */}
      <div className="mt-4 bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.08)] rounded-[6px] px-4 py-3 flex items-center gap-3">
        <PreviewStat
          value={sessionsPerWeek}
          label="sessions/wk"
          dotColor="#0d9488"
        />
        <Separator />
        <PreviewStat
          value={totalMinutes}
          label="min total"
          dotColor="#0d9488"
        />
        <Separator />
        <PreviewStat
          value={`~${estimatedExercises}`}
          label="ex"
          dotColor="#c8923a"
        />
      </div>
    </div>
  );
}

function PreviewStat({
  value,
  label,
  dotColor,
}: {
  value: number | string;
  label: string;
  dotColor: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="w-[6px] h-[6px] rounded-full flex-shrink-0"
        style={{ backgroundColor: dotColor }}
      />
      <span className="font-mono-display text-[13px]">
        <span className="font-bold text-white">{value}</span>
        <span className="text-[rgba(255,255,255,0.4)] ml-1">{label}</span>
      </span>
    </span>
  );
}

function Separator() {
  return (
    <span className="text-[rgba(255,255,255,0.12)] text-[12px] select-none">|</span>
  );
}
