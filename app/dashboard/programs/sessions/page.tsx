"use client";

import { Dumbbell } from "lucide-react";

// Placeholder until the Sessions library table lands (redesign R3).
// Contract: the section topbar's "New session" action navigates here with
// ?new=1 — once the table exists this page opens its create flow on that
// param and clears it with router.replace.
export default function SessionsLibraryPage() {
  return (
    <div className="py-16 text-center text-[#5a7d82]">
      <Dumbbell className="mx-auto mb-2 h-8 w-8 opacity-50" strokeWidth={1.5} />
      <p className="text-sm">Session library coming soon</p>
    </div>
  );
}
