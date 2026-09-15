import type { CapacitorConfig } from "@capacitor/cli";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * webDir points at mobile-web/out — the Phase 1B static export of the real
 * Installer Sheetz UI (see mobile-web/README or docs/Mobile_Development.md).
 * Run `npm run build` inside mobile-web/ before `cap sync` or this directory
 * won't exist yet.
 *
 * PHASE 1A COMPATIBILITY (server.url override, optional):
 * There is deliberately no committed URL here. The native shell must never
 * silently load Production just because a developer forgot to configure
 * this — Phase 1A's native-runtime/service-worker changes only exist on
 * this branch, so Production does not reflect them.
 *
 * Set CAPACITOR_SERVER_URL yourself before running `cap sync` / `cap run` /
 * `cap open`, either as a shell env var or in a gitignored `.env.local` in
 * the repo root (the same file Next.js already uses for local secrets —
 * `.env*` is gitignored, see .gitignore), to temporarily load a remote URL
 * instead of the local static bundle — e.g. a Vercel Preview Deployment, or
 * http://localhost:3000 (use http://10.0.2.2:3000 for the Android emulator).
 * This is a smoke-test escape hatch, not the Phase 1B architecture.
 *
 * Leave it unset (the normal case now) and the native shell boots from the
 * local static bundle in webDir — never a remote app, never Production.
 */
function readServerUrlFromEnvLocal(): string | undefined {
  const envLocalPath = join(process.cwd(), ".env.local");
  if (!existsSync(envLocalPath)) return undefined;
  const match = readFileSync(envLocalPath, "utf8").match(/^\s*CAPACITOR_SERVER_URL\s*=\s*(.+?)\s*$/m);
  return match ? match[1].replace(/^["']|["']$/g, "") : undefined;
}

const phase1aServerUrl = process.env.CAPACITOR_SERVER_URL || readServerUrlFromEnvLocal();

const config: CapacitorConfig = {
  appId: "com.tkptelematics.installersheetz",
  appName: "Installer Sheetz",
  webDir: "mobile-web/out",
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
