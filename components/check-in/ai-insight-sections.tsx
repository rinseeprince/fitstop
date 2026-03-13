"use client";

import {
  Utensils,
  FileText,
  Dumbbell,
  Heart,
  ListChecks,
  Star,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import type {
  AINutritionInsight,
  AINotesIntelligence,
  AITrainingInsight,
  AIWellnessInsight,
  AICoachAction,
} from "@/types/check-in";

export function CollapsibleSection({ icon: Icon, title, iconColor, defaultOpen = false, children }: {
  icon: React.ElementType;
  title: string;
  iconColor: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full group cursor-pointer">
        <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
        <Icon className={`w-4 h-4 ${iconColor}`} />
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

function InsightParagraph({ text }: { text: string }) {
  if (!text) return null;
  return <p className="text-sm text-muted-foreground leading-relaxed">{text}</p>;
}

export function NutritionInsightSection({ data }: { data: AINutritionInsight }) {
  return (
    <CollapsibleSection icon={Utensils} title="Nutrition" iconColor="text-success">
      <div className="space-y-1.5 pl-7">
        <InsightParagraph text={data.weeklyAdherence} />
        <InsightParagraph text={data.caloriePattern} />
        {data.keyObservation && (
          <p className="text-sm text-foreground font-medium">{data.keyObservation}</p>
        )}
      </div>
    </CollapsibleSection>
  );
}

export function NotesIntelligenceSection({ data }: { data: AINotesIntelligence }) {
  const [showAllNotes, setShowAllNotes] = useState(false);
  const hasNotes = data.rawNotes.length > 0;
  const hasThemes = data.themes.length > 0;
  const hasConcerns = data.concerns.length > 0;

  return (
    <CollapsibleSection icon={FileText} title="Client Notes Intelligence" iconColor="text-primary">
      <div className="space-y-3 pl-7">
      {hasNotes && (
        <div className="bg-muted/30 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Notes This Week
            </span>
            {data.rawNotes.length > 2 && (
              <button
                onClick={() => setShowAllNotes(!showAllNotes)}
                className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
              >
                {showAllNotes ? "Show less" : `Show all (${data.rawNotes.length})`}
                {showAllNotes ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            )}
          </div>
          {(showAllNotes ? data.rawNotes : data.rawNotes.slice(0, 2)).map((note, i) => (
            <div key={i} className="text-sm">
              <span className="font-medium text-foreground">{note.date}:</span>{" "}
              <span className="text-muted-foreground italic">&ldquo;{note.note}&rdquo;</span>
            </div>
          ))}
        </div>
      )}

      {hasThemes && (
        <div className="flex flex-wrap gap-1.5">
          {data.themes.map((theme, i) => (
            <span key={i} className="px-2 py-0.5 text-xs rounded-full bg-primary/10 text-primary">
              {theme}
            </span>
          ))}
        </div>
      )}

      {hasConcerns && (
        <div className="bg-warning/10 border border-warning/20 rounded-lg p-3 space-y-1">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-warning" />
            <span className="text-xs font-semibold text-warning uppercase tracking-wide">Flagged for Review</span>
          </div>
          {data.concerns.map((concern, i) => (
            <p key={i} className="text-sm text-warning">{concern}</p>
          ))}
        </div>
      )}

      {data.positives.length > 0 && (
        <div className="space-y-1">
          {data.positives.map((positive, i) => (
            <p key={i} className="text-sm text-success">{positive}</p>
          ))}
        </div>
      )}
      </div>
    </CollapsibleSection>
  );
}

export function TrainingInsightSection({ data }: { data: AITrainingInsight }) {
  return (
    <CollapsibleSection icon={Dumbbell} title="Training" iconColor="text-primary">
      <div className="space-y-1.5 pl-7">
        <InsightParagraph text={data.completionSummary} />
        <InsightParagraph text={data.keyObservation} />
        {data.progressNote && (
          <p className="text-sm text-success">{data.progressNote}</p>
        )}
      </div>
    </CollapsibleSection>
  );
}

export function WellnessInsightSection({ data }: { data: AIWellnessInsight }) {
  return (
    <CollapsibleSection icon={Heart} title="Wellness" iconColor="text-destructive">
      <div className="space-y-1.5 pl-7">
        <InsightParagraph text={data.pattern} />
        <InsightParagraph text={data.averages} />
        {data.concern && (
          <p className="text-sm text-warning">{data.concern}</p>
        )}
      </div>
    </CollapsibleSection>
  );
}

const urgencyColors = {
  now: { border: "border-destructive", label: "text-destructive", bg: "bg-destructive/5" },
  next_check_in: { border: "border-warning", label: "text-warning", bg: "bg-warning/5" },
  monitor: { border: "border-primary", label: "text-primary", bg: "bg-primary/5" },
};

const urgencyLabels = {
  now: "Action Now",
  next_check_in: "Next Check-in",
  monitor: "Monitor",
};

export function CoachActionsSection({ data }: { data: AICoachAction[] }) {
  return (
    <CollapsibleSection icon={ListChecks} title="Recommended Coach Actions" iconColor="text-foreground">
      <div className="space-y-2 pl-7">
        {data.map((action, i) => {
          const colors = urgencyColors[action.urgency];
          return (
            <div key={i} className={`rounded-lg border-l-4 ${colors.border} ${colors.bg} p-3`}>
              <span className={`text-xs font-semibold uppercase tracking-wide ${colors.label}`}>
                {urgencyLabels[action.urgency]}
              </span>
              <p className="text-sm text-foreground mt-1">{action.action}</p>
              {action.context && (
                <p className="text-xs text-muted-foreground mt-0.5">{action.context}</p>
              )}
            </div>
          );
        })}
      </div>
    </CollapsibleSection>
  );
}

export function ClientHighlightsSection({ data }: { data: string[] }) {
  return (
    <CollapsibleSection icon={Star} title="Share with Client" iconColor="text-warning">
      <div className="bg-success/5 border border-success/15 rounded-lg p-3 space-y-1.5 ml-7">
        {data.map((highlight, i) => (
          <p key={i} className="text-sm text-success">{highlight}</p>
        ))}
      </div>
    </CollapsibleSection>
  );
}
