import { createClient } from "@supabase/supabase-js";

/**
 * Key-name migration (publishable/secret replacing anon/service_role) — the new
 * NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY name always wins when both are set; falls back to the
 * legacy NEXT_PUBLIC_SUPABASE_ANON_KEY so environments not yet migrated (other worktrees,
 * Vercel envs) keep working unchanged. The key's own string format (sb_publishable_... vs the
 * legacy anon JWT) is opaque to createClient() — only the env var NAME differs.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error(
    "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or legacy NEXT_PUBLIC_SUPABASE_ANON_KEY)",
  );
}

export const supabase = createClient(url ?? "", key ?? "");
