/**
 * Side-effect import: loads .env.local into process.env BEFORE any other
 * module is imported. Workaround for ESM import hoisting in tsx —
 * top-level `config({ path: ".env.local" })` runs too late.
 *
 * Usage (must be first import in script):
 *   import "./env-bootstrap";
 *   import { supabaseAdmin } from "@/services/supabase-admin";
 */
import { config } from "dotenv";

config({ path: ".env.local" });
