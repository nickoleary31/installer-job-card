import type { CapacitorConfig } from "@capacitor/cli";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * PHASE 1A ONLY (native shell smoke test) — see docs/Mobile_Development.md.
 *
 * There is deliberately no committed URL here. The native shell must never
 * silently load Production just because a developer forgot to configure
 * this — Phase 1A's native-runtime/service-worker changes only exist on
 * this branch, so Production does not reflect them.
 *
 * Set CAPACITOR_SERVER_URL yourself before running `cap sync` / `cap run` /
 * `cap open`, either as a shell env var or in a gitignored `.env.local` in
 * the repo root (the same file Next.js already uses for local secrets —
 * `.env*` is gitignored, see .gitignore). Point it at:
 *   - a Vercel Preview Deployment of THIS branch (feature/mobile-shell) —
 *     the normal case, since that's the only place Phase 1A's changes
 *     actually run; or
 *   - http://localhost:3000 with `npm run dev` running, for local
 *     iteration (use http://10.0.2.2:3000 instead of localhost when
 *     targeting the Android emulator specifically, since the emulator's
 *     network is separate from the host's).
 *
 * Leave it unset and the native shell loads the local `www/index.html`
 * placeholder instead — never a remote app, never Production. This keeps
 * `cap sync`/`cap add`/CI-style checks working with no configuration at all.
 */
function readServerUrlFromEnvLocal(): string | undefined {
  const envLocalPath = join(process.cwd(), ".env.local");
  if (!existsSync(envLocalPath)) return undefined;
  const match = readFileSync(envLocalPath, "utf8").match(/^\s*CAPACITOR_SERVER_URL\s*=\s*(.+?)\s*$/m);
  return match ? match[1].replace(/^["']|["']$/g, "") : undefined;
}

const phase1aServerUrl = process.env.CAPACITOR_SERVER_URL || readServerUrlFromEnvLocal();

if (!phase1aServerUrl) {
  console.warn(
    "[capacitor.config] CAPACITOR_SERVER_URL is not set — the native shell will load the local www/ placeholder, not the real app. " +
      "Set it to a Preview Deployment URL (or http://localhost:3000 for local dev) to test the actual UI. See docs/Mobile_Development.md.",
  );
}

const config: CapacitorConfig = {
  appId: "com.tkptelematics.installersheetz",
  appName: "Installer Sheetz",
  webDir: "www",
  ...(phase1aServerUrl
    ? {
        server: {
          url: phase1aServerUrl,
          // Only local dev servers (http://) need cleartext; Preview Deployments are https.
          cleartext: phase1aServerUrl.startsWith("http://"),
        },
      }
    : {}),
};

export default config;
