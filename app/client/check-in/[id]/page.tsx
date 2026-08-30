"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  Calendar,
  Weight,
  Ruler,
  Heart,
  Brain,
  Activity,
  MessageSquare,
  HelpCircle,
  Camera,
  Trophy,
  Target,
} from "lucide-react";
import type { CheckInWithDetails } from "@/types/check-in";
import { useUnits } from "@/contexts/units-context";
import { formatLength, formatLoad, formatWeight } from "@/utils/unit-conversions";

export default function CheckInDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { preference } = useUnits();

  // Stored weights are kilograms and girths centimetres. The exercise-highlight
  // weight is a barbell load, so it goes through formatLoad and snaps; body
  // data does not.
  const showWeight = (kg: number) => {
    const { value, unit } = formatWeight(kg, preference);
    return `${Math.round(value * 10) / 10} ${unit}`;
  };
  const showLength = (cm: number) => {
    const { value, unit } = formatLength(cm, preference);
    return `${Math.round(value * 10) / 10} ${unit}`;
  };
  const showLoad = (kg: number) => {
    const { value, unit } = formatLoad(kg, preference);
    return `${value} ${unit}`;
  };

  const [checkIn, setCheckIn] = useState<CheckInWithDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchCheckIn() {
      try {
        const response = await fetch(`/api/client/check-ins/${params.id}`);
        if (!response.ok) throw new Error("Failed to fetch check-in");

        const data = await response.json();
        setCheckIn(data.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    }

    if (params.id) {
      fetchCheckIn();
    }
  }, [params.id]);

  // Deep-link-safe back: only call router.back() when the previous entry was
  // same-origin. window.history.length is unreliable (Chrome's new-tab page
  // counts as an entry), so we check document.referrer instead — empty or
  // cross-origin means the user landed here directly (paste, email, share)
  // and back() would drop them outside the app.
  const handleBack = () => {
    const sameOriginReferrer =
      typeof document !== "undefined" &&
      document.referrer !== "" &&
      document.referrer.startsWith(window.location.origin);
    if (sameOriginReferrer) {
      router.back();
    } else {
      router.push("/client/check-in");
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }

  if (error || !checkIn) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">{error || "Check-in not found"}</p>
          <Button variant="outline" className="mt-4" onClick={handleBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </CardContent>
      </Card>
    );
  }

  const date = new Date(checkIn.createdAt);
  const formattedDate = date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={handleBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">Check-in Details</h1>
          <p className="text-muted-foreground flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            {formattedDate}
          </p>
        </div>
        <Badge variant="outline" className="ml-auto capitalize">
          {checkIn.status.replace(/_/g, " ")}
        </Badge>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Physique */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Weight className="h-5 w-5" />
              Physique
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {checkIn.weight && (
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Weight</span>
                <span className="font-medium">
                  {showWeight(checkIn.weight)}
                </span>
              </div>
            )}
            {checkIn.bodyFatPercentage && (
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Body Fat</span>
                <span className="font-medium">{checkIn.bodyFatPercentage}%</span>
              </div>
            )}

            {(checkIn.waist || checkIn.hips || checkIn.chest || checkIn.arms || checkIn.thighs) && (
              <>
                <Separator className="my-4" />
                <div className="space-y-2">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Ruler className="h-4 w-4" />
                    Measurements
                  </h4>
                  {checkIn.waist && (
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Waist</span>
                      <span className="font-medium">
                        {showLength(checkIn.waist)}
                      </span>
                    </div>
                  )}
                  {checkIn.hips && (
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Hips</span>
                      <span className="font-medium">
                        {showLength(checkIn.hips)}
                      </span>
                    </div>
                  )}
                  {checkIn.chest && (
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Chest</span>
                      <span className="font-medium">
                        {showLength(checkIn.chest)}
                      </span>
                    </div>
                  )}
                  {checkIn.arms && (
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Arms</span>
                      <span className="font-medium">
                        {showLength(checkIn.arms)}
                      </span>
                    </div>
                  )}
                  {checkIn.thighs && (
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Thighs</span>
                      <span className="font-medium">
                        {showLength(checkIn.thighs)}
                      </span>
                    </div>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Wellness Metrics */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Heart className="h-5 w-5" />
              Wellness
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {checkIn.mood && (
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Mood</span>
                <span className="font-medium">{checkIn.mood}/5</span>
              </div>
            )}
            {checkIn.energy && (
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Energy</span>
                <span className="font-medium">{checkIn.energy}/10</span>
              </div>
            )}
            {checkIn.sleep && (
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Sleep Quality</span>
                <span className="font-medium">{checkIn.sleep}/10</span>
              </div>
            )}
            {checkIn.stress && (
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Stress Level</span>
                <span className="font-medium">{checkIn.stress}/10</span>
              </div>
            )}
            {checkIn.soreness && (
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Muscle Soreness</span>
                <span className="font-medium">{checkIn.soreness}/10</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Training & Nutrition */}
        {(checkIn.workoutsCompleted || checkIn.adherencePercentage || checkIn.nutritionDaysOnTarget || checkIn.prs || checkIn.challenges) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Training & Nutrition
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {checkIn.workoutsCompleted && (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Workouts Completed</span>
                  <span className="font-medium">{checkIn.workoutsCompleted}</span>
                </div>
              )}
              {checkIn.adherencePercentage && (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Training Adherence</span>
                  <span className="font-medium">{checkIn.adherencePercentage}%</span>
                </div>
              )}
              {checkIn.nutritionDaysOnTarget && (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Nutrition On Target</span>
                  <span className="font-medium">{checkIn.nutritionDaysOnTarget}/7 days</span>
                </div>
              )}

              {checkIn.prs && (
                <>
                  <Separator className="my-4" />
                  <div>
                    <h4 className="text-sm font-medium mb-2">Personal Records & Wins</h4>
                    <p className="text-sm text-muted-foreground">{checkIn.prs}</p>
                  </div>
                </>
              )}

              {checkIn.challenges && (
                <>
                  <Separator className="my-4" />
                  <div>
                    <h4 className="text-sm font-medium mb-2">Challenges & Difficulties</h4>
                    <p className="text-sm text-muted-foreground">{checkIn.challenges}</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Exercise Highlights */}
        {checkIn.exerciseHighlights && checkIn.exerciseHighlights.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5" />
                Exercise Highlights
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {checkIn.exerciseHighlights.map((highlight, index) => (
                <div key={index} className="rounded-lg border p-4">
                  <div className="flex items-center gap-2 mb-2">
                    {highlight.highlightType === 'pr' && <Trophy className="h-4 w-4 text-warning" />}
                    {highlight.highlightType === 'struggle' && <Target className="h-4 w-4 text-destructive" />}
                    {highlight.highlightType === 'note' && <Brain className="h-4 w-4 text-primary" />}
                    <span className="font-medium">{highlight.exerciseName}</span>
                    <Badge variant="outline" className="capitalize">
                      {highlight.highlightType}
                    </Badge>
                  </div>
                  {highlight.details && (
                    <p className="text-sm text-muted-foreground mb-2">{highlight.details}</p>
                  )}
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    {highlight.weightValue && (
                      <span>{showLoad(highlight.weightValue)}</span>
                    )}
                    {highlight.reps && (
                      <span>{highlight.reps} reps</span>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}


        {/* Notes */}
        {(checkIn.notes || checkIn.nutritionNotes) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5" />
                Notes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {checkIn.notes && (
                <div>
                  <h4 className="text-sm font-medium mb-2">General Notes</h4>
                  <p className="text-sm text-muted-foreground">{checkIn.notes}</p>
                </div>
              )}
              {checkIn.nutritionNotes && (
                <>
                  {checkIn.notes && <Separator className="my-4" />}
                  <div>
                    <h4 className="text-sm font-medium mb-2">Nutrition Notes</h4>
                    <p className="text-sm text-muted-foreground">{checkIn.nutritionNotes}</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* The coach's own questions, and what this client answered. Prompts
            are joined LIVE from the question rows, so a reworded question
            relabels this answer too — it is the same question. */}
        {checkIn.customAnswers && checkIn.customAnswers.length > 0 && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HelpCircle className="h-5 w-5" />
                Your coach asked
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {checkIn.customAnswers.map((answer, index) => (
                <div key={answer.questionId}>
                  {index > 0 && <Separator className="mb-4" />}
                  <h4 className="text-sm font-medium mb-2">{answer.prompt}</h4>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                    {answer.answer}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Progress Photos */}
        {(checkIn.photoFront || checkIn.photoSide || checkIn.photoBack) && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Camera className="h-5 w-5" />
                Progress Photos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3">
                {checkIn.photoFront && (
                  <div>
                    <p className="text-sm font-medium mb-2">Front</p>
                    <img
                      src={checkIn.photoFront}
                      alt="Front progress photo"
                      className="w-full h-64 object-cover rounded-lg"
                    />
                  </div>
                )}
                {checkIn.photoSide && (
                  <div>
                    <p className="text-sm font-medium mb-2">Side</p>
                    <img
                      src={checkIn.photoSide}
                      alt="Side progress photo"
                      className="w-full h-64 object-cover rounded-lg"
                    />
                  </div>
                )}
                {checkIn.photoBack && (
                  <div>
                    <p className="text-sm font-medium mb-2">Back</p>
                    <img
                      src={checkIn.photoBack}
                      alt="Back progress photo"
                      className="w-full h-64 object-cover rounded-lg"
                    />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Coach Response */}
        {checkIn.coachResponse && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                Coach Response
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-muted/50 p-4 rounded-lg">
                <p className="text-sm">{checkIn.coachResponse}</p>
                {checkIn.coachReviewedAt && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Reviewed on{" "}
                    {new Date(checkIn.coachReviewedAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

      </div>
    </div>
  );
}
