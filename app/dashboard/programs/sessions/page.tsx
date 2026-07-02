"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useStandaloneSessions } from "@/hooks/use-standalone-sessions";
import { SessionsStatBand } from "@/components/programs/sessions-stat-band";
import { SessionsTable } from "@/components/programs/sessions-table";
import { NewSessionDialog } from "@/components/programs/new-session-dialog";

// The standalone-session library. The section topbar's "New session" action
// lands here with ?new=1 — we open the create dialog and clear the param
// (router.replace, same URL-state pattern as /clients/[id]?tab=).
function SessionsLibrary() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { mutate } = useStandaloneSessions();
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setCreateOpen(true);
      router.replace("/dashboard/programs/sessions", { scroll: false });
    }
  }, [searchParams, router]);

  return (
    <div className="space-y-5">
      <SessionsStatBand />
      <SessionsTable />
      <NewSessionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => void mutate()}
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
