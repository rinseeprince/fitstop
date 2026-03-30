"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTrainingBuilderContext } from "@/contexts/training-builder-context";
import { ModeToggle } from "./mode-toggle";
import { AIPromptPanel } from "./ai-prompt-panel";
import { ManualWorkoutBuilder } from "./manual-workout-builder";
import { PhaseSelector } from "../../shared/phase-selector";

const selectTriggerClass =
  "bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] text-[13px] font-medium text-[#0c1a1e] focus:border-[rgba(13,148,136,0.25)] focus:shadow-[0_0_0_3px_rgba(13,148,136,0.06)] focus:ring-0 transition-all hover:border-[rgba(13,148,136,0.25)] [&>svg]:text-[#93b0b4] [&>svg]:hover:text-[#0d9488] [&>svg]:transition-colors";

const selectContentClass =
  "bg-white rounded-[6px] shadow-lg border border-[rgba(13,148,136,0.08)] p-1";

const selectItemClass =
  "rounded-[6px] cursor-pointer text-[13px] text-[#0c1a1e] focus:bg-[rgba(13,148,136,0.05)]";

function Divider() {
  return <div className="h-px bg-[rgba(13,148,136,0.08)]" />;
}

function AnimatedGroup({
  index,
  children,
}: {
  index: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className="animate-drawer-fade-up"
      style={{ animationDelay: `${index * 0.04}s` }}
    >
      {children}
    </div>
  );
}

type TrainingDrawerFormBodyProps = {
  clientWeightKg: number;
  weightUnit?: "lbs" | "kg";
};

export function TrainingDrawerFormBody({
  clientWeightKg,
  weightUnit = "lbs",
}: TrainingDrawerFormBodyProps) {
  const builder = useTrainingBuilderContext();

  return (
    <div
      className="flex-1 overflow-y-auto px-6 pt-6"
      style={{ paddingBottom: 20 }}
    >
      <div className="space-y-5">
        {/* Mode Toggle */}
        <AnimatedGroup index={0}>
          <ModeToggle className="w-full" />
        </AnimatedGroup>

        <Divider />

        {/* Roadmap Phase */}
        <AnimatedGroup index={1}>
          <PhaseSelector
            clientId={builder.clientId}
            weightUnit={weightUnit}
            value={builder.phaseId}
            onChange={builder.setPhaseId}
            onBlockSubmit={builder.setPhaseBlocked}
          />
        </AnimatedGroup>

        {builder.mode === "ai" ? (
          <>
            {/* Sessions Per Week - AI mode only */}
            <AnimatedGroup index={2}>
              <div className="space-y-1.5">
                <label className="text-[10.5px] uppercase tracking-[0.07em] font-semibold text-[#93b0b4]">
                  Sessions Per Week
                </label>
                <Select
                  value={builder.sessionsPerWeek.toString()}
                  onValueChange={(v) => builder.setSessionsPerWeek(parseInt(v, 10))}
                >
                  <SelectTrigger className={selectTriggerClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className={selectContentClass}>
                    <SelectItem value="2" className={selectItemClass}>2 sessions</SelectItem>
                    <SelectItem value="3" className={selectItemClass}>3 sessions</SelectItem>
                    <SelectItem value="4" className={selectItemClass}>4 sessions</SelectItem>
                    <SelectItem value="5" className={selectItemClass}>5 sessions</SelectItem>
                    <SelectItem value="6" className={selectItemClass}>6 sessions</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-[#93b0b4] leading-[1.4]">
                  Weekly frequency (recovery days scheduled automatically)
                </p>
              </div>
            </AnimatedGroup>

            {/* Session Duration - AI mode only */}
            <AnimatedGroup index={3}>
              <div className="space-y-1.5">
                <label className="text-[10.5px] uppercase tracking-[0.07em] font-semibold text-[#93b0b4]">
                  Session Duration
                </label>
                <Select
                  value={builder.sessionDuration.toString()}
                  onValueChange={(v) => builder.setSessionDuration(parseInt(v, 10))}
                >
                  <SelectTrigger className={selectTriggerClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className={selectContentClass}>
                    <SelectItem value="30" className={selectItemClass}>30min Express</SelectItem>
                    <SelectItem value="45" className={selectItemClass}>45min Standard</SelectItem>
                    <SelectItem value="60" className={selectItemClass}>60min Full</SelectItem>
                    <SelectItem value="75" className={selectItemClass}>75min Extended</SelectItem>
                    <SelectItem value="90" className={selectItemClass}>90min Long</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-[#93b0b4] leading-[1.4]">
                  Target duration per session (affects exercise count and rest periods)
                </p>
              </div>
            </AnimatedGroup>

            <Divider />

            {/* AI content */}
            <AnimatedGroup index={4}>
              <AIPromptPanel clientWeightKg={clientWeightKg} />
            </AnimatedGroup>
          </>
        ) : (
          /* Manual content - no session selectors needed */
          <AnimatedGroup index={2}>
            <ManualWorkoutBuilder clientWeightKg={clientWeightKg} />
          </AnimatedGroup>
        )}
      </div>
    </div>
  );
}
