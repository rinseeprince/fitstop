import type { Exercise } from "@/types/training";

// The one definition of "keyword match" for catalog exercises — a
// case-insensitive substring of the name or any alias. Shared by the
// Exercises library table and every add-exercise picker so search behaves
// identically everywhere.
export function filterExercisesByQuery(
  exercises: Exercise[],
  query: string
): Exercise[] {
  const q = query.trim().toLowerCase();
  if (!q) return exercises;
  return exercises.filter(
    (e) =>
      e.name.toLowerCase().includes(q) ||
      e.aliases.some((a) => a.toLowerCase().includes(q))
  );
}
