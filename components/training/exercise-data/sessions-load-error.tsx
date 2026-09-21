"use client";

// The one sentence an exercise's chart and its Sessions table say when their
// shared read fails — the same words in both slots, so the two never disagree
// about one read (docs/newdesignsystem.md → "Loading & async states": a failed
// read renders its error, never the empty state's copy).
export function SessionsLoadError({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="py-12 text-center">
      <p className="text-[13px] text-[#5a7d82]">Couldn&apos;t load the sessions</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 text-[12.5px] font-medium text-[#0d9488] transition-colors hover:text-[#0a5c55]"
        >
          Try again
        </button>
      )}
    </div>
  );
}
