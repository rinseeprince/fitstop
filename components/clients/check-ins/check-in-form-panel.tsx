"use client";

import { useState } from "react";
import { BookmarkPlus, ChevronDown, Loader2, SlidersHorizontal, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { cn } from "@/lib/utils";
import { pluralize } from "@/components/clients/overview/overview-format";
import {
  FOCUS_RING,
  HEADER_EYEBROW_CLASS,
  LABEL_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { CHECK_IN_FORM_FIELD_KEYS } from "@/lib/check-in/form-fields";
import { useClientCheckInForm } from "@/hooks/use-check-in-form-config";
import { CheckInFormFieldsCard } from "./check-in-form-fields-card";
import { CheckInFormQuestionsCard } from "./check-in-form-questions-card";
import { useCheckInFormEditor } from "./use-check-in-form-editor";
import type { CheckInFormEditorConfig, Client } from "@/types/check-in";

/**
 * Everything inside the customise-check-in sheet.
 *
 * **The gate is the point.** The one read that matters lives here; the editor
 * below is mounted only once it has resolved, so there is no state to
 * "seed" and no way to render an editor over data that has not arrived. That
 * is what replaced the ref latch whose spinner could never come down (see
 * `use-check-in-form-editor.ts`), and it also removes the possibility of a
 * coach saving an empty form over a real one.
 */
export function CheckInFormPanel({
  client,
  onClose,
}: {
  client: Client;
  onClose: () => void;
}) {
  const { form, isLoading, isError } = useClientCheckInForm(client.id);

  return (
    <>
      <header className="flex shrink-0 items-center gap-3.5 bg-[#0f2027] px-5 py-4">
        <span
          className="grid h-11 w-11 shrink-0 place-items-center rounded-[6px] bg-[rgba(13,148,136,0.15)] text-[#0d9488]"
          aria-hidden
        >
          <SlidersHorizontal className="h-4 w-4" strokeWidth={1.5} />
        </span>
        <div className="min-w-0">
          <p className={HEADER_EYEBROW_CLASS}>Check-in form</p>
          <p className="mt-0.5 truncate text-[17px] font-semibold leading-tight tracking-[-0.01em] text-white">
            {client.name}
          </p>
        </div>
        {/* Never disabled. It is the only exit from a slow or failed load, and
            Escape and the overlay can close the sheet regardless — a disabled X
            beside two working exits is theatre. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="ml-auto self-start rounded p-1 text-[rgba(255,255,255,0.35)] transition-colors hover:text-white"
        >
          <X className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </header>

      {isLoading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-[#93b0b4]" />
        </div>
      ) : isError || !form ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="rounded-[6px] bg-white p-6 text-center">
            <p className="text-sm text-[#93b0b4]">Failed to load the check-in form.</p>
          </div>
        </div>
      ) : (
        <CheckInFormEditorBody client={client} initialForm={form} onClose={onClose} />
      )}
    </>
  );
}

/**
 * The body and the footer, mounted only with a resolved form in hand. Its
 * draft state is initialised from `initialForm` at mount and never re-synced,
 * so a background revalidation cannot clobber edits in progress.
 */
function CheckInFormEditorBody({
  client,
  initialForm,
  onClose,
}: {
  client: Client;
  initialForm: CheckInFormEditorConfig;
  onClose: () => void;
}) {
  const editor = useCheckInFormEditor({ clientId: client.id, initialForm, onClose });
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mb-5 flex items-center justify-between gap-3 rounded-[6px] bg-white px-[18px] py-4">
          <div className="min-w-0">
            <p className={LABEL_CLASS}>Start from a template</p>
            <p className="mt-1 text-[11px] text-[#93b0b4]">
              {editor.isTemplatesError
                ? "Couldn't load your templates."
                : "Replaces everything below. Nothing is saved until you save changes."}
            </p>
          </div>
          {/* A DropdownMenu rather than a Select: applying a template is an
              ACTION, the editor diverges from it on the first toggle, and Radix
              would not re-fire onValueChange for the same value — so "start
              over from this one" would be inexpressible. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={editor.templates.length === 0}
                title={
                  editor.templates.length === 0
                    ? "Save a form as a template to reuse it here"
                    : undefined
                }
                className={cn(
                  "flex shrink-0 items-center gap-1 rounded-[6px] px-2 py-1 text-[11px] font-medium text-[#93b0b4] transition-colors",
                  "hover:bg-[rgba(13,148,136,0.05)] hover:text-[#0d9488] data-[state=open]:bg-[rgba(13,148,136,0.05)]",
                  "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-[#93b0b4]",
                  FOCUS_RING
                )}
              >
                Choose a template
                <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6} className="w-52">
              {editor.templates.map((template) => (
                <DropdownMenuItem
                  key={template.id}
                  onSelect={() => editor.applyTemplate(template)}
                >
                  {template.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <SectionLabel
          label="Fields"
          meta={`${editor.fields.length}/${CHECK_IN_FORM_FIELD_KEYS.length} on`}
        />
        <CheckInFormFieldsCard
          fields={editor.fields}
          onToggle={editor.toggleField}
          clientName={client.name}
        />

        <SectionLabel
          label="Your questions"
          meta={
            editor.questions.length > 0
              ? pluralize(editor.questions.length, "question")
              : undefined
          }
        />
        <CheckInFormQuestionsCard editor={editor} />
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[rgba(13,148,136,0.08)] bg-white px-5 py-3">
        <Button variant="ghost" onClick={onClose} disabled={editor.isSaving}>
          Cancel
        </Button>
        <Button
          variant="outline"
          disabled={editor.isSaving}
          onClick={() => {
            setTemplateName("");
            setTemplateDialogOpen(true);
          }}
        >
          <BookmarkPlus className="mr-1.5 h-4 w-4" strokeWidth={1.5} />
          Save as template
        </Button>
        <Button
          onClick={() => void editor.save()}
          disabled={editor.isSaving}
          className="bg-[#0d9488] text-white hover:bg-[#0b7f75]"
        >
          {editor.isSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          Save changes
        </Button>
      </footer>

      {/* Saves what is ON SCREEN, unsaved edits included — a coach shaping a
          form and banking it before committing it to this client is the
          gesture. So a template can exist from a state this client never had. */}
      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save as template</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 py-1">
            <Label htmlFor="check-in-template-name">Template name</Label>
            <Input
              id="check-in-template-name"
              value={templateName}
              maxLength={80}
              onChange={(event) => setTemplateName(event.target.value)}
              placeholder="e.g. Fat-loss weekly"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTemplateDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={templateName.trim() === "" || editor.isSaving}
              onClick={() => {
                void editor
                  .saveAsTemplate(templateName.trim())
                  .then(() => setTemplateDialogOpen(false))
                  .catch(() => {
                    /* the editor toasts; the dialog stays open to retry */
                  });
              }}
              className="bg-[#0d9488] text-white hover:bg-[#0b7f75]"
            >
              {editor.isSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Save template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
