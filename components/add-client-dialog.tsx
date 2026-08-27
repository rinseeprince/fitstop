"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { UserPlus, ClipboardList, PenLine } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { createClientSchema, type CreateClientInput } from "@/lib/validations/client";
import { cn } from "@/lib/utils";
import {
  FOCUS_RING,
  THUMB_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { AddClientIntakeForm } from "@/components/clients/add-client-intake-form";
import { AddClientManualForm } from "@/components/clients/add-client-manual-form";

type AddClientDialogProps = {
  trigger?: React.ReactNode;
  onClientAdded?: () => void;
};

type SetupMode = "intake" | "manual" | null;

const SETUP_MODES = [
  {
    value: "intake" as const,
    icon: ClipboardList,
    title: "Send intake questionnaire",
    description: "The client fills in their goals, training, nutrition and medical history",
  },
  {
    value: "manual" as const,
    icon: PenLine,
    title: "Set up manually",
    description: "You enter every client detail yourself",
  },
];

export const AddClientDialog = ({ trigger, onClientAdded }: AddClientDialogProps) => {
  const [open, setOpen] = useState(false);
  const [setupMode, setSetupMode] = useState<SetupMode>(null);
  const { toast } = useToast();

  const form = useForm<CreateClientInput>({
    resolver: zodResolver(createClientSchema),
    // No unit defaults. Weights and lengths on this payload are canonical
    // kilograms/centimetres; the form converts from the coach's own display
    // units on the way in (components/clients/add-client-manual-form.tsx).
    defaultValues: {
      name: "",
      email: "",
      notes: "",
      // Present from the start, because the schema READS it during validation.
      // See chooseSetupMode.
      setupMode: undefined,
    },
  });

  /**
   * Picking a path writes it to BOTH the dialog state (which decides what to
   * render) and the form (which the resolver validates against).
   *
   * The form half is load-bearing, and its absence broke the intake path
   * outright between 2026-08-21 and 2026-08-27. `createClientSchema` refines
   * "a manual add must carry a weight" as `setupMode !== "intake" &&
   * currentWeight === undefined` — so it has to know the path AT VALIDATION
   * TIME. `setupMode` was dialog state only, merged into the payload inside
   * `onSubmit`; but `handleSubmit` validates BEFORE it calls `onSubmit`, so the
   * refine always saw `undefined`, always demanded a weight, and the intake
   * form has no weight field. The error landed on `currentWeight`, which that
   * form does not render — no red box, no message, no request, no toast,
   * nothing to close the dialog. It looked like a dead button.
   *
   * One setter for both, so the two can never drift apart again — including on
   * Back, which must clear the form value too or a manual → Back → intake trip
   * would submit as `manual` and reproduce the bug from the other side.
   */
  const chooseSetupMode = (mode: SetupMode) => {
    setSetupMode(mode);
    form.setValue("setupMode", mode ?? undefined);
  };

  const onSubmit = async (data: CreateClientInput) => {
    try {
      // `data` already carries setupMode — chooseSetupMode put it there, which
      // is the only reason validation let us get this far.
      const response = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const result: { client?: unknown; inviteSent?: boolean; error?: string } = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to create client");
      }

      const message = setupMode === "intake"
        ? result.inviteSent
          ? `Intake questionnaire sent to ${data.email}.`
          : `${data.name} added but invite email failed — send manually from their profile.`
        : `${data.name} has been added to your client list.`;

      toast({
        title: "Client added",
        description: message,
        variant: setupMode === "intake" && !result.inviteSent ? "destructive" : undefined,
      });

      form.reset();
      setSetupMode(null);
      setOpen(false);

      onClientAdded?.();
    } catch (error) {
      toast({
        title: "Failed to add client",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      form.reset();
      setSetupMode(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger || (
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-lg transition-all hover:scale-110"
          >
            <UserPlus className="h-4 w-4" />
            <span className="sr-only">Add new client</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add new client</DialogTitle>
          <DialogDescription>
            {setupMode === null
              ? "Choose how you want to set up this client."
              : setupMode === "intake"
                ? "Enter basic details. The client will complete an intake questionnaire."
                : "Add a new client to your roster with full details."}
          </DialogDescription>
        </DialogHeader>

        {/* Setup mode selection */}
        {setupMode === null && (
          // The choice-dialog recipe (docs/newdesignsystem.md → Overlays):
          // picking an option IS the confirm, so there is no footer CTA.
          <div className="grid gap-2">
            {SETUP_MODES.map((mode) => (
              <button
                key={mode.value}
                type="button"
                onClick={() => chooseSetupMode(mode.value)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-[6px] border border-[rgba(13,148,136,0.08)] p-3 text-left transition-colors hover:bg-[rgba(13,148,136,0.03)]",
                  FOCUS_RING,
                )}
              >
                <span className={cn(THUMB_CLASS, "mt-0.5 h-8 w-8")}>
                  <mode.icon className="h-4 w-4" strokeWidth={1.5} />
                </span>
                <span>
                  <span className="block text-sm font-medium text-[#0c1a1e]">
                    {mode.title}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-[#93b0b4]">
                    {mode.description}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

        {setupMode === "intake" && (
          <AddClientIntakeForm
            form={form}
            onSubmit={onSubmit}
            onBack={() => chooseSetupMode(null)}
          />
        )}

        {setupMode === "manual" && (
          <AddClientManualForm
            form={form}
            onSubmit={onSubmit}
            onBack={() => chooseSetupMode(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};
