"use client";

import { BookOpen } from "lucide-react";

// Placeholder until the Exercise library table lands (redesign R4).
// Contract: the section topbar's "New exercise" action navigates here with
// ?new=1 — once the table exists this page opens its create dialog on that
// param and clears it with router.replace.
export default function ExercisesLibraryPage() {
  return (
    <div className="py-16 text-center text-[#5a7d82]">
      <BookOpen className="mx-auto mb-2 h-8 w-8 opacity-50" strokeWidth={1.5} />
      <p className="text-sm">Exercise library coming soon</p>
    </div>
  );
}
