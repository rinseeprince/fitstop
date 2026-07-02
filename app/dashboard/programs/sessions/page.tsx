"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SessionsStatBand } from "@/components/programs/sessions-stat-band";
import { SessionsTable } from "@/components/programs/sessions-table";
import { StandaloneSessionEditor } from "@/components/programs/standalone-session-editor";
import type { SessionEditorState } from "@/components/programs/use-standalone-session-editor";

// The standalone-session library. The section topbar's "New session" action
// lands here with ?new=1 — we open the editor in create mode and clear the
// param (router.replace, same URL-state pattern as /clients/[id]?tab=).
// Row click re-opens the same editor in edit mode. The editor refreshes the
// shared SWR key itself after every save.
function SessionsLibrary() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [editorState, setEditorState] = useState<SessionEditorState | null>(null);

  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setEditorState({ mode: "create" });
      router.replace("/dashboard/programs/sessions", { scroll: false });
    }
  }, [searchParams, router]);

  return (
    <div className="space-y-5">
      <SessionsStatBand />
      <SessionsTable
        onEdit={(session) => setEditorState({ mode: "edit", session })}
      />
      <StandaloneSessionEditor
        state={editorState}
        onClose={() => setEditorState(null)}
      />
    </div>
  );
}

export default function SessionsLibraryPage() {
  // useSearchParams needs a Suspense boundary on statically-rendered routes.
  return (
    <Suspense fallback={null}>
      <SessionsLibrary />
    </Suspense>
  );
}
