"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  ArrowLeft,
  ArrowRight,
  Send,
  CheckCircle,
  Smile,
  Battery,
  Moon,
  Brain,
  Scale,
  Ruler,
} from "lucide-react";
import { toast } from "sonner";

const steps = [
  { id: 1, label: "Feeling" },
  { id: 2, label: "Body" },
  { id: 3, label: "Training" },
];

export default function ClientCheckInPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const [formData, setFormData] = useState({
    mood: 3,
    energy: 5,
    sleep: 5,
    stress: 5,
    notes: "",
    weight: "",
    bodyFatPercentage: "",
    workoutsCompleted: "",
    challenges: "",
    wins: "",
  });

  const updateField = (field: string, value: string | number) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    if (!user) return;

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/client/check-ins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: user.id,
          mood: formData.mood,
          energy: formData.energy,
          sleep: formData.sleep,
          stress: formData.stress,
          notes: formData.notes || null,
          weight: formData.weight ? parseFloat(formData.weight) : null,
          weightUnit: "lbs",
          bodyFatPercentage: formData.bodyFatPercentage
            ? parseFloat(formData.bodyFatPercentage)
            : null,
          workoutsCompleted: formData.workoutsCompleted
            ? parseInt(formData.workoutsCompleted)
            : null,
          challenges: formData.challenges || null,
          prs: formData.wins || null,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to submit check-in");
      }

      setIsSuccess(true);
      toast.success("Check-in submitted successfully!");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to submit check-in"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="w-full max-w-md text-center">
          <CardContent className="py-12">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="mb-2 text-2xl font-bold">Check-in Complete!</h2>
            <p className="mb-6 text-muted-foreground">
              Your coach will review your progress and get back to you soon.
            </p>
            <Button onClick={() => router.push("/client/progress")}>
              View Progress
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Weekly Check-in</h1>
        <p className="text-muted-foreground">
          Let your coach know how you&apos;re doing
        </p>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center justify-center gap-2">
        {steps.map((step, idx) => (
          <div key={step.id} className="flex items-center">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                currentStep >= step.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {step.id}
            </div>
            <span
              className={`ml-2 hidden text-sm sm:inline ${
                currentStep === step.id ? "font-medium" : "text-muted-foreground"
              }`}
            >
              {step.label}
            </span>
            {idx < steps.length - 1 && (
              <div className="mx-3 h-0.5 w-8 bg-muted sm:w-12" />
            )}
          </div>
        ))}
      </div>

      {/* Step Content */}
      <Card>
        <CardContent className="py-6">
          {currentStep === 1 && (
            <div className="space-y-6">
              <CardTitle className="text-lg">How are you feeling?</CardTitle>

              <SliderField
                label="Overall Mood"
                icon={Smile}
                value={formData.mood}
                min={1}
                max={5}
                onChange={(v) => updateField("mood", v)}
                labels={["Poor", "Great"]}
              />

              <SliderField
                label="Energy Level"
                icon={Battery}
                value={formData.energy}
                min={1}
                max={10}
                onChange={(v) => updateField("energy", v)}
                labels={["Low", "High"]}
              />

              <SliderField
                label="Sleep Quality"
                icon={Moon}
                value={formData.sleep}
                min={1}
                max={10}
                onChange={(v) => updateField("sleep", v)}
                labels={["Poor", "Great"]}
              />

              <SliderField
                label="Stress Level"
                icon={Brain}
                value={formData.stress}
                min={1}
                max={10}
                onChange={(v) => updateField("stress", v)}
                labels={["Low", "High"]}
              />

              <div>
                <Label htmlFor="notes">Any notes for your coach?</Label>
                <Textarea
                  id="notes"
                  placeholder="How are things going? Anything you want to share..."
                  value={formData.notes}
                  onChange={(e) => updateField("notes", e.target.value)}
                  className="mt-2"
                  rows={3}
                />
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div className="space-y-6">
              <CardTitle className="text-lg">Body Metrics</CardTitle>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="weight" className="flex items-center gap-2">
                    <Scale className="h-4 w-4" />
                    Current Weight (lbs)
                  </Label>
                  <Input
                    id="weight"
                    type="number"
                    step="0.1"
                    placeholder="Enter weight"
                    value={formData.weight}
                    onChange={(e) => updateField("weight", e.target.value)}
                    className="mt-2"
                  />
                </div>

                <div>
                  <Label htmlFor="bodyFat" className="flex items-center gap-2">
                    <Ruler className="h-4 w-4" />
                    Body Fat % (optional)
                  </Label>
                  <Input
                    id="bodyFat"
                    type="number"
                    step="0.1"
                    placeholder="Enter body fat %"
                    value={formData.bodyFatPercentage}
                    onChange={(e) =>
                      updateField("bodyFatPercentage", e.target.value)
                    }
                    className="mt-2"
                  />
                </div>
              </div>

              <p className="text-sm text-muted-foreground">
                Weigh yourself first thing in the morning for consistency.
              </p>
            </div>
          )}

          {currentStep === 3 && (
            <div className="space-y-6">
              <CardTitle className="text-lg">Training Summary</CardTitle>

              <div>
                <Label htmlFor="workouts">Workouts Completed This Week</Label>
                <Input
                  id="workouts"
                  type="number"
                  min="0"
                  max="14"
                  placeholder="Number of workouts"
                  value={formData.workoutsCompleted}
                  onChange={(e) =>
                    updateField("workoutsCompleted", e.target.value)
                  }
                  className="mt-2"
                />
              </div>

              <div>
                <Label htmlFor="wins">Wins & PRs</Label>
                <Textarea
                  id="wins"
                  placeholder="Any personal records or achievements?"
                  value={formData.wins}
                  onChange={(e) => updateField("wins", e.target.value)}
                  className="mt-2"
                  rows={3}
                />
              </div>

              <div>
                <Label htmlFor="challenges">Challenges</Label>
                <Textarea
                  id="challenges"
                  placeholder="What struggles did you face?"
                  value={formData.challenges}
                  onChange={(e) => updateField("challenges", e.target.value)}
                  className="mt-2"
                  rows={3}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex items-center justify-between gap-4">
        {currentStep > 1 ? (
          <Button
            variant="outline"
            onClick={() => setCurrentStep((s) => s - 1)}
            disabled={isSubmitting}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        ) : (
          <Button variant="ghost" onClick={() => router.back()}>
            Cancel
          </Button>
        )}

        {currentStep < 3 ? (
          <Button onClick={() => setCurrentStep((s) => s + 1)}>
            Next
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Submitting...
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Submit
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

interface SliderFieldProps {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  labels: [string, string];
}

function SliderField({
  label,
  icon: Icon,
  value,
  min,
  max,
  onChange,
  labels,
}: SliderFieldProps) {
  return (
    <div>
      <Label className="flex items-center gap-2">
        <Icon className="h-4 w-4" />
        {label}
        <span className="ml-auto text-sm text-muted-foreground">
          {value}/{max}
        </span>
      </Label>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={1}
        onValueChange={([v]) => onChange(v)}
        className="mt-3"
      />
      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
        <span>{labels[0]}</span>
        <span>{labels[1]}</span>
      </div>
    </div>
  );
}
