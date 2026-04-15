/**
 * Seed the exercises catalog with global exercises (coach_id = NULL).
 * Run: npx tsx scripts/seed-exercise-catalog.ts
 *
 * Reads from scripts/data/exercises.csv (exported from Google Sheets).
 * Expected CSV columns: Name, Muscle Group, Equipment, Category, Aliases
 * Aliases should be comma-separated within the cell (e.g., "BB Bench, Flat Bench Press").
 *
 * Idempotent - safe to re-run. Skips duplicates.
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../.env.local") });

import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
import * as fs from "fs";
import * as path from "path";

type SeedExercise = {
  name: string;
  muscleGroup: string;
  equipment: string;
  category: string;
  aliases: string[];
};

function parseCSV(csvContent: string): SeedExercise[] {
  const lines = csvContent.split("\n").filter((line) => line.trim());
  if (lines.length < 2) {
    throw new Error("CSV must have a header row and at least one data row");
  }

  // Parse header to find column indices
  const header = parseCSVLine(lines[0]).map((h) => h.trim().toLowerCase());
  const nameIdx = header.indexOf("name");
  const muscleIdx = header.indexOf("muscle group");
  const equipIdx = header.indexOf("equipment");
  const catIdx = header.indexOf("category");
  const aliasIdx = header.indexOf("aliases");

  if (nameIdx === -1) {
    throw new Error('CSV must have a "Name" column');
  }

  const exercises: SeedExercise[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const name = cols[nameIdx]?.trim();
    if (!name) continue;

    const aliasRaw = aliasIdx >= 0 ? cols[aliasIdx]?.trim() : "";
    const aliases = aliasRaw
      ? aliasRaw.split(",").map((a) => a.trim()).filter(Boolean)
      : [];

    exercises.push({
      name,
      muscleGroup: muscleIdx >= 0 ? cols[muscleIdx]?.trim() || "" : "",
      equipment: equipIdx >= 0 ? cols[equipIdx]?.trim() || "" : "",
      category: catIdx >= 0 ? cols[catIdx]?.trim() || "" : "",
      aliases,
    });
  }

  return exercises;
}

// Handle quoted CSV fields (aliases may contain commas)
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

async function seedExercises() {
  // Support both CSV and JSON
  const csvPath = path.join(__dirname, "data", "exercises.csv");
  const jsonPath = path.join(__dirname, "data", "exercises.json");

  let exercises: SeedExercise[];

  if (fs.existsSync(csvPath)) {
    console.log("Reading from exercises.csv...");
    const raw = fs.readFileSync(csvPath, "utf-8");
    exercises = parseCSV(raw);
  } else if (fs.existsSync(jsonPath)) {
    console.log("Reading from exercises.json...");
    const raw = fs.readFileSync(jsonPath, "utf-8");
    exercises = JSON.parse(raw);
  } else {
    console.error("No seed data found.");
    console.error("Place exercises.csv or exercises.json in scripts/data/");
    process.exit(1);
  }

  console.log(`Seeding ${exercises.length} global exercises...`);

  // Process in batches of 100
  const BATCH_SIZE = 100;
  let total = 0;
  let skipped = 0;

  for (let i = 0; i < exercises.length; i += BATCH_SIZE) {
    const batch = exercises.slice(i, i + BATCH_SIZE);

    for (const e of batch) {
      const { error } = await supabaseAdmin
        .from("exercises")
        .upsert(
          {
            coach_id: null,
            name: e.name,
            muscle_group: e.muscleGroup || null,
            equipment: e.equipment || null,
            category: e.category || null,
            aliases: e.aliases || [],
          },
          { ignoreDuplicates: true }
        );

      if (error) {
        console.warn(`  Skipped "${e.name}": ${error.message}`);
        skipped++;
      } else {
        total++;
      }
    }

    console.log(`  Processed ${Math.min(i + BATCH_SIZE, exercises.length)} / ${exercises.length}`);
  }

  console.log(`Done! Seeded ${total} exercises (${skipped} skipped).`);
}

seedExercises().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
